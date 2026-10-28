mod service;

use service::{Service, Status};
use std::sync::Arc;
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};

fn require_launcher(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("此窗口没有原生操作权限".into())
    }
}

#[tauri::command]
fn service_status(
    window: tauri::WebviewWindow,
    service: State<'_, Arc<Service>>,
) -> Result<Status, String> {
    require_launcher(&window)?;
    service.status()
}

#[tauri::command]
async fn start_service(
    window: tauri::WebviewWindow,
    service: State<'_, Arc<Service>>,
) -> Result<Status, String> {
    require_launcher(&window)?;
    let service = Arc::clone(service.inner());
    tauri::async_runtime::spawn_blocking(move || service.start())
        .await
        .map_err(|_| "启动任务异常结束".to_string())?
}

#[tauri::command]
async fn stop_service(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    service: State<'_, Arc<Service>>,
) -> Result<Status, String> {
    require_launcher(&window)?;
    if let Some(window) = app.get_webview_window("tavern") {
        window.close().map_err(|_| "无法关闭酒馆窗口".to_string())?;
    }
    let service = Arc::clone(service.inner());
    tauri::async_runtime::spawn_blocking(move || service.stop())
        .await
        .map_err(|_| "停止任务异常结束".to_string())?
}

#[tauri::command]
fn open_tavern(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    service: State<'_, Arc<Service>>,
) -> Result<(), String> {
    require_launcher(&window)?;
    if service.status()?.phase != "running" {
        return Err("请先启动酒馆".into());
    }
    if let Some(window) = app.get_webview_window("tavern") {
        window.show().map_err(|_| "无法显示酒馆窗口".to_string())?;
        return window.set_focus().map_err(|_| "无法激活酒馆窗口".into());
    }
    let url = service::URL
        .parse()
        .map_err(|_| "酒馆地址无效".to_string())?;
    WebviewWindowBuilder::new(&app, "tavern", WebviewUrl::External(url))
        .title("25小厨 · SillyTavern")
        .inner_size(1200.0, 850.0)
        .on_navigation(|url| {
            url.scheme() == "http"
                && url.host_str() == Some("127.0.0.1")
                && url.port() == Some(service::PORT)
        })
        .build()
        .map_err(|_| "无法打开酒馆窗口".to_string())?;
    Ok(())
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let resources = if cfg!(debug_assertions) {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/runtime")
            } else {
                app.path().resource_dir()?.join("runtime")
            };
            app.manage(Arc::new(Service::new(
                resources,
                app.path().app_data_dir()?,
            )));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            service_status,
            start_service,
            stop_service,
            open_tavern
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Chef25 application");
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let _ = app.state::<Arc<Service>>().stop();
        }
    });
}
