//! Write-only fallback for an explicit Copy action in an active chat WebView.
//! No clipboard reads, conversation scraping, or clipboard payload logging.
#[cfg(windows)]
pub fn attach<R: tauri::Runtime>(view: &tauri::Webview<R>) -> Result<(), String> {
    use tauri::Manager;
    use webview2_com::{take_pwstr, WebMessageReceivedEventHandler};
    use windows::core::{PCWSTR, PWSTR};
    let app = view.app_handle().clone();
    let label = view.label().to_string();
    view.with_webview(move |platform| {
        let install = (|| -> windows::core::Result<()> {
            let controller = platform.controller().clone();
            let native = unsafe { controller.CoreWebView2()? };
            let mut token = 0;
            let mut last = std::time::Instant::now() - std::time::Duration::from_secs(1);
            let handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut source = PWSTR::null();
                unsafe { args.Source(&mut source)? };
                let source = take_pwstr(source);
                let Ok(url) = source.parse::<tauri::Url>() else { return Ok(()) };
                if url.scheme() != "https" || !matches!(url.host_str(), Some("claude.ai" | "chatgpt.com")) {
                    return Ok(());
                }
                let mut raw = PWSTR::null();
                unsafe { args.WebMessageAsJson(&mut raw)? };
                let raw = take_pwstr(raw);
                if raw.len() > 6_100_000 { return Ok(()); }
                let Ok(message) = serde_json::from_str::<serde_json::Value>(&raw) else { return Ok(()) };
                if message["kind"] != "flowpilot-copy-text" { return Ok(()); }
                let Some(id) = message["id"].as_str().filter(|id| uuid::Uuid::parse_str(id).is_ok()) else { return Ok(()) };
                let Some(text) = message["text"].as_str().filter(|s| s.len() <= 4_000_000) else { return Ok(()) };
                let mut visible = windows::core::BOOL::default();
                unsafe { controller.IsVisible(&mut visible)? };
                let allowed = visible.as_bool() && crate::webview_manager::is_active_view(&app, &label)
                    && app.get_window("main").is_some_and(|w| w.is_focused().unwrap_or(false))
                    && app.get_webview(&label).and_then(|w| w.url().ok()).is_some_and(|current| current == url)
                    && last.elapsed() >= std::time::Duration::from_millis(200);
                last = std::time::Instant::now();
                let id = id.to_owned();
                let text = text.to_owned();
                let app = app.clone();
                let label = label.clone();
                std::thread::spawn(move || {
                    let ok = allowed && clipboard_win::set_clipboard_string(&text).is_ok();
                    let result = serde_json::json!({"kind": "flowpilot-copy-result", "id": id, "ok": ok}).to_string();
                    let handle = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        if let Some(view) = handle.get_webview(&label) {
                            let _ = view.with_webview(move |platform| {
                                if let Ok(native) = unsafe { platform.controller().CoreWebView2() } {
                                    let result: Vec<u16> = result.encode_utf16().chain([0]).collect();
                                    let _ = unsafe { native.PostWebMessageAsJson(PCWSTR(result.as_ptr())) };
                                }
                            });
                        }
                    });
                });
                Ok(())
            }));
            unsafe { native.add_WebMessageReceived(&handler, &mut token)? };
            Ok(())
        })();
        if install.is_err() { eprintln!("[flowpilot] Clipboard recovery could not attach"); }
    }).map_err(|error| error.to_string())
}
#[cfg(not(windows))]
pub fn attach<R: tauri::Runtime>(_: &tauri::Webview<R>) -> Result<(), String> { Ok(()) }
