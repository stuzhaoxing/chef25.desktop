mod backup;
mod managed_remote;
mod remote;
mod service;
mod storage;
mod updates;

use service::{Service, Status};
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::WebviewBuilder,
    LogicalPosition, LogicalSize, Manager, Rect, State, WebviewUrl,
};
use tauri_plugin_dialog::DialogExt;

fn show_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_window("main") {
        window.unminimize()?;
        window.show()?;
        window.set_focus()?;
    }
    Ok(())
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "tray-show", "显示主窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray-quit", "退出 25小厨", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let icon = app
        .default_window_icon()
        .ok_or_else(|| tauri::Error::AssetNotFound("application icon".into()))?
        .clone();
    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip("25小厨")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray-show" => {
                if let Err(error) = show_main_window(app) {
                    eprintln!("Unable to restore main window: {error}");
                }
            }
            // Use the same ExitRequested cleanup as the launcher/system quit.
            "tray-quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                if let Err(error) = show_main_window(tray.app_handle()) {
                    eprintln!("Unable to restore main window: {error}");
                }
            }
        })
        .build(app)?;
    Ok(())
}

fn require_launcher(window: &tauri::Webview) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("此窗口没有原生操作权限".into())
    }
}

#[tauri::command]
fn quit_app(window: tauri::Webview, app: tauri::AppHandle) -> Result<(), String> {
    require_launcher(&window)?;
    // ExitRequested owns service cleanup, including cancellation of pending starts.
    app.exit(0);
    Ok(())
}

// Fixed destination: no arbitrary URL or shell input from either webview.
#[tauri::command]
fn open_developer_issues(window: tauri::Webview) -> Result<(), String> {
    require_launcher(&window)?;
    open_fixed_url("https://github.com/stuzhaoxing/chef25.desktop/issues")
}

fn open_fixed_url(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("rundll32.exe");
        command.arg("url.dll,FileProtocolHandler");
        command
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut command = std::process::Command::new("xdg-open");
    command.arg(url).spawn().map_err(|_| "无法打开浏览器")?;
    Ok(())
}

#[tauri::command]
async fn open_storage(window: tauri::Webview, app: tauri::AppHandle) -> Result<(), String> {
    require_launcher(&window)?;
    let root = app.path().app_data_dir().map_err(|_| "无法定位存储目录")?;
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&root).map_err(|_| "无法创建存储目录")?;
        #[cfg(target_os = "macos")]
        let command = "open";
        #[cfg(target_os = "windows")]
        let command = "explorer.exe";
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let command = "xdg-open";
        std::process::Command::new(command)
            .arg(root)
            .spawn()
            .map_err(|_| "无法打开存储目录")?;
        Ok(())
    })
    .await
    .map_err(|_| "打开目录任务异常")?
}

#[tauri::command]
async fn transfer_storage(
    window: tauri::Webview,
    app: tauri::AppHandle,
    service: State<'_, Arc<Service>>,
    importing: bool,
    confirmation: String,
) -> Result<Option<String>, String> {
    require_launcher(&window)?;
    backup::confirm(importing, &confirmation)?;
    let service = Arc::clone(service.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let chooser = app
            .dialog()
            .file()
            .set_parent(&window.window())
            .add_filter("ZIP 备份", &["zip"]);
        let selected = if importing {
            chooser.set_title("选择 25小厨备份").blocking_pick_file()
        } else {
            chooser
                .set_title("导出 25小厨备份")
                .set_file_name(format!(
                    "25小厨备份_{}.zip",
                    chrono::Local::now().format("%Y-%m-%d_%H-%M-%S")
                ))
                .blocking_save_file()
        };
        let Some(selected) = selected else {
            return Ok(None);
        };
        let path = selected.into_path().map_err(|_| "请选择本机 ZIP 文件")?;
        service.transfer(importing, &confirmation, &path).map(Some)
    })
    .await
    .map_err(|_| "备份任务异常，请检查本地数据")?
}

