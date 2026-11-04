//! Temporary, read-only WebView2 event instrumentation.
#![cfg(all(windows, feature = "diag"))]

use std::{fs::OpenOptions, io::Write, sync::{Arc, Mutex, atomic::{AtomicU8, Ordering}}, time::{SystemTime, UNIX_EPOCH}};
use webview2_com::{DownloadStartingEventHandler, FocusChangedEventHandler, ProcessFailedEventHandler, NavigationCompletedEventHandler, NavigationStartingEventHandler, NewWindowRequestedEventHandler, SaveAsUIShowingEventHandler, WebMessageReceivedEventHandler, take_pwstr};
use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Controller, ICoreWebView2Environment, ICoreWebView2_25, ICoreWebView2SaveAsUIShowingEventArgs, ICoreWebView2NavigationStartingEventArgs};
use windows::core::{Interface, PWSTR};
use windows::Win32::{Foundation::HWND, System::DataExchange::GetOpenClipboardWindow, UI::{Input::KeyboardAndMouse::GetFocus, WindowsAndMessaging::{GetAncestor, GetForegroundWindow, IsChild, GA_ROOT}}};

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

fn native_input_snapshot(sink: &LogSink, label: &str, parent: HWND, focus_state: u8, trigger: &str) {
    // Read-only handles are reduced to booleans: no titles, process IDs,
    // clipboard contents, OpenClipboard, or activation/focus changes.
    unsafe {
        let focus = GetFocus();
        let root = GetAncestor(parent, GA_ROOT);
        let foreground = GetForegroundWindow();
        let focus_in_view = !parent.0.is_null() && !focus.0.is_null()
            && (focus == parent || IsChild(parent, focus).as_bool());
        let host_foreground = !root.0.is_null() && root == foreground;
        let clipboard_open_window_present = GetOpenClipboardWindow().is_ok_and(|window| !window.0.is_null());
        log_event(sink, "NativeInputState", &format!("webview={} trigger={} controller_focus={} focus_present={} focus_in_view={} host_foreground={} clipboard_open_window_present={}", label, trigger, focus_state, u8::from(!focus.0.is_null()), u8::from(focus_in_view), u8::from(host_foreground), u8::from(clipboard_open_window_present)));
    }
}

pub fn attach(controller: &ICoreWebView2Controller, environment: &ICoreWebView2Environment, label: &str) -> Result<(), String> {
    let path = log_path().map_err(|e| e.to_string())?;
    let file = OpenOptions::new().create(true).append(true).open(path).map_err(|e| e.to_string())?;
    let sink = Arc::new(Mutex::new(file));
    log_event(&sink, "InstrumentationAttached", &format!("webview={label}"));
    let webview = unsafe { controller.CoreWebView2() }.map_err(|error| error.to_string())?;
    let mut parent = HWND::default();
    unsafe { controller.ParentWindow(&mut parent) }.map_err(|error| error.to_string())?;
    let mut raw_version = PWSTR::null();
    if unsafe { environment.BrowserVersionString(&mut raw_version) }.is_ok() {
        let version = take_pwstr(raw_version);
        if !version.is_empty() && version.len() <= 64 && version.bytes().all(|c| c.is_ascii_digit() || c == b'.') {
            log_event(&sink, "WebView2Runtime", &format!("webview={} version={}", label, version));
        }
    }
    // 0 = no native focus event observed yet, 1 = got, 2 = lost.
    // Do not initialize this to focused based on a successful MoveFocus call.
    let native_focus = Arc::new(AtomicU8::new(0));
    native_input_snapshot(&sink, label, parent, 0, "attached");
    let mut token = 0;
    for (gained, value) in [(true, 1), (false, 2)] {
        let s = sink.clone();
        let focus = native_focus.clone();
        let focus_label = label.to_string();
        let handler = FocusChangedEventHandler::create(Box::new(move |_, _| {
            focus.store(value, Ordering::Relaxed);
            log_event(&s, "NativeControllerFocus", &format!("webview={} state={}", focus_label, if gained { "got" } else { "lost" }));
            native_input_snapshot(&s, &focus_label, parent, value, if gained { "got-focus" } else { "lost-focus" });
            Ok(())
        }));
        let result = unsafe {
            if gained { controller.add_GotFocus(&handler, &mut token) }
            else { controller.add_LostFocus(&handler, &mut token) }
        };
        result.map_err(|error| error.to_string())?;
    }
    let s = sink.clone();
    let process_label = label.to_string();
    unsafe { webview.add_ProcessFailed(&ProcessFailedEventHandler::create(Box::new(move |_, args| {
        if let Some(args) = args {
            let mut kind = Default::default();
            args.ProcessFailedKind(&mut kind)?;
            log_event(&s, "NativeProcessFailed", &format!("webview={} kind={}", process_label, kind.0));
        }
        Ok(())
    })), &mut token) }.map_err(|error| error.to_string())?;
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
                    if fields[1] == "click" && fields[2] == "copy" {
                        native_input_snapshot(&s, &interaction_label, parent, native_focus.load(Ordering::Relaxed), fields[1]);
                    }
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
