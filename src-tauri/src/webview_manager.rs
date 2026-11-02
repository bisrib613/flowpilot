use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::path::BaseDirectory;
use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, Manager, Runtime, WebviewUrl};

#[cfg(windows)]
use webview2_com::{
    ClearBrowsingDataCompletedHandler, WindowCloseRequestedEventHandler,
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Profile2, ICoreWebView2_13,
        COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE,
    },
};
#[cfg(windows)]
use windows::core::Interface;

const WEBVIEW_LABEL_PREFIX: &str = "flowpilot-service";
const AUTOMATION_LABEL_PREFIX: &str = "flowpilot-automation";


pub struct WebviewManager {
    active_account_id: Mutex<Option<String>>,
    visible: Mutex<bool>,
    cached_accounts: Mutex<HashMap<String, u64>>,
    usage_counter: Mutex<u64>,
    operation: Mutex<()>,
    preload_epoch: Mutex<u64>,
    preload_targets: Mutex<Vec<String>>,
    browser_profile_ports: Mutex<HashMap<String, u16>>,
    automation_ports: Mutex<HashMap<String, u16>>,
}

impl Default for WebviewManager {
    fn default() -> Self {
        Self {
            active_account_id: Mutex::new(None),
            visible: Mutex::new(false),
            cached_accounts: Mutex::new(HashMap::new()),
            usage_counter: Mutex::new(0),
            operation: Mutex::new(()),
            preload_epoch: Mutex::new(0),
            preload_targets: Mutex::new(Vec::new()),
            browser_profile_ports: Mutex::new(HashMap::new()),
            automation_ports: Mutex::new(HashMap::new()),
        }
    }
}

fn service_url(service: &str) -> Result<&'static str, String> {
    match service {
        "flow" => Ok("https://flow.google.com/"),
        "dola" => Ok("https://www.dola.com/"),
        "leonardo" => Ok("https://app.leonardo.ai/"),
        "chatgpt" => Ok("https://chatgpt.com/"),
        "migoo" => Ok("https://migoo.ai/home"),
        "claude" => Ok("https://claude.ai/"),
        _ => Err("invalid service".to_string()),
    }
}

fn profile_key(service: &str, account_id: &str) -> Result<String, String> {
    service_url(service)?;
    validate_account_id(account_id)?;
    Ok(format!("{service}-{account_id}"))
}

fn webview_label(profile_key: &str) -> String {
    format!("{WEBVIEW_LABEL_PREFIX}-{profile_key}")
}

// Webview labels remain per service account; only the disk profile is shared.
fn session_key_from_accounts(accounts: &serde_json::Value, service: &str, account_id: &str) -> Result<String, String> {
    let own_key = profile_key(service, account_id)?;
    if let Some(account) = accounts.as_array().and_then(|rows| rows.iter().find(|row| {
        row.get("id").and_then(|v| v.as_str()) == Some(account_id)
            && row.get("service").and_then(|v| v.as_str()).unwrap_or("flow") == service
    })) {
        if let Some(source) = account.get("flowSessionId") {
            if service == "flow" { return Err("Flow profiles cannot link to another session".into()); }
            let source_id = source.as_str().ok_or("invalid Flow session id")?;
            return profile_key("flow", source_id);
        }
    }
    Ok(own_key)
}

fn session_key<R: Runtime>(app: &AppHandle<R>, service: &str, account_id: &str) -> Result<String, String> {
    let accounts = crate::account_store::load_accounts(app.clone())?.unwrap_or(serde_json::Value::Null);
    session_key_from_accounts(&accounts, service, account_id)
}

#[cfg(test)]
mod session_tests {
    use super::session_key_from_accounts;
    use serde_json::json;

    #[test]
    fn legacy_and_normal_profiles_keep_their_existing_directories() {
        let accounts = json!([{"id":"a","name":"Original"}, {"id":"b","service":"chatgpt"}]);
        assert_eq!(session_key_from_accounts(&accounts, "flow", "a").unwrap(), "flow-a");
        assert_eq!(session_key_from_accounts(&accounts, "chatgpt", "b").unwrap(), "chatgpt-b");
        assert_eq!(session_key_from_accounts(&accounts, "claude", "new").unwrap(), "claude-new");
    }

    #[test]
    fn selected_identity_survives_rename_and_source_card_deletion() {
        let accounts = json!([
            {"id":"a","service":"flow","name":"Renamed Flow"},
            {"id":"b","service":"chatgpt","name":"GPT Work","flowSessionId":"a"},
            {"id":"c","service":"dola","flowSessionId":"other"}
        ]);
        assert_eq!(session_key_from_accounts(&accounts, "chatgpt", "b").unwrap(), "flow-a");
        assert_eq!(session_key_from_accounts(&accounts, "dola", "c").unwrap(), "flow-other");
        assert_eq!(session_key_from_accounts(&accounts, "claude", "unlinked").unwrap(), "claude-unlinked");
        let remaining = json!([accounts[1].clone()]);
        assert_eq!(session_key_from_accounts(&remaining, "chatgpt", "b").unwrap(), "flow-a");
    }

