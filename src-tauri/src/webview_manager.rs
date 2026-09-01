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

const GOOGLE_FLOW_URL: &str = "https://flow.google";
const WEBVIEW_LABEL_PREFIX: &str = "google-flow";
const MAX_CACHED_WEBVIEWS: usize = 5;

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

fn webview_label(account_id: &str) -> String {
    format!("{WEBVIEW_LABEL_PREFIX}-{account_id}")
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

fn profile_path<R: Runtime>(app: &AppHandle<R>, account_id: &str) -> Result<PathBuf, String> {
    let root = app
        .path()
        .resolve("webview-profiles", BaseDirectory::AppLocalData)
        .map_err(|e| e.to_string())?;
    let profile = root.join(account_id);
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
    account_id: &str,
    profile: PathBuf,
) -> Result<std::sync::mpsc::Receiver<Result<(), String>>, String> {
    let regular_label = webview_label(account_id);
    let maintenance_label = format!("flowpilot-cache-maintenance-{account_id}");
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
) -> Result<Option<std::sync::mpsc::Receiver<Result<(), String>>>, String> {
    validate_account_id(&account_id)?;
    let profile = profile_path(app, &account_id)?;
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
        begin_windows_disk_cache_clear(app, &account_id, profile).map(Some)
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
    validate_account_id(&account_id)?;
    validate_bounds(x, y, width, height)?;
    let window = app
        .get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    let requested_label = webview_label(&account_id);
    let active_account = state
        .active_account_id
        .lock()
        .map_err(|_| "webview state unavailable")?
        .clone();
    if let Some(active_id) = active_account.as_deref() {
        if active_id != account_id {
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
            .map_err(|_| "webview state unavailable")? = Some(account_id.clone());
        *state
            .visible
            .lock()
            .map_err(|_| "webview state unavailable")? = true;
        touch_account(&state, &account_id)?;
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

    let profile = profile_path(app, &account_id)?;
    let url = WebviewUrl::External(
        GOOGLE_FLOW_URL
            .parse()
            .map_err(|_| "invalid Google Flow URL")?,
    );
    let builder = WebviewBuilder::new(requested_label.clone(), url)
        .data_directory(profile)
        .initialization_script_for_all_frames(crate::webview_download_bridge::INIT_SCRIPT)
        .on_navigation(|url| url.scheme() == "https")
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
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
        .map_err(|_| "webview state unavailable")? = Some(account_id.clone());
    *state
        .visible
        .lock()
        .map_err(|_| "webview state unavailable")? = true;
    touch_account(&state, &account_id)?;
    drop(operation);
    Ok(())
}

pub fn close<R: Runtime>(app: &AppHandle<R>, account_id: Option<String>) -> Result<(), String> {
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
        if account_id
            .as_deref()
            .map_or(true, |requested_id| requested_id == active_id)
        {
            if let Some(webview) = app.get_webview(&webview_label(&active_id)) {
                webview.hide().map_err(|e| e.to_string())?;
            }
            *state
                .visible
                .lock()
                .map_err(|_| "webview state unavailable")? = false;
        }
    }
    drop(operation);
    Ok(())
}

pub fn resize<R: Runtime>(
    app: &AppHandle<R>,
    account_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    validate_bounds(x, y, width, height)?;
    let state = app.state::<WebviewManager>();
    let active_account = state
        .active_account_id
        .lock()
        .map_err(|_| "webview state unavailable")?
        .clone();
    if active_account.as_deref() != Some(account_id.as_str()) {
        return Ok(());
    }
    if let Some(webview) = app.get_webview(&webview_label(&account_id)) {
        webview
            .set_position(tauri::LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        webview
            .set_size(tauri::LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn remove<R: Runtime>(app: &AppHandle<R>, account_id: String) -> Result<Option<PathBuf>, String> {
    validate_account_id(&account_id)?;
    let state = app.state::<WebviewManager>();
    let _operation = state
        .operation
        .lock()
        .map_err(|_| "webview state unavailable")?;
    let label = webview_label(&account_id);

    crate::webview_download_bridge::cancel_for_webview(
        &app.state::<crate::webview_download_bridge::DownloadState>(),
        &label,
    );
    if let Some(webview) = app.get_webview(&label) {
        webview.close().map_err(|e| e.to_string())?;
    }
    {
        let mut cached = state
            .cached_accounts
            .lock()
            .map_err(|_| "webview state unavailable")?;
        cached.remove(&account_id);
    }
    {
        let mut active = state
            .active_account_id
            .lock()
            .map_err(|_| "webview state unavailable")?;
        if active.as_deref() == Some(account_id.as_str()) {
            *active = None;
            *state
                .visible
                .lock()
                .map_err(|_| "webview state unavailable")? = false;
        }
    }

    let profile = profile_path(app, &account_id)?;
    if profile.exists() {
        Ok(Some(profile))
    } else {
        Ok(None)
    }
}