#[tauri::command]
async fn list_storage(
    window: tauri::Webview,
    app: tauri::AppHandle,
    path: String,
) -> Result<Vec<storage::Entry>, String> {
    require_launcher(&window)?;
    let root = app.path().app_data_dir().map_err(|_| "无法定位存储目录")?;
    tauri::async_runtime::spawn_blocking(move || storage::list(&root, &path))
        .await
        .map_err(|_| "读取文件夹任务异常")?
}

#[tauri::command]
async fn preview_storage(
    window: tauri::Webview,
    app: tauri::AppHandle,
    path: String,
) -> Result<String, String> {
    require_launcher(&window)?;
    let root = app.path().app_data_dir().map_err(|_| "无法定位存储目录")?;
    tauri::async_runtime::spawn_blocking(move || storage::preview(&root, &path))
        .await
        .map_err(|_| "读取文件任务异常")?
}

#[tauri::command]
fn service_status(
    window: tauri::Webview,
    service: State<'_, Arc<Service>>,
) -> Result<Status, String> {
    require_launcher(&window)?;
    service.status()
}

#[tauri::command]
fn launch_settings(
    window: tauri::Webview,
    service: State<'_, Arc<Service>>,
) -> Result<service::LaunchSettings, String> {
    require_launcher(&window)?;
    service.settings()
}

#[tauri::command]
async fn save_launch_settings(
    window: tauri::Webview,
    service: State<'_, Arc<Service>>,
    settings: service::LaunchSettings,
) -> Result<(), String> {
    require_launcher(&window)?;
    let service = Arc::clone(service.inner());
    tauri::async_runtime::spawn_blocking(move || service.save_settings(settings))
        .await
        .map_err(|_| "保存设置任务异常")?
}

#[tauri::command]
async fn remote_capacity(window: tauri::Webview) -> Result<managed_remote::Capacity, String> {
    require_launcher(&window)?;
    tauri::async_runtime::spawn_blocking(managed_remote::capacity)
        .await
        .map_err(|_| "容量查询任务异常")?
}

#[tauri::command]
async fn remote_status(
    window: tauri::Webview,
    service: State<'_, Arc<Service>>,
) -> Result<remote::RemoteStatus, String> {
    require_launcher(&window)?;
    let service = Arc::clone(service.inner());
    tauri::async_runtime::spawn_blocking(move || service.remote_status())
        .await
        .map_err(|_| "远程访问任务异常")?
}

#[tauri::command]
async fn stop_remote(
    window: tauri::Webview,
    service: State<'_, Arc<Service>>,
) -> Result<remote::RemoteStatus, String> {
    require_launcher(&window)?;
    let service = Arc::clone(service.inner());
    tauri::async_runtime::spawn_blocking(move || service.stop_remote())
        .await
        .map_err(|_| "远程访问任务异常")?
}

#[tauri::command]
async fn start_remote(
    window: tauri::Webview,
    service: State<'_, Arc<Service>>,
) -> Result<remote::RemoteStatus, String> {
    require_launcher(&window)?;
    let service = Arc::clone(service.inner());
    tauri::async_runtime::spawn_blocking(move || service.start_remote())
        .await
        .map_err(|_| "远程访问任务异常")?
}

#[tauri::command]
async fn reset_data(
    window: tauri::Webview,
    service: State<'_, Arc<Service>>,
    confirmation: String,
) -> Result<(), String> {
    require_launcher(&window)?;
    let service = Arc::clone(service.inner());
    tauri::async_runtime::spawn_blocking(move || service.reset(&confirmation))
        .await
        .map_err(|_| "重置任务异常，请检查本地数据后重试")?
}

#[tauri::command]
async fn start_service(
    window: tauri::Webview,
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
    window: tauri::Webview,
    app: tauri::AppHandle,
    service: State<'_, Arc<Service>>,
) -> Result<Status, String> {
    require_launcher(&window)?;
    if let Some(window) = app.get_webview("tavern") {
        window.close().map_err(|_| "无法关闭酒馆窗口".to_string())?;
    }
    let service = Arc::clone(service.inner());
    tauri::async_runtime::spawn_blocking(move || service.stop())
        .await
        .map_err(|_| "停止任务异常结束".to_string())?
}

