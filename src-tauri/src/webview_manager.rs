use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::path::BaseDirectory;
use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, Manager, Runtime, WebviewUrl};

#[cfg(windows)]
use webview2_com::{
    ClearBrowsingDataCompletedHandler,
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Profile2, ICoreWebView2_13,
        COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE,
    },
};
#[cfg(windows)]
use windows::core::Interface;

const WEBVIEW_LABEL_PREFIX: &str = "flowpilot-service";
const MAX_CACHED_WEBVIEWS: usize = 10;

pub struct WebviewManager {
    active_account_id: Mutex<Option<String>>,
    visible: Mutex<bool>,
    cached_accounts: Mutex<HashMap<String, u64>>,
    usage_counter: Mutex<u64>,
    operation: Mutex<()>,
}

impl Default for WebviewManager {
    fn default() -> Self {
        Self {
            active_account_id: Mutex::new(None),
            visible: Mutex::new(false),
            cached_accounts: Mutex::new(HashMap::new()),
            usage_counter: Mutex::new(0),
            operation: Mutex::new(()),
        }
    }
}

fn service_url(service: &str) -> Result<&'static str, String> {
    match service {
        "flow" => Ok("https://labs.google/fx/tools/flow"),
        "dola" => Ok("https://www.dola.com/"),
        "leonardo" => Ok("https://app.leonardo.ai/"),
        "chatgpt" => Ok("https://chatgpt.com/"),
        "migoo" => Ok("https://migoo.ai/home"),
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
    app: &AppHandle<R>,
    account_id: String,
    service: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
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
    if let Some(active_id) = active_account.as_deref() {
        if active_id != key {
            if let Some(webview) = app.get_webview(&webview_label(active_id)) {
                webview.hide().map_err(|e| e.to_string())?;
            }
        }
    }

    if let Some(webview) = app.get_webview(&requested_label) {
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

    {
        let mut cached = state
            .cached_accounts
            .lock()
            .map_err(|_| "webview state unavailable")?;
        if cached.len() >= MAX_CACHED_WEBVIEWS {
            let eviction = cached
                .iter()
                .filter(|(id, _)| Some(id.as_str()) != active_account.as_deref())
                .min_by_key(|(_, last_used)| **last_used)
                .map(|(id, _)| id.clone());
            if let Some(evicted_id) = eviction {
                let evicted_label = webview_label(&evicted_id);
                crate::webview_download_bridge::cancel_for_webview(
                    &app.state::<crate::webview_download_bridge::DownloadState>(),
                    &evicted_label,
                );
                if let Some(webview) = app.get_webview(&evicted_label) {
                    webview.close().map_err(|e| e.to_string())?;
                }
                cached.remove(&evicted_id);
            }
        }
    }

    let storage_key = session_key(app, &service, &account_id)?;
    let shared_session = storage_key != key;
    let profile = profile_path(app, &storage_key)?;
    let url = WebviewUrl::External(
        service_url(&service)?
            .parse()
        .map_err(|_| "invalid service URL")?,
    );
    let popup_app = app.clone();
    let popup_prefix = format!("{requested_label}-popup-");
    let popup_profile = profile.clone();
    let builder = WebviewBuilder::new(requested_label.clone(), url)
        .data_directory(profile)
        .initialization_script_for_all_frames(crate::webview_download_bridge::INIT_SCRIPT)
        .on_navigation(|url| url.scheme() == "https")
        .on_new_window(move |url, features| {
            if shared_session && (url.scheme() == "https" || url.as_str() == "about:blank") {
                // window_features retains the opener environment and OAuth popup relationship.
                let popup = tauri::WebviewWindowBuilder::new(
                    &popup_app,
                    format!("{}{}", popup_prefix, uuid::Uuid::new_v4()),
                    WebviewUrl::External("about:blank".parse().expect("valid blank URL")),
                )
                .data_directory(popup_profile.clone())
                .window_features(features)
                .title("Sign in")
                .inner_size(520.0, 720.0)
                .on_navigation(|url| url.scheme() == "https" || url.as_str() == "about:blank")
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .build();
                match popup {
                    Ok(window) => return tauri::webview::NewWindowResponse::Create { window },
                    Err(error) => eprintln!("[flowpilot-webview] sign-in window failed: {error}"),
                }
            }
            tauri::webview::NewWindowResponse::Deny
        });
    window
        .add_child(
            builder,
            tauri::LogicalPosition::new(x, y),
            tauri::LogicalSize::new(width, height),
        )
        .map_err(|e| e.to_string())?;

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

pub fn navigate_flow_bookmark<R: Runtime>(
    app: &AppHandle<R>,
    account_id: String,
    url: String,
) -> Result<(), String> {
    let parsed: tauri::Url = url
        .parse()
        .map_err(|_| "invalid Google Flow bookmark URL".to_string())?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("labs.google")
        || !(parsed.path() == "/fx/tools/flow"
            || parsed.path().starts_with("/fx/tools/flow/"))
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("unsupported Google Flow bookmark URL".to_string());
    }

    let key = profile_key("flow", &account_id)?;
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
        return Err("Google Flow account is not active".to_string());
    }
    let webview = app
        .get_webview(&webview_label(&key))
        .ok_or_else(|| "Google Flow WebView is not open".to_string())?;
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
            if let Some(webview) = app.get_webview(&webview_label(&active_id)) {
                webview.hide().map_err(|e| e.to_string())?;
            }
        }
    }
    *state
        .visible
        .lock()
        .map_err(|_| "webview state unavailable")? = false;
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
