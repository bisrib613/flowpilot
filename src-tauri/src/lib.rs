use std::time::Duration;

mod account_store;
mod google_relogin;
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


#[derive(PartialEq, Eq, Debug, Clone, Copy)]
enum FlowLocation { Landing, Working, GoogleAuth, VerificationSkipped, Unknown }

fn flow_location(raw: &str) -> FlowLocation {
    let Ok(url) = tauri::Url::parse(raw) else { return FlowLocation::Unknown };
    if url.scheme() != "https" { return FlowLocation::Unknown; }
    // Skip CAPTCHA and non-password Google verification challenges.
    // /challenge/pwd is the ordinary password step and must remain permitted.
    let path = url.path().to_ascii_lowercase();
    let other_challenge = path.contains("/challenge/") && !path.contains("/challenge/pwd");
    if (url.host_str() == Some("accounts.google.com") &&
        (path.contains("recaptcha") || path.contains("captcha") ||
         path.contains("/sorry") || other_challenge)) {
        return FlowLocation::VerificationSkipped;
    }
    if matches!(url.host_str(), Some("www.google.com" | "google.com")) &&
        (path.contains("recaptcha") || path.contains("/sorry")) {
        return FlowLocation::VerificationSkipped;
    }
    if url.host_str() == Some("accounts.google.com") { return FlowLocation::GoogleAuth; }
    if url.host_str() != Some("flow.google.com") { return FlowLocation::Unknown; }
    match url.path() {
        "/about" => FlowLocation::Landing,
        "/" => FlowLocation::Working,
        path if path.starts_with("/project/") || path.starts_with("/library") => FlowLocation::Working,
        _ => FlowLocation::Unknown,
    }
}

#[tauri::command]
async fn check_flow_profile(app: tauri::AppHandle, account_id: String) -> Result<&'static str, String> {
    if !google_relogin::google_relogin_status()? {
        return Err("Enable Google Flow auto re-login in Settings first".into());
    }
    let start_app = app.clone();
    let start_id = account_id.clone();
    let Some(created) = run_on_ui_thread(&app, move || {
        webview_manager::begin_flow_profile_check(&start_app, start_id)
    }).await? else {
        return Ok("no_previous_session");
    };

    let result = async {
        let mut landing_seen = false;
        let mut working_ticks = 0_u32;
        let mut last_location = FlowLocation::Unknown;
        for attempt in 0..22 {
            tokio::time::sleep(Duration::from_millis(1000)).await;
            let poll_app = app.clone();
            let poll_id = account_id.clone();
            let url = run_on_ui_thread(&app, move || {
                webview_manager::poll_flow_profile_check(&poll_app, poll_id)
            }).await?;
            let location = flow_location(&url);
            match location {
                FlowLocation::Working if attempt >= 4 => {
                    working_ticks += 1;
                    if working_ticks >= 2 { return Ok("signed_in"); }
                }
                FlowLocation::VerificationSkipped => return Ok("verification_skipped"),
                FlowLocation::Landing => {
                    working_ticks = 0;
                    if !landing_seen {
                        landing_seen = true;
                        let click_app = app.clone();
                        let click_id = account_id.clone();
                        run_on_ui_thread(&app, move || {
                            webview_manager::click_flow_relogin_entry(&click_app, click_id)
                        }).await?;
                    }
                }
                _ => { working_ticks = 0; }
            }
            last_location = location;
        }
        if landing_seen { Ok("relogin_unconfirmed") }
        else if last_location == FlowLocation::GoogleAuth { Ok("google_auth_pending") }
        else { Ok("unknown") }
    }.await;
    // A temporary check WebView is never retained across profiles.
    // A user-opened view remains intact.
    let finish_app = app.clone();
    let finish_id = account_id;
    let cleanup = run_on_ui_thread(&app, move || {
        webview_manager::finish_flow_profile_check(&finish_app, finish_id, created)
    }).await;
    match (result, cleanup) {
        (Ok(status), Ok(())) => Ok(status),
        (Err(error), _) => Err(error),
        (_, Err(error)) => Err(error),
    }
}

#[cfg(test)]
mod flow_location_tests {
    use super::{flow_location, FlowLocation};
    #[test]
    fn logged_out_landing_differs_from_healthy_flow_and_unexpected_urls() {
        assert_eq!(flow_location("https://flow.google.com/about"), FlowLocation::Landing);
        assert_eq!(flow_location("https://flow.google.com/"), FlowLocation::Working);
        assert_eq!(flow_location("https://flow.google.com/project/123"), FlowLocation::Working);
        assert_eq!(flow_location("https://accounts.google.com/signin"), FlowLocation::GoogleAuth);
        assert_eq!(flow_location("https://accounts.google.com/v3/signin/challenge/pwd"), FlowLocation::GoogleAuth);
        assert_eq!(flow_location("https://accounts.google.com/v3/signin/challenge/totp"), FlowLocation::VerificationSkipped);
        assert_eq!(flow_location("https://accounts.google.com/recaptcha"), FlowLocation::VerificationSkipped);
        assert_eq!(flow_location("https://www.google.com/sorry/index"), FlowLocation::VerificationSkipped);
        assert_eq!(flow_location("https://flow.google.com/404?reason=project"), FlowLocation::Unknown);
        assert_eq!(flow_location("https://flow.google.com.evil.invalid/about"), FlowLocation::Unknown);
        assert_eq!(flow_location("http://flow.google.com/about"), FlowLocation::Unknown);
    }
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
            check_flow_profile,
            google_relogin::google_relogin_status,
            google_relogin::google_relogin_save_password,
            google_relogin::google_relogin_disable,
            account_store::load_accounts,
            account_store::save_accounts
        ])
        .run(tauri::generate_context!())
        .expect("error while running Flowpilot");
}
