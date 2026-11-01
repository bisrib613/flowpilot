use std::time::Duration;

mod account_store;
mod webview_manager;
mod native_downloads;
mod download_settings;
mod webview_download_bridge;
mod dialog_thread_experiment;
mod automation_bridge;
#[cfg(all(windows, feature = "diag"))]
mod webview_diagnostics;

async fn run_on_ui_thread<F, T>(app: &tauri::AppHandle, operation: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let _ = sender.send(operation());
    })
    .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        receiver
            .recv_timeout(Duration::from_secs(30))
            .map_err(|_| "WebView operation timed out".to_string())?
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_google_flow(
    app: tauri::AppHandle,
    account_id: String,
    service: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let operation_app = app.clone();
    run_on_ui_thread(&app, move || {
        webview_manager::open(&operation_app, account_id, service, x, y, width, height)
    })
    .await
}

#[tauri::command]
async fn prepare_workspace(app: tauri::AppHandle, account_id: String, service: String,
    neighbors: Vec<String>, x: f64, y: f64, width: f64, height: f64) -> Result<u64, String> {
    let operation_app = app.clone();
    run_on_ui_thread(&app, move || webview_manager::prepare_workspace(&operation_app, account_id, service, neighbors, x, y, width, height)).await
}

#[tauri::command]
async fn preload_workspace(app: tauri::AppHandle, account_id: String, service: String,
    epoch: u64, width: f64, height: f64) -> Result<(), String> {
    let operation_app = app.clone();
    run_on_ui_thread(&app, move || webview_manager::preload_workspace(&operation_app, account_id, service, epoch, width, height)).await
}

#[tauri::command]
async fn close_workspaces(app: tauri::AppHandle, service: Option<String>) -> Result<(), String> {
    let operation_app = app.clone();
    run_on_ui_thread(&app, move || webview_manager::close_workspaces(&operation_app, service)).await
}

#[tauri::command]
async fn close_google_flow(
    app: tauri::AppHandle,
    account_id: Option<String>,
    service: Option<String>,
) -> Result<(), String> {
    let operation_app = app.clone();
    run_on_ui_thread(&app, move || {
        webview_manager::close(&operation_app, account_id, service)
    })
    .await
}

#[tauri::command]
async fn resize_google_flow(
    app: tauri::AppHandle,
    account_id: String,
    service: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let operation_app = app.clone();
    run_on_ui_thread(&app, move || {
        webview_manager::resize(&operation_app, account_id, service, x, y, width, height)
    })
    .await
}

#[tauri::command]
async fn navigate_service_bookmark(
    app: tauri::AppHandle,
    account_id: String,
    service: String,
    url: String,
) -> Result<(), String> {
    let operation_app = app.clone();
    run_on_ui_thread(&app, move || {
        webview_manager::navigate_service_bookmark(&operation_app, account_id, service, url)
    })
    .await
}

#[tauri::command]
async fn remove_google_flow_account(
    app: tauri::AppHandle,
    account_id: String,
    service: String,
) -> Result<bool, String> {
    let operation_app = app.clone();
    run_on_ui_thread(&app, move || {
        webview_manager::remove(&operation_app, account_id, service)
    })
    .await
}

#[tauri::command]
async fn clear_google_flow_cache(
    app: tauri::AppHandle,
    account_id: String,
    service: String,
) -> Result<(), String> {
    let operation_app = app.clone();
    let receiver = run_on_ui_thread(&app, move || {
        webview_manager::begin_clear_disk_cache(&operation_app, account_id, service)
    })
    .await?;
    let Some(receiver) = receiver else {
        return Ok(());
    };
    tauri::async_runtime::spawn_blocking(move || {
        receiver
            .recv_timeout(Duration::from_secs(30))
            .map_err(|_| "Cache clear operation timed out".to_string())?
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            automation_bridge::start(app.handle().clone()).map_err(std::io::Error::other)?;
            Ok(())
        })
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(webview_manager::WebviewManager::default())
        .manage(webview_download_bridge::DownloadState::default())
        .invoke_handler(tauri::generate_handler![
            download_settings::get_download_folder,
            download_settings::choose_download_folder,
            download_settings::open_download_folder,
            open_google_flow,
            prepare_workspace,
            preload_workspace,
            close_workspaces,
            close_google_flow,
            resize_google_flow,
            navigate_service_bookmark,
            remove_google_flow_account,
            clear_google_flow_cache,
            webview_download_bridge::begin_blob_download,
            webview_download_bridge::write_blob_download_chunk,
            webview_download_bridge::complete_blob_download,
            webview_download_bridge::cancel_blob_download,
            dialog_thread_experiment::debug_trigger_isolated_dialog,
            #[cfg(all(windows, feature = "diag"))]
            webview_download_bridge::diagnostic_save_file,
            account_store::load_accounts,
            account_store::save_accounts
        ])
        .run(tauri::generate_context!())
        .expect("error while running Flowpilot");
}