// Only the trusted launcher can select one of these two window layouts.
#[tauri::command]
fn resize_workspace(window: tauri::Webview, expanded: bool) -> Result<(), String> {
    require_launcher(&window)?;
    let window = window.window();
    if expanded {
        // Preserve an existing fullscreen choice while entering the tavern.
        if window.is_fullscreen().map_err(|_| "无法读取窗口状态")?
            || window.is_maximized().map_err(|_| "无法读取窗口状态")?
        {
            return Ok(());
        }
        // Native maximize fills the desktop work area without entering fullscreen.
        return window.maximize().map_err(|_| "无法最大化窗口".into());
    }
    // Restore the launcher even when the tavern maximized the window itself.
    if window.is_fullscreen().map_err(|_| "无法读取窗口状态")? {
        window
            .set_fullscreen(false)
            .map_err(|_| "无法退出全屏".to_string())?;
    }
    window.unmaximize().map_err(|_| "无法还原窗口")?;
    let scale = window.scale_factor().map_err(|_| "无法读取窗口缩放")?;
    let mut size = compact_workspace_size();
    if let Some(monitor) = window.current_monitor().map_err(|_| "无法读取屏幕尺寸")? {
        let area = monitor.work_area().size.to_logical::<f64>(scale);
        let outer = window
            .outer_size()
            .map_err(|_| "无法读取窗口尺寸")?
            .to_logical::<f64>(scale);
        let inner = window
            .inner_size()
            .map_err(|_| "无法读取窗口尺寸")?
            .to_logical::<f64>(scale);
        size.width = size
            .width
            .min((area.width - (outer.width - inner.width)).max(720.0));
        size.height = size
            .height
            .min((area.height - (outer.height - inner.height)).max(620.0));
    }
    window.set_size(size).map_err(|_| "无法调整窗口尺寸")?;
    window.center().map_err(|_| "无法调整窗口位置".into())
}

fn compact_workspace_size() -> LogicalSize<f64> {
    LogicalSize::new(860.0, 640.0)
}

#[derive(serde::Deserialize)]
struct TavernBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    viewport_height: f64,
}

impl TavernBounds {
    fn validate(&self) -> Result<(), String> {
        if [
            self.x,
            self.y,
            self.width,
            self.height,
            self.viewport_height,
        ]
        .iter()
        .all(|v| v.is_finite())
            && self.x >= 0.0
            && self.y >= 0.0
            && self.width > 0.0
            && self.height > 0.0
            && self.viewport_height > 0.0
        {
            Ok(())
        } else {
            Err("酒馆显示区域无效".into())
        }
    }
}