    #[test]
    fn linked_ids_cannot_escape_the_profile_root() {
        let accounts = json!([{"id":"b","service":"chatgpt","flowSessionId":"../other"}]);
        assert!(session_key_from_accounts(&accounts, "chatgpt", "b").is_err());
        let accounts = json!([{"id":"a","service":"flow","flowSessionId":"b"}]);
        assert!(session_key_from_accounts(&accounts, "flow", "a").is_err());
    }
}

fn touch_account(state: &WebviewManager, account_id: &str) -> Result<(), String> {
    let mut counter = state
        .usage_counter
        .lock()
        .map_err(|_| "webview state unavailable")?;
    *counter = counter.wrapping_add(1);
    let mut cached = state
        .cached_accounts
        .lock()
        .map_err(|_| "webview state unavailable")?;
    cached.insert(account_id.to_string(), *counter);
    Ok(())
}

fn validate_account_id(account_id: &str) -> Result<(), String> {
    if account_id.is_empty()
        || account_id.len() > 128
        || !account_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        return Err("invalid account id".to_string());
    }
    Ok(())
}

fn profile_path<R: Runtime>(app: &AppHandle<R>, profile_key: &str) -> Result<PathBuf, String> {
    let root = app
        .path()
        .resolve("webview-profiles", BaseDirectory::AppLocalData)
        .map_err(|e| e.to_string())?;
    let profile = root.join(profile_key);
    if profile.parent() != Some(root.as_path()) {
        return Err("invalid account profile path".to_string());
    }
    Ok(profile)
}

fn reserve_loopback_port() -> Result<u16, String> {
    let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .map_err(|error| error.to_string())?;
    listener.local_addr().map(|address| address.port()).map_err(|error| error.to_string())
}

fn flow_browser_args(port: u16) -> String {
    format!("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port={port} --remote-allow-origins=*")
}

fn flow_builder<R: Runtime>(label: String, url: WebviewUrl, profile: PathBuf, browser_args: &str) -> WebviewBuilder<R> {
    WebviewBuilder::new(label, url)
        .data_directory(profile)
        .additional_browser_args(browser_args)
}

#[cfg(windows)]
fn attach_popup_window_close_handler<R: Runtime>(
    popup: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    let app = popup.app_handle().clone();
    let popup_label = popup.label().to_string();
    // WebView2's window.close() request must close the TOP-LEVEL Tauri popup,
    // not just the native WebView container. Register only for our popups:
    // never close the service workspace or a shared Google Flow profile.
    popup.with_webview(move |platform| {
        let result = (|| -> Result<(), String> {
            let native = unsafe { platform.controller().CoreWebView2() }
                .map_err(|error| error.to_string())?;
            let callback_app = app.clone();
            let callback_label = popup_label.clone();
            let mut token = Default::default();
            unsafe {
                native.add_WindowCloseRequested(
                    &WindowCloseRequestedEventHandler::create(Box::new(move |_, _| {
                        let dispatch_app = callback_app.clone();
                        let close_app = callback_app.clone();
                        let close_label = callback_label.clone();
                        // Dispatch AFTER WebView2's event returns to avoid
                        // destroying a WebView from its own COM callback.
                        let _ = dispatch_app.run_on_main_thread(move || {
                            if let Some(window) = close_app.get_webview_window(&close_label) {
                                let _ = window.close();
                            }
                        });
                        Ok(())
                    })),
                    &mut token,
                )
            }
            .map_err(|error| error.to_string())?;
            Ok(())
        })();
        if let Err(error) = result {
            eprintln!("[flowpilot-webview] OAuth popup close handler unavailable: {error}");
        }
    })
    .map_err(|error| error.to_string())
}

#[cfg(not(windows))]
fn attach_popup_window_close_handler<R: Runtime>(
    _popup: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    Ok(())
}



#[cfg(windows)]
fn close_maintenance_webview<R: Runtime>(app: &AppHandle<R>, label: String) {
    let close_app = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(webview) = close_app.get_webview(&label) {
            let _ = webview.close();
        }
    });
}

