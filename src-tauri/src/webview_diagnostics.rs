//! Temporary, read-only WebView2 event instrumentation.
#![cfg(all(windows, feature = "diag"))]

use std::{fs::OpenOptions, io::Write, sync::{Arc, Mutex}, time::{SystemTime, UNIX_EPOCH}};
use webview2_com::{DownloadStartingEventHandler, NavigationCompletedEventHandler, NavigationStartingEventHandler, NewWindowRequestedEventHandler, SaveAsUIShowingEventHandler, WebMessageReceivedEventHandler, take_pwstr};
use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2, ICoreWebView2_25, ICoreWebView2SaveAsUIShowingEventArgs, ICoreWebView2NavigationStartingEventArgs};
use windows::core::{Interface, PWSTR};

type LogSink = Arc<Mutex<std::fs::File>>;

fn log_path() -> std::io::Result<std::path::PathBuf> {
    let dir = std::env::temp_dir().join("Flowpilot");
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("flowpilot_diag.log"))
}

fn log_event(sink: &LogSink, event: &str, detail: &str) {
    let epoch_ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or_default();
    if let Ok(mut file) = sink.lock() { let _ = writeln!(file, "{epoch_ms} event={event} {detail}"); let _ = file.flush(); }
}

pub fn command_event(event: &str, detail: &str) {
    let Ok(path) = log_path() else { return };
    let Ok(file) = OpenOptions::new().create(true).append(true).open(path) else { return };
    let sink = Arc::new(Mutex::new(file));
    log_event(&sink, event, detail);
}

fn safe_uri(args: &ICoreWebView2NavigationStartingEventArgs) -> String {
    let mut raw = PWSTR::null();
    if unsafe { args.Uri(&mut raw) }.is_err() { return "scheme=unavailable".into(); }
    format!("scheme={}", take_pwstr(raw).split(':').next().unwrap_or("other"))
}

pub fn attach(webview: &ICoreWebView2, label: &str) -> Result<(), String> {
    let path = log_path().map_err(|e| e.to_string())?;
    let file = OpenOptions::new().create(true).append(true).open(path).map_err(|e| e.to_string())?;
    let sink = Arc::new(Mutex::new(file));
    log_event(&sink, "InstrumentationAttached", &format!("webview={label}"));
    let mut token = 0;
    let s = sink.clone(); unsafe { webview.add_NavigationStarting(&NavigationStartingEventHandler::create(Box::new(move |_, args| { if let Some(a) = args { log_event(&s, "NavigationStarting", &safe_uri(&a)); } Ok(()) })), &mut token) }.map_err(|e| e.to_string())?;
    let s = sink.clone(); unsafe { webview.add_NavigationCompleted(&NavigationCompletedEventHandler::create(Box::new(move |_, _| { log_event(&s, "NavigationCompleted", ""); Ok(()) })), &mut token) }.map_err(|e| e.to_string())?;
    let s = sink.clone(); unsafe { webview.add_NewWindowRequested(&NewWindowRequestedEventHandler::create(Box::new(move |_, _| { log_event(&s, "NewWindowRequested", ""); Ok(()) })), &mut token) }.map_err(|e| e.to_string())?;
    let interaction_label = label.to_string();
    let s = sink.clone(); unsafe { webview.add_WebMessageReceived(&WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
        if let Some(args) = args {
            let mut raw = PWSTR::null();
            if args.TryGetWebMessageAsString(&mut raw).is_ok() {
                let message = take_pwstr(raw);
                // Accept only fixed diagnostic enums and boolean flags. A remote
                // page can post arbitrary messages; never log its raw payload.
                let fields: Vec<_> = message.split('|').collect();
                if fields.len() == 9 && fields[0] == "flowpilot-interaction"
                    && ["pointerdown", "pointerup", "click", "copy-event", "rejection", "focus", "blur", "visibility", "ready"].contains(&fields[1])
                    && ["copy", "other", "document", "NotAllowedError", "SecurityError", "TypeError", "AbortError"].contains(&fields[2])
                    && fields[3..].iter().all(|value| matches!(*value, "0" | "1")) {
                    log_event(&s, "ServiceInteraction", &format!("webview={} kind={} control={} focused={} visible={} activated={} prevented={} trusted={} hit={}", interaction_label, fields[1], fields[2], fields[3], fields[4], fields[5], fields[6], fields[7], fields[8]));
                }
            }
        }
        Ok(())
    })), &mut token) }.map_err(|e| e.to_string())?;
    if let Ok(webview4) = webview.cast::<webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_4>() {
        let s = sink.clone(); unsafe { webview4.add_DownloadStarting(&DownloadStartingEventHandler::create(Box::new(move |_, _| { log_event(&s, "DownloadStarting", ""); Ok(()) })), &mut token) }.map_err(|e| e.to_string())?;
    } else { log_event(&sink, "DownloadStartingUnavailable", "interface-unavailable"); }
    if let Ok(webview25) = webview.cast::<ICoreWebView2_25>() {
        let s = sink.clone(); unsafe { webview25.add_SaveAsUIShowing(&SaveAsUIShowingEventHandler::create(Box::new(move |_, _args: Option<ICoreWebView2SaveAsUIShowingEventArgs>| { log_event(&s, "SaveAsUIShowing", ""); Ok(()) })), &mut token) }.map_err(|e| e.to_string())?;
    } else { log_event(&sink, "SaveAsUIShowingUnavailable", "interface-unavailable"); }
    Ok(())
}
