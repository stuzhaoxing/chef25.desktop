use crate::service::Service;
use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{ipc::Channel, AppHandle, Manager, State, Webview};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct Updates {
    pending: Mutex<Option<Update>>,
    busy: AtomicBool,
}

struct Operation<'a>(&'a AtomicBool);
impl<'a> Operation<'a> {
    fn begin(flag: &'a AtomicBool) -> Result<Self, String> {
        flag.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "更新任务正在进行，请稍候".to_string())?;
        Ok(Self(flag))
    }
}
impl Drop for Operation<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    version: String,
    notes: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    phase: &'static str,
    downloaded: u64,
    total: Option<u64>,
}

#[tauri::command]
pub async fn check_update(
    window: Webview,
    app: AppHandle,
    updates: State<'_, Updates>,
) -> Result<Option<AvailableUpdate>, String> {
    crate::require_launcher(&window)?;
    let _operation = Operation::begin(&updates.busy)?;
    let mut update = app
        .updater_builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "无法准备更新检查")?
        .check()
        .await
        .map_err(|_| "暂时无法检查更新，请稍后重试")?;
    if let Some(candidate) = update.as_mut() {
        // A large signed installer needs a longer transfer deadline than its manifest.
        candidate.timeout = Some(Duration::from_secs(1800));
    }
    let metadata = update.as_ref().map(|u| AvailableUpdate {
        version: u.version.clone(),
        notes: u.body.clone(),
    });
    *updates.pending.lock().map_err(|_| "更新状态异常")? = update;
    Ok(metadata)
}

#[tauri::command]
pub async fn install_update(
    window: Webview,
    app: AppHandle,
    updates: State<'_, Updates>,
    service: State<'_, Arc<Service>>,
    on_progress: Channel<Progress>,
) -> Result<(), String> {
    crate::require_launcher(&window)?;
    let _operation = Operation::begin(&updates.busy)?;
    let update = updates
        .pending
        .lock()
        .map_err(|_| "更新状态异常")?
        .take()
        .ok_or("请先检查更新")?;
    let mut downloaded = 0;
    // Download verifies the updater signature before any service is stopped or files replaced.
    let result = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                let _ = on_progress.send(Progress {
                    phase: "downloading",
                    downloaded,
                    total,
                });
            },
            || {},
        )
        .await;
    let bytes = match result {
        Ok(bytes) => bytes,
        Err(_) => {
            *updates.pending.lock().map_err(|_| "更新状态异常")? = Some(update);
            return Err("下载或更新签名校验失败，当前版本未改动，请重试".into());
        }
    };
    let owned_service = Arc::clone(service.inner());
    tauri::async_runtime::spawn_blocking(move || owned_service.begin_update())
        .await
        .map_err(|_| "停止酒馆任务异常")??;
    let _ = on_progress.send(Progress {
        phase: "installing",
        downloaded,
        total: Some(downloaded),
    });
    let result = (|| {
        if let Some(tavern) = app.get_webview("tavern") {
            tavern.close().map_err(|_| "无法关闭酒馆窗口")?;
        }
        update
            .install(bytes)
            .map_err(|_| "安装更新失败，酒馆已停止，可重新启动后再试")?;
        Ok::<_, String>(())
    })();
    if let Err(error) = result {
        service.end_update();
        *updates.pending.lock().map_err(|_| "更新状态异常")? = Some(update);
        return Err(error);
    }
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn concurrent_update_operations_are_rejected_and_failures_release_the_guard() {
        let flag = AtomicBool::new(false);
        let operation = Operation::begin(&flag).unwrap();
        assert!(Operation::begin(&flag).is_err());
        drop(operation);
        assert!(Operation::begin(&flag).is_ok());
    }
}