#[cfg(windows)]
fn begin_windows_disk_cache_clear<R: Runtime>(
    app: &AppHandle<R>,
    profile_key: &str,
    profile: PathBuf,
) -> Result<std::sync::mpsc::Receiver<Result<(), String>>, String> {
    let regular_label = webview_label(profile_key);
    let maintenance_label = format!("flowpilot-cache-maintenance-{profile_key}");
    let (target, temporary) = if let Some(webview) = app.get_webview(&regular_label) {
        (webview, false)
    } else if let Some(webview) = app.get_webview(&maintenance_label) {
        (webview, true)
    } else {
        let window = app
            .get_window("main")
            .ok_or_else(|| "main window not found".to_string())?;
        let url = WebviewUrl::External(
            "about:blank"
                .parse()
                .map_err(|_| "invalid maintenance WebView URL")?,
        );
        let builder = WebviewBuilder::new(maintenance_label.clone(), url)
            .data_directory(profile)
            .focused(false);
        let webview = window
            .add_child(
                builder,
                tauri::LogicalPosition::new(-10_000.0, -10_000.0),
                tauri::LogicalSize::new(1.0, 1.0),
            )
            .map_err(|e| e.to_string())?;
        webview.hide().map_err(|e| e.to_string())?;
        (webview, true)
    };

    let target_label = if temporary {
        maintenance_label
    } else {
        regular_label
    };
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    let scheduling_sender = sender.clone();
    let completion_app = app.clone();
    let completion_label = target_label.clone();
    let scheduling_app = app.clone();
    let scheduling_label = target_label.clone();

    let with_webview_result = target.with_webview(move |platform| {
        let start_result = (|| -> Result<(), String> {
            let native = unsafe { platform.controller().CoreWebView2() }
                .map_err(|e| e.to_string())?;
            let webview13 = native
                .cast::<ICoreWebView2_13>()
                .map_err(|e| e.to_string())?;
            let profile = unsafe { webview13.Profile() }.map_err(|e| e.to_string())?;
            let profile2 = profile
                .cast::<ICoreWebView2Profile2>()
                .map_err(|e| e.to_string())?;
            let completion = ClearBrowsingDataCompletedHandler::create(Box::new(
                move |result| {
                    let _ = sender.send(result.map_err(|e| e.to_string()));
                    if temporary {
                        close_maintenance_webview(&completion_app, completion_label);
                    }
                    Ok(())
                },
            ));
            unsafe {
                profile2.ClearBrowsingData(
                    COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE,
                    &completion,
                )
            }
            .map_err(|e| e.to_string())
        })();

        if let Err(error) = start_result {
            let _ = scheduling_sender.send(Err(error));
            if temporary {
                close_maintenance_webview(&scheduling_app, scheduling_label);
            }
        }
    });

    if let Err(error) = with_webview_result {
        if temporary {
            close_maintenance_webview(app, target_label);
        }
        return Err(error.to_string());
    }
    Ok(receiver)
}

pub fn begin_clear_disk_cache<R: Runtime>(
    app: &AppHandle<R>,
    account_id: String,
    service: String,
) -> Result<Option<std::sync::mpsc::Receiver<Result<(), String>>>, String> {
    let key = profile_key(&service, &account_id)?;
    let profile = profile_path(app, &session_key(app, &service, &account_id)?)?;
    if !profile.exists() {
        return Ok(None);
    }

    #[cfg(windows)]
    {
        let state = app.state::<WebviewManager>();
        let _operation = state
            .operation
            .lock()
            .map_err(|_| "webview state unavailable")?;
        begin_windows_disk_cache_clear(app, &key, profile).map(Some)
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("cache clearing is only supported on Windows".to_string())
    }
}

fn validate_bounds(x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    if ![x, y, width, height].iter().all(|value| value.is_finite())
        || x < 0.0
        || y < 0.0
        || width <= 0.0
        || height <= 0.0
    {
        return Err("invalid WebView bounds".to_string());
    }
    Ok(())
}

pub fn open<R: Runtime>(
    app: &AppHandle<R>, account_id: String, service: String,
    x: f64, y: f64, width: f64, height: f64,
) -> Result<(), String> {
    open_view(app, account_id, service, x, y, width, height, false)
}