// Async avoids WebView2's child-webview creation deadlock on Windows.
#[tauri::command]
async fn sync_tavern(
    window: tauri::Webview,
    app: tauri::AppHandle,
    service: State<'_, Arc<Service>>,
    bounds: Option<TavernBounds>,
) -> Result<(), String> {
    require_launcher(&window)?;
    let Some(bounds) = bounds else {
        if let Some(tavern) = app.get_webview("tavern") {
            tavern.hide().map_err(|_| "无法隐藏酒馆页面")?;
        }
        return Ok(());
    };
    bounds.validate()?;
    let status = service.status()?;
    if status.phase != "running" {
        return Err("请先启动酒馆".into());
    }
    // DOM coordinates start at the launcher webview; native child coordinates
    // start at its parent view (which can include macOS titlebar space).
    let scale = window
        .window()
        .scale_factor()
        .map_err(|_| "无法读取窗口缩放")?;
    let origin = window
        .position()
        .map_err(|_| "无法读取主界面位置")?
        .to_logical::<f64>(scale);
    // WKWebView insets the launcher's HTML viewport below the titlebar,
    // although its native frame still covers the full content view.
    #[cfg(target_os = "macos")]
    let titlebar = (window
        .size()
        .map_err(|_| "无法读取主界面尺寸")?
        .to_logical::<f64>(scale)
        .height
        - bounds.viewport_height)
        .max(0.0);
    #[cfg(not(target_os = "macos"))]
    let titlebar = 0.0;
    let position = LogicalPosition::new(origin.x + bounds.x, origin.y + bounds.y + titlebar);
    let size = LogicalSize::new(bounds.width, bounds.height);
    let url: tauri::Url = status.url.parse().map_err(|_| "酒馆地址无效")?;
    if let Some(tavern) = app.get_webview("tavern") {
        if tavern.url().map_err(|_| "无法读取酒馆地址")?.origin() != url.origin() {
            tavern.close().map_err(|_| "无法关闭旧酒馆页面")?;
        }
    }
    if let Some(tavern) = app.get_webview("tavern") {
        tavern
            .set_bounds(Rect {
                position: position.into(),
                size: size.into(),
            })
            .map_err(|_| "无法调整酒馆页面")?;
        return tavern.show().map_err(|_| "无法显示酒馆页面".into());
    }
    let allowed_origin = url.origin();
    window
        .window()
        .add_child(
            WebviewBuilder::new("tavern", WebviewUrl::External(url))
                .on_navigation(move |url| url.origin() == allowed_origin),
            position,
            size,
        )
        .map_err(|_| "无法打开酒馆页面")?;
    Ok(())
}

pub fn run() {
    // Unbundled `tauri dev` launches use the process name for the Dock label.
    // Set it before AppKit registers the application with Launch Services.
    #[cfg(target_os = "macos")]
    objc2_foundation::NSProcessInfo::processInfo().setProcessName(
        &objc2_foundation::NSString::from_str(if cfg!(debug_assertions) {
            "25小厨 Dev"
        } else {
            "25小厨"
        }),
    );
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::Updates::default())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Err(error) = show_main_window(app) {
                eprintln!("Unable to restore main window: {error}");
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
            setup_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            service_status,
            quit_app,
            open_storage,
            open_developer_issues,
            transfer_storage,
            list_storage,
            preview_storage,
            launch_settings,
            remote_capacity,
            remote_status,
            start_remote,
            stop_remote,
            save_launch_settings,
            reset_data,
            start_service,
            stop_service,
            sync_tavern,
            resize_workspace,
            updates::check_update,
            updates::install_update
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Chef25 application");
    app.run(|app, event| {
        match event {
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } if label == "main" => {
                // Closing only folds away the window; the tavern keeps running.
                api.prevent_close();
                if let Some(window) = app.get_window("main") {
                    if let Err(error) = window.minimize() {
                        eprintln!("Unable to minimize main window: {error}");
                    }
                }
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                if let Err(error) = show_main_window(app) {
                    eprintln!("Unable to restore main window: {error}");
                }
            }
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                app.state::<Arc<Service>>().shutdown();
            }
            _ => {}
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_window_matches_initial_configuration() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let initial = &config["app"]["windows"][0];
        let compact = compact_workspace_size();
        assert_eq!(initial["width"].as_f64(), Some(compact.width));
        assert_eq!(initial["height"].as_f64(), Some(compact.height));
    }

    #[test]
    fn child_bounds_reject_invalid_geometry() {
        let mut bounds = TavernBounds {
            x: 213.0,
            y: 100.0,
            width: 700.0,
            height: 500.0,
            viewport_height: 720.0,
        };
        assert!(bounds.validate().is_ok());
        bounds.width = 0.0;
        assert!(bounds.validate().is_err());
        bounds.width = f64::INFINITY;
        assert!(bounds.validate().is_err());
        bounds.width = 700.0;
        bounds.x = -1.0;
        assert!(bounds.validate().is_err());
        bounds.x = f64::NAN;
        assert!(bounds.validate().is_err());
    }

    #[test]
    fn native_capabilities_target_launcher_webview_only() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        assert!(capability.get("windows").is_none());
        assert_eq!(capability["webviews"], serde_json::json!(["main"]));
    }
}
