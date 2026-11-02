use std::time::Duration;
use tauri::Emitter;

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
                FlowLocation::Working if attempt >= 7 => {
                    working_ticks += 1;
                    if working_ticks >= 3 { return Ok("signed_in"); }
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

// A single command owns one destination's OAuth attempt. The frontend awaits it
// before starting the next account, so shared Flow sessions are never raced.
#[tauri::command]
async fn run_bulk_shared_login(
    app: tauri::AppHandle, account_id: String, service: String,
) -> Result<&'static str, String> {
    let source_accounts = account_store::load_accounts(app.clone())?
        .ok_or("Account storage unavailable")?;
    let linked = source_accounts.as_array()
        .and_then(|rows| rows.iter().find(|row|
            row.get("id").and_then(|v| v.as_str()) == Some(account_id.as_str()) &&
            row.get("service").and_then(|v| v.as_str()) == Some(service.as_str())
        )).ok_or("Destination account not found")?;
    let flow_id = linked.get("flowSessionId").and_then(|v| v.as_str())
        .ok_or("Destination is not linked to a Flow profile")?;
    let expected_email = source_accounts.as_array().and_then(|rows| rows.iter().find(|row|
        row.get("id").and_then(|v| v.as_str()) == Some(flow_id) &&
        row.get("service").and_then(|v| v.as_str()).unwrap_or("flow") == "flow"
    )).and_then(|row| row.get("email")).and_then(|v| v.as_str())
        .unwrap_or("").to_string();

    let start_app = app.clone();
    let start_id = account_id.clone();
    let start_service = service.clone();
    let created = run_on_ui_thread(&app, move || {
        webview_manager::begin_bulk_shared_login(&start_app, start_id, start_service)
    }).await?;

    let result = async {
        let mut service_google_clicked = false;
        let mut saw_entry = false;
        let mut consent_pending = false;
        // A first-time Google OAuth consent needs a human click. Keep polling
        // rather than closing the dialog while the user reads the permission.
        for attempt in 0..120 {
            // Keep the original short timeout if no consent is involved.
            if attempt >= 35 && !consent_pending { break; }
            tokio::time::sleep(Duration::from_secs(1)).await;
            let poll_app = app.clone();
            let poll_id = account_id.clone();
            let poll_service = service.clone();
            let email = expected_email.clone();
            let responses = run_on_ui_thread(&app, move || {
                webview_manager::evaluate_bulk_shared_login(
                    &poll_app, poll_id, poll_service, email, !service_google_clicked,
                )
            }).await?;
            let mut signals = Vec::new();
            for receiver in responses {
                let raw = tauri::async_runtime::spawn_blocking(move ||
                    receiver.recv_timeout(Duration::from_secs(3)).ok()
                ).await.map_err(|error| error.to_string())?;
                if let Some(raw) = raw {
                    // eval_with_callback serializes the returned JavaScript value.
                    if let Ok(signal) = serde_json::from_str::<String>(&raw) {
                        signals.push(signal);
                    }
                }
            }
            // Prefer success over a stale popup. Otherwise fail closed on
            // Google session loss or an unrecognized chooser.
            if signals.iter().any(|s| s == "signed_in") { return Ok("signed_in"); }
            if signals.iter().any(|s| s == "consent_required") && !consent_pending {
                consent_pending = true;
                // No emails, Google page text, tokens or credentials are sent.
                let _ = app.emit_to("main", "flowpilot-bulk-login-action", serde_json::json!({
                    "accountId": account_id,
                    "status": "consent_required"
                }));
            }
            if signals.iter().any(|s| s == "invalid_session") { return Ok("invalid_session"); }
            if signals.iter().any(|s| s == "needs_attention") { return Ok("needs_attention"); }
            if signals.iter().any(|s| s == "google_clicked") {
                service_google_clicked = true;
            }
            if signals.iter().any(|s| s == "entry_clicked" || s == "chooser_clicked") {
                saw_entry = true;
            }
        }
        Ok(if consent_pending { "consent_required" }
            else if service_google_clicked || saw_entry { "login_unconfirmed" }
            else { "login_button_not_found" })
    }.await;

    let keep_consent_popup = matches!(&result, Ok("consent_required"));
    let finish_app = app.clone();
    let finish_id = account_id;
    let finish_service = service;
    let cleanup = run_on_ui_thread(&app, move || {
        webview_manager::finish_bulk_shared_login(
            &finish_app, finish_id, finish_service, created,
            keep_consent_popup,
        )
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
            run_bulk_shared_login,
            google_relogin::google_relogin_status,
            google_relogin::google_relogin_save_password,
            google_relogin::google_relogin_disable,
            account_store::load_accounts,
            account_store::save_accounts
        ])
        .run(tauri::generate_context!())
        .expect("error while running Flowpilot");
}