fn open_view<R: Runtime>(
    app: &AppHandle<R>,
    account_id: String,
    service: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    background: bool,
) -> Result<(), String> {
    let state = app.state::<WebviewManager>();
    let operation = state
        .operation
        .lock()
        .map_err(|_| "webview state unavailable")?;
    let key = profile_key(&service, &account_id)?;
    validate_bounds(x, y, width, height)?;
    let window = app
        .get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    let requested_label = webview_label(&key);
    let active_account = state
        .active_account_id
        .lock()
        .map_err(|_| "webview state unavailable")?
        .clone();
    if !background {
        if let Some(active_id) = active_account.as_deref() {
            if active_id != key {
                if let Some(webview) = app.get_webview(&webview_label(active_id)) {
                    webview.hide().map_err(|e| e.to_string())?;
                }
            }
        }
    }
    if let Some(webview) = app.get_webview(&requested_label) {
        if background { return Ok(()); }
        webview
            .set_position(tauri::LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        webview
            .set_size(tauri::LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
        webview.show().map_err(|e| e.to_string())?;
        *state
            .active_account_id
            .lock()
            .map_err(|_| "webview state unavailable")? = Some(key.clone());
        *state
            .visible
            .lock()
            .map_err(|_| "webview state unavailable")? = true;
        touch_account(&state, &key)?;
        return Ok(());
    }

    let storage_key = session_key(app, &service, &account_id)?;
    let profile = profile_path(app, &storage_key)?;
    let url = WebviewUrl::External(
        service_url(&service)?
            .parse()
        .map_err(|_| "invalid service URL")?,
    );
    let popup_app = app.clone();
    let relogin_source_id = if service == "flow" { Some(account_id.clone()) } else { None };
    let popup_relogin_id = relogin_source_id.clone();
    let popup_prefix = format!("{requested_label}-popup-");
    let popup_profile = profile.clone();
    // Every WebView sharing the Flow directory must use identical browser arguments.
    let flow_environment = if storage_key.starts_with("flow-") {
        let mut ports = state.browser_profile_ports.lock().map_err(|_| "webview state unavailable")?;
        let port = match ports.get(&storage_key) {
            Some(port) => *port,
            None => {
                let port = reserve_loopback_port()?;
                ports.insert(storage_key.clone(), port);
                port
            }
        };
        Some((port, flow_browser_args(port)))
    } else {
        None
    };
    let popup_flow_args = flow_environment.as_ref().map(|(_, args)| args.clone());
    let builder = if let Some((_, browser_args)) = &flow_environment {
        flow_builder(requested_label.clone(), url, profile, browser_args)
    } else {
        WebviewBuilder::new(requested_label.clone(), url).data_directory(profile)
    }
        .focused(!background)
        .on_download(crate::native_downloads::handle)
        .on_page_load(move |webview, payload| {
            if let Some(id) = &relogin_source_id {
                crate::google_relogin::on_page_load(&webview, payload, id);
            }
        })
        .on_navigation(|url| url.scheme() == "https" || url.scheme() == "blob")
        .on_new_window(move |url, features| {
            if url.scheme() == "https" || url.scheme() == "blob" || url.as_str() == "about:blank" {
                // window_features retains the opener environment and OAuth popup relationship.
                let popup_builder = tauri::WebviewWindowBuilder::new(
                    &popup_app,
                    format!("{}{}", popup_prefix, uuid::Uuid::new_v4()),
                    WebviewUrl::External("about:blank".parse().expect("valid blank URL")),
                )
                .data_directory(popup_profile.clone())
                .window_features(features)
                .title("Flowpilot — service window")
                .on_page_load({
                    let flow_id = popup_relogin_id.clone();
                    move |webview, payload| {
                        if let Some(id) = &flow_id {
                            crate::google_relogin::on_page_load(webview.as_ref(), payload, id);
                        }
                    }
                })
                .on_download(crate::native_downloads::handle)
                .inner_size(520.0, 720.0)
                .on_navigation(|url| url.scheme() == "https" || url.scheme() == "blob" || url.as_str() == "about:blank")
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
                let popup = if let Some(browser_args) = &popup_flow_args {
                    popup_builder.additional_browser_args(browser_args).build()
                } else {
                    popup_builder.build()
                };
                match popup {
                    Ok(window) => {
                        // Keep the opener relationship for Google OAuth and
                        // preserve the shared browser profile/cookies.
                        if let Err(error) = attach_popup_window_close_handler(&window) {
                            eprintln!("[flowpilot-webview] popup close setup failed: {error}");
                        }
                        return tauri::webview::NewWindowResponse::Create { window };
                    }
                    Err(error) => eprintln!("[flowpilot-webview] sign-in window failed: {error}"),
                }
            }
            tauri::webview::NewWindowResponse::Deny
        });
    window
        .add_child(
            builder,
            tauri::LogicalPosition::new(if background { -10000.0 } else { x }, if background { -10000.0 } else { y }),
            tauri::LogicalSize::new(width, height),
        )
        .map_err(|e| e.to_string())?;
    if let Some((port, _)) = flow_environment {
        state.automation_ports.lock().map_err(|_| "webview state unavailable")?.insert(key.clone(), port);
    }

    #[cfg(all(windows, feature = "diag"))]
    if let Some(webview) = app.get_webview(&requested_label) {
        let diagnostic_label = requested_label.clone();
        webview
            .with_webview(move |platform| {
                if let Ok(native) = unsafe { platform.controller().CoreWebView2() } {
                    let _ = crate::webview_diagnostics::attach(&native, &diagnostic_label);
                }
            })
            .map_err(|e| e.to_string())?;
    }

    if background {
        if let Some(webview) = app.get_webview(&requested_label) {
            webview.hide().map_err(|e| e.to_string())?;
        }
        touch_account(&state, &key)?;
        return Ok(());
    }
    *state
        .active_account_id
        .lock()
        .map_err(|_| "webview state unavailable")? = Some(key.clone());
    *state
        .visible
        .lock()
        .map_err(|_| "webview state unavailable")? = true;
    touch_account(&state, &key)?;
    drop(operation);
    Ok(())
}

pub fn open_automation_session<R: Runtime>(app: &AppHandle<R>, account_id: String) -> Result<u16, String> {
    validate_account_id(&account_id)?;
    let accounts = crate::account_store::load_accounts(app.clone())?
        .ok_or_else(|| "FlowPilot has no saved accounts".to_string())?;
    let is_flow_account = accounts.as_array().is_some_and(|rows| rows.iter().any(|row| {
        row.get("id").and_then(|value| value.as_str()) == Some(account_id.as_str())
            && row.get("service").and_then(|value| value.as_str()).unwrap_or("flow") == "flow"
    }));
    if !is_flow_account {
        return Err("The requested Google Flow account does not exist in FlowPilot".to_string());
    }

    let key = profile_key("flow", &account_id)?;
    let state = app.state::<WebviewManager>();
    let profile = profile_path(app, &key)?;
    let regular_label = webview_label(&key);
    if let Some(webview) = app.get_webview(&regular_label) {
        webview.navigate(service_url("flow")?.parse().map_err(|_| "invalid Flow URL")?)
            .map_err(|error| error.to_string())?;
        webview.show().map_err(|error| error.to_string())?;
        touch_account(&state, &key)?;
        return state.automation_ports.lock().map_err(|_| "webview state unavailable".to_string())?
            .get(&key).copied()
            .ok_or_else(|| "The Flow WebView does not have an automation endpoint. Restart FlowPilot.".to_string());
    }

    let label = format!("{AUTOMATION_LABEL_PREFIX}-{key}");
    if let Some(window) = app.get_webview_window(&label) {
        window.navigate(service_url("flow")?.parse().map_err(|_| "invalid Flow URL")?)
            .map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        touch_account(&state, &key)?;
        return state.automation_ports.lock().map_err(|_| "webview state unavailable".to_string())?
            .get(&key).copied()
            .ok_or_else(|| "The Flow automation window has no registered endpoint. Restart FlowPilot.".to_string());
    }

    let port = reserve_loopback_port()?;
    let browser_args = flow_browser_args(port);
    tauri::WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::External(service_url("flow")?.parse().map_err(|_| "invalid Flow URL")?),
    )
    .data_directory(profile)
    .additional_browser_args(&browser_args)
    .title("FlowPilot — AutoPrompt session")
    .inner_size(1280.0, 800.0)
    .visible(true)
    .focused(true)
    .on_download(crate::native_downloads::handle)
    .on_navigation(|url| url.scheme() == "https" || url.scheme() == "blob")
    .build()
    .map_err(|error| error.to_string())?;
    state.automation_ports.lock().map_err(|_| "webview state unavailable")?.insert(key.clone(), port);
    touch_account(&state, &key)?;
    Ok(port)
}

// Bulk sharing only creates service WebViews that reference existing Flow
// directories. Never delete or clear a source profile during the batch.
pub fn begin_bulk_shared_login<R: Runtime>(
    app: &AppHandle<R>, account_id: String, service: String,
) -> Result<bool, String> {
    if service == "flow" { return Err("Bulk shared login needs a destination service".into()); }
    let key = profile_key(&service, &account_id)?;
    let accounts = crate::account_store::load_accounts(app.clone())?
        .ok_or("Account storage unavailable")?;
    let rows = accounts.as_array().ok_or("Invalid account storage")?;
    let account = rows.iter().find(|row|
        row.get("id").and_then(|v| v.as_str()) == Some(account_id.as_str()) &&
        row.get("service").and_then(|v| v.as_str()) == Some(service.as_str())
    ).ok_or("Linked destination account was not saved")?;
    let source_id = account.get("flowSessionId").and_then(|v| v.as_str())
        .ok_or("Account does not have a linked Flow session")?;
    let source_exists = rows.iter().any(|row|
        row.get("id").and_then(|v| v.as_str()) == Some(source_id) &&
        row.get("service").and_then(|v| v.as_str()).unwrap_or("flow") == "flow"
    );
    if !source_exists || !profile_path(app, &profile_key("flow", source_id)?)?.exists() {
        return Err("invalid_flow_session".into());
    }
    let created = app.get_webview(&webview_label(&key)).is_none();
    open_view(app, account_id, service, 0.0, 0.0, 980.0, 720.0, true)?;
    Ok(created)
}

// Only evaluate our local, fixed scripts on the matching service or Google
// chooser. Remote pages never receive native Tauri capabilities or secrets.
pub fn evaluate_bulk_shared_login<R: Runtime>(
    app: &AppHandle<R>, account_id: String, service: String,
    expected_email: String, click_enabled: bool,
) -> Result<Vec<std::sync::mpsc::Receiver<String>>, String> {
    let key = profile_key(&service, &account_id)?;
    let label = webview_label(&key);
    let mut responses = Vec::new();
    let mut evaluate = |view: &tauri::Webview<R>| -> Result<(), String> {
        let url = view.url().map_err(|e| e.to_string())?;
        if url.scheme() != "https" { return Ok(()); }
        let host = url.host_str().unwrap_or("");
        let google = host == "accounts.google.com";
        let allowed = match service.as_str() {
            "claude" => matches!(host, "claude.ai"),
            "chatgpt" => matches!(host, "chatgpt.com" | "auth.openai.com"),
            "leonardo" => matches!(host, "app.leonardo.ai" | "leonardo.ai"),
            "dola" => matches!(host, "www.dola.com" | "dola.com"),
            "migoo" => matches!(host, "migoo.ai" | "www.migoo.ai"),
            _ => false,
        };
        if !google && !allowed { return Ok(()); }
        let js = if google {
            include_str!("bulk_shared_google_chooser.js")
                .replace("__FLOWPILOT_EXPECTED_EMAIL__", &serde_json::to_string(&expected_email).map_err(|e| e.to_string())?)
                .replace("__FLOWPILOT_CAN_CLICK__", if click_enabled { "true" } else { "false" })
        } else {
            include_str!("bulk_shared_service_login.js")
                .replace("__FLOWPILOT_SERVICE__", &serde_json::to_string(&service).map_err(|e| e.to_string())?)
                .replace("__FLOWPILOT_CAN_CLICK__", if click_enabled { "true" } else { "false" })
        };
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        view.eval_with_callback(js, move |result| {
            let _ = tx.send(result);
        }).map_err(|e| e.to_string())?;
        responses.push(rx);
        Ok(())
    };
    if let Some(view) = app.get_webview(&label) { evaluate(&view)?; }
    for (popup_label, popup) in app.webview_windows() {
        if popup_label.starts_with(&format!("{label}-popup-")) {
            evaluate(popup.as_ref())?;
        }
    }
    Ok(responses)
}

pub fn finish_bulk_shared_login<R: Runtime>(
    app: &AppHandle<R>, account_id: String, service: String, created: bool,
) -> Result<(), String> {
    let key = profile_key(&service, &account_id)?;
    let state = app.state::<WebviewManager>();
    let _lock = state.operation.lock().map_err(|_| "webview state unavailable")?;
    let label = webview_label(&key);
    // Any lingering batch OAuth popup is specific to this destination account.
    for (popup_label, popup) in app.webview_windows() {
        if popup_label.starts_with(&format!("{label}-popup-")) {
            popup.close().map_err(|error| error.to_string())?;
        }
    }
    if created {
        if let Some(view) = app.get_webview(&label) {
            view.close().map_err(|error| error.to_string())?;
        }
        state.cached_accounts.lock().map_err(|_| "webview state unavailable")?.remove(&key);
        state.automation_ports.lock().map_err(|_| "webview state unavailable")?.remove(&key);
    }
    Ok(())
}

const FLOW_CHECK_URL: &str = "https://flow.google.com/";

// A manual re-login scan opens at most one temporary profile at a time.
// Existing cached WebViews are reused without changing the active account.
pub fn begin_flow_profile_check<R: Runtime>(app: &AppHandle<R>, account_id: String) -> Result<Option<bool>, String> {
    let key = profile_key("flow", &account_id)?;
    let accounts = crate::account_store::load_accounts(app.clone())?
        .ok_or_else(|| "Account storage unavailable".to_string())?;
    let exists = accounts.as_array().is_some_and(|rows| rows.iter().any(|row| {
        row.get("id").and_then(|value| value.as_str()) == Some(account_id.as_str())
            && row.get("service").and_then(|value| value.as_str()).unwrap_or("flow") == "flow"
    }));
    if !exists { return Err("Google Flow profile not found".into()); }
    // Do not initiate a fresh login for profiles that have never been opened.
    if !profile_path(app, &key)?.exists() { return Ok(None); }
    let label = webview_label(&key);
    let created = app.get_webview(&label).is_none();
    if created {
        open_view(app, account_id, "flow".into(), 0.0, 0.0, 980.0, 720.0, true)?;
    }
    let webview = app.get_webview(&label).ok_or("Flow WebView was not created")?;
    webview.navigate(FLOW_CHECK_URL.parse().map_err(|_| "Invalid Flow check URL")?)
        .map_err(|error| error.to_string())?;
    Ok(Some(created))
}

pub fn poll_flow_profile_check<R: Runtime>(app: &AppHandle<R>, account_id: String) -> Result<String, String> {
    let key = profile_key("flow", &account_id)?;
    let view = app.get_webview(&webview_label(&key)).ok_or("Flow WebView is no longer open")?;
    view.url().map(|url| url.to_string()).map_err(|error| error.to_string())
}

pub fn click_flow_relogin_entry<R: Runtime>(app: &AppHandle<R>, account_id: String) -> Result<(), String> {
    let key = profile_key("flow", &account_id)?;
    let view = app.get_webview(&webview_label(&key)).ok_or("Flow WebView is no longer open")?;
    let current = view.url().map_err(|error| error.to_string())?;
    if current.scheme() != "https" || current.host_str() != Some("flow.google.com") || current.path() != "/about" {
        return Err("Flow is not on the signed-out landing page".into());
    }
    // No password is ever used here; login proceeds through Google's ordinary OAuth UI.
    // Fail closed if Flow changes the landing-page button markup.
    view.eval(include_str!("flow_landing_relogin.js")).map_err(|error| error.to_string())
}

pub fn finish_flow_profile_check<R: Runtime>(app: &AppHandle<R>, account_id: String, created: bool) -> Result<(), String> {
    if !created { return Ok(()); }
    let state = app.state::<WebviewManager>();
    let key = profile_key("flow", &account_id)?;
    let _lock = state.operation.lock().map_err(|_| "webview state unavailable")?;
    let label = webview_label(&key);
    // Close temporary OAuth popups too. Do not leave CAPTCHA/verification
    // windows open when scanning the next profile.
    let popup_prefix = format!("{label}-popup-");
    for (popup_label, popup) in app.webview_windows() {
        if popup_label.starts_with(&popup_prefix) {
            popup.close().map_err(|error| error.to_string())?;
        }
    }
    if let Some(view) = app.get_webview(&label) {
        view.close().map_err(|error| error.to_string())?;
    }
    state.cached_accounts.lock().map_err(|_| "webview state unavailable")?.remove(&key);
    state.automation_ports.lock().map_err(|_| "webview state unavailable")?.remove(&key);
    Ok(())
}

// These operations run on the UI thread. Epochs reject stale queued preload work.
fn cancel_preloads(state: &WebviewManager) -> Result<u64, String> {
    let mut epoch = state.preload_epoch.lock().map_err(|_| "webview state unavailable")?;
    *epoch = epoch.wrapping_add(1);
    state.preload_targets.lock().map_err(|_| "webview state unavailable")?.clear();
    Ok(*epoch)
}

fn destroy_views<R: Runtime>(app: &AppHandle<R>, service: Option<&str>, keep: &[String]) -> Result<(), String> {
    let state = app.state::<WebviewManager>();
    let keys: Vec<String> = state.cached_accounts.lock().map_err(|_| "webview state unavailable")?
        .keys().filter(|key| service.map_or(true, |s| key.starts_with(&format!("{s}-"))) && !keep.contains(key)).cloned().collect();
    for key in keys {
        let label = webview_label(&key);
        for (popup_label, popup) in app.webview_windows() {
            if popup_label.starts_with(&format!("{label}-popup-")) { popup.close().map_err(|e| e.to_string())?; }
        }
        crate::webview_download_bridge::cancel_for_webview(&app.state::<crate::webview_download_bridge::DownloadState>(), &label);
        if let Some(webview) = app.get_webview(&label) { webview.close().map_err(|e| e.to_string())?; }
        state.cached_accounts.lock().map_err(|_| "webview state unavailable")?.remove(&key);
        state.automation_ports.lock().map_err(|_| "webview state unavailable")?.remove(&key);
        let mut active = state.active_account_id.lock().map_err(|_| "webview state unavailable")?;
        if active.as_deref() == Some(key.as_str()) {
            *active = None;
            *state.visible.lock().map_err(|_| "webview state unavailable")? = false;
        }
    }
    Ok(())
}

pub fn prepare_workspace<R: Runtime>(app: &AppHandle<R>, account_id: String, service: String,
    neighbors: Vec<String>, x: f64, y: f64, width: f64, height: f64) -> Result<u64, String> {
    if neighbors.len() > 10 { return Err("too many preload neighbors".into()); }
    let state = app.state::<WebviewManager>();
    let mut keep = vec![profile_key(&service, &account_id)?];
    for id in &neighbors { keep.push(profile_key(&service, id)?); }
    let epoch = cancel_preloads(&state)?;
    destroy_views(app, Some(&service), &keep)?;
    open(app, account_id, service, x, y, width, height)?;
    *state.preload_targets.lock().map_err(|_| "webview state unavailable")? = keep;
    Ok(epoch)
}

pub fn preload_workspace<R: Runtime>(app: &AppHandle<R>, account_id: String, service: String,
    epoch: u64, width: f64, height: f64) -> Result<(), String> {
    let state = app.state::<WebviewManager>();
    if *state.preload_epoch.lock().map_err(|_| "webview state unavailable")? != epoch { return Ok(()); }
    let key = profile_key(&service, &account_id)?;
    if !state.preload_targets.lock().map_err(|_| "webview state unavailable")?.contains(&key) { return Ok(()); }
    open_view(app, account_id, service, 0.0, 0.0, width, height, true)
}

pub fn close_workspaces<R: Runtime>(app: &AppHandle<R>, service: Option<String>) -> Result<(), String> {
    if let Some(s) = &service { service_url(s)?; }
    cancel_preloads(&app.state::<WebviewManager>())?;
    destroy_views(app, service.as_deref(), &[])
}

fn parse_bookmark_url(service: &str, url: &str) -> Result<tauri::Url, String> {
    let parsed: tauri::Url = url
        .parse()
        .map_err(|_| "invalid bookmark URL".to_string())?;
    let valid_target = parsed.scheme() == "https"
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && match service {
            "flow" => {
                (parsed.host_str() == Some("flow.google.com")
                    && (parsed.path() == "/" || parsed.path().starts_with("/project/")
                        || parsed.path().starts_with("/library")))
                || (parsed.host_str() == Some("labs.google")
                    && (parsed.path() == "/fx/tools/flow"
                        || parsed.path().starts_with("/fx/tools/flow/")))
            }
            "chatgpt" => parsed.host_str() == Some("chatgpt.com"),
            _ => false,
        };
    if valid_target {
        Ok(parsed)
    } else {
        Err(format!("unsupported {service} bookmark URL"))
    }
}

pub fn navigate_service_bookmark<R: Runtime>(
    app: &AppHandle<R>,
    account_id: String,
    service: String,
    url: String,
) -> Result<(), String> {
    let parsed = parse_bookmark_url(&service, &url)?;
    let key = profile_key(&service, &account_id)?;
    let state = app.state::<WebviewManager>();
    let _operation = state
        .operation
        .lock()
        .map_err(|_| "webview state unavailable")?;
    let active_account = state
        .active_account_id
        .lock()
        .map_err(|_| "webview state unavailable")?
        .clone();
    if active_account.as_deref() != Some(key.as_str()) {
        return Err(format!("{service} account is not active"));
    }
    let webview = app
        .get_webview(&webview_label(&key))
        .ok_or_else(|| format!("{service} WebView is not open"))?;
    webview.navigate(parsed).map_err(|e| e.to_string())?;
    touch_account(&state, &key)
}

pub fn close<R: Runtime>(app: &AppHandle<R>, account_id: Option<String>, service: Option<String>) -> Result<(), String> {
    let state = app.state::<WebviewManager>();
    let operation = state
        .operation
        .lock()
        .map_err(|_| "webview state unavailable")?;
    let active_account = state
        .active_account_id
        .lock()
        .map_err(|_| "webview state unavailable")?
        .clone();
    if let Some(active_id) = active_account {
        let requested_key = match (account_id.as_deref(), service.as_deref()) {
            (Some(id), Some(service)) => Some(profile_key(service, id)?),
            _ => None,
        };
        if account_id
            .as_deref()
            .map_or(true, |_| requested_key.as_deref() == Some(active_id.as_str()))
        {
            cancel_preloads(&state)?;
            if let Some(webview) = app.get_webview(&webview_label(&active_id)) {
                webview.hide().map_err(|e| e.to_string())?;
            }
            *state.visible.lock().map_err(|_| "webview state unavailable")? = false;
        }
    }
    drop(operation);
    Ok(())
}

pub fn resize<R: Runtime>(
    app: &AppHandle<R>,
    account_id: String,
    service: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    validate_bounds(x, y, width, height)?;
    let key = profile_key(&service, &account_id)?;
    let state = app.state::<WebviewManager>();
    let active_account = state
        .active_account_id
        .lock()
        .map_err(|_| "webview state unavailable")?
        .clone();
    if active_account.as_deref() != Some(key.as_str()) {
        return Ok(());
    }
    if let Some(webview) = app.get_webview(&webview_label(&key)) {
        webview
            .set_position(tauri::LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        webview
            .set_size(tauri::LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn remove<R: Runtime>(app: &AppHandle<R>, account_id: String, service: String) -> Result<bool, String> {
    let key = profile_key(&service, &account_id)?;
    let accounts = crate::account_store::load_accounts(app.clone())?.unwrap_or(serde_json::Value::Null);
    let storage_key = session_key_from_accounts(&accounts, &service, &account_id)?;
    let mut affected = vec![key.clone()];
    if let Some(rows) = accounts.as_array() {
        for row in rows {
            let Some(id) = row.get("id").and_then(|v| v.as_str()) else { continue };
            let service = row.get("service").and_then(|v| v.as_str()).unwrap_or("flow");
            if session_key_from_accounts(&accounts, service, id)? == storage_key {
                let linked_key = profile_key(service, id)?;
                if !affected.contains(&linked_key) { affected.push(linked_key); }
            }
        }
    }
    let state = app.state::<WebviewManager>();
    cancel_preloads(&state)?;
    let _operation = state
        .operation
        .lock()
        .map_err(|_| "webview state unavailable")?;
    for affected_key in &affected {
        let label = webview_label(affected_key);
        let popup_prefix = format!("{label}-popup-");
        for (popup_label, popup) in app.webview_windows() {
            if popup_label.starts_with(&popup_prefix) {
                popup.close().map_err(|e| e.to_string())?;
            }
        }
        crate::webview_download_bridge::cancel_for_webview(
            &app.state::<crate::webview_download_bridge::DownloadState>(), &label,
        );
        if let Some(webview) = app.get_webview(&label) {
            webview.close().map_err(|e| e.to_string())?;
        }
        let maintenance = format!("flowpilot-cache-maintenance-{affected_key}");
        if let Some(webview) = app.get_webview(&maintenance) {
            webview.close().map_err(|e| e.to_string())?;
        }
    }
    {
        let mut cached = state
            .cached_accounts
            .lock()
            .map_err(|_| "webview state unavailable")?;
        for affected_key in &affected { cached.remove(affected_key); }
    }
    {
        let mut active = state
            .active_account_id
            .lock()
            .map_err(|_| "webview state unavailable")?;
        if active.as_ref().is_some_and(|key| affected.contains(key)) {
            *active = None;
            *state
                .visible
                .lock()
                .map_err(|_| "webview state unavailable")? = false;
        }
    }

    let profile = profile_path(app, &storage_key)?;
    if !profile.exists() {
        return Ok(true);
    }
    match std::fs::remove_dir_all(&profile) {
        Ok(()) => Ok(true),
        Err(error) => {
            eprintln!("[flowpilot-webview] profile cleanup pending account={account_id}: {error}");
            Ok(false)
        }
    }
}

#[cfg(test)]
mod preload_tests {
    use super::{cancel_preloads, parse_bookmark_url, WebviewManager};

    #[test]
    fn bookmark_urls_are_limited_to_the_active_service_domain() {
        assert!(parse_bookmark_url("flow", "https://labs.google/fx/tools/flow/project/123").is_ok());
        assert!(parse_bookmark_url("flow", "https://flow.google.com/project/123").is_ok());
        assert!(parse_bookmark_url("flow", "https://flow.google.com/about").is_err());
        assert!(parse_bookmark_url("chatgpt", "https://chatgpt.com/c/123").is_ok());
        assert!(parse_bookmark_url("flow", "https://chatgpt.com/c/123").is_err());
        assert!(parse_bookmark_url("chatgpt", "https://labs.google/fx/tools/flow").is_err());
        assert!(parse_bookmark_url("chatgpt", "https://example.com/").is_err());
        assert!(parse_bookmark_url("chatgpt", "https://user:pass@chatgpt.com/c/123").is_err());
    }

    #[test]
    fn cancelling_invalidates_queued_preloads_and_clears_targets() {
        let state = WebviewManager::default();
        let first = cancel_preloads(&state).unwrap();
        state.preload_targets.lock().unwrap().push("flow-a".into());
        let closed = cancel_preloads(&state).unwrap();
        assert_ne!(first, closed);
        assert!(state.preload_targets.lock().unwrap().is_empty());
        let reopened = cancel_preloads(&state).unwrap();
        assert_ne!(closed, reopened);
    }
}
