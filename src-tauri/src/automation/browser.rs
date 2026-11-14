use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, LazyLock, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use webview2_com::{take_pwstr, CallDevToolsProtocolMethodCompletedHandler, DevToolsProtocolEventReceivedEventHandler};
use windows::core::{PCWSTR, PWSTR};

use super::AutomationError;

static ACTIVE_PROFILES: LazyLock<Mutex<HashSet<PathBuf>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

pub(super) struct Browser {
    app: AppHandle,
    label: String,
    profile: PathBuf,
    hosts: &'static [&'static str],
}

pub(super) fn failed(error: impl ToString) -> AutomationError {
    AutomationError::Failed(error.to_string())
}

impl Browser {
    pub(super) fn open(
        app: &AppHandle,
        service: &str,
        account: &str,
        url: &str,
        hosts: &'static [&'static str],
    ) -> Result<Self, AutomationError> {
        let app = app.clone();
        let service = service.to_owned();
        let account = account.to_owned();
        let url: tauri::Url = url.parse().map_err(failed)?;
        Self::dispatch(&app.clone(), move || {
            let (profile, args) =
                crate::webview_manager::automation_profile_directory(&app, &service, &account)
                    .map_err(failed)?;
            if !ACTIVE_PROFILES
                .lock()
                .map_err(failed)?
                .insert(profile.clone())
            {
                return Err(failed(
                    "This browser profile already has an automation task",
                ));
            }
            let label = format!("flowpilot-job-{}", uuid::Uuid::new_v4());
            let browser = Self {
                app,
                label,
                profile,
                hosts,
            };
            let builder = WebviewWindowBuilder::new(
                &browser.app,
                browser.label.clone(),
                WebviewUrl::External(url),
            )
            .data_directory(browser.profile.clone())
            .inner_size(1280.0, 800.0)
            .visible(false)
            .focused(false)
            .on_navigation(|url| url.scheme() == "https");
            let builder = match &args {
                Some(args) => builder.additional_browser_args(args),
                None => builder,
            };
            builder.build().map_err(failed)?;
            Ok(browser)
        })
    }

    fn dispatch<T: Send + 'static>(
        app: &AppHandle,
        work: impl FnOnce() -> Result<T, AutomationError> + Send + 'static,
    ) -> Result<T, AutomationError> {
        let (sender, receiver) = mpsc::sync_channel(1);
        let cancelled = Arc::new(AtomicBool::new(false));
        let abandoned = cancelled.clone();
        app.run_on_main_thread(move || {
            if !abandoned.load(Ordering::Acquire) {
                let _ = sender.send(work());
            }
        })
        .map_err(failed)?;
        receiver
            .recv_timeout(Duration::from_secs(20))
            .map_err(|error| {
                cancelled.store(true, Ordering::Release);
                failed(error)
            })?
    }

    pub(super) fn wait_for_navigation(&self) -> Result<(), AutomationError> {
        let deadline = Instant::now() + Duration::from_secs(35);
        loop {
            let app = self.app.clone();
            let label = self.label.clone();
            let url = Self::dispatch(&self.app, move || {
                app.get_webview_window(&label)
                    .ok_or_else(|| failed("Automation window closed"))?
                    .url().map_err(failed)
            })?;
            match url.host_str() {
                Some(host) if url.scheme() == "https" && self.hosts.contains(&host) => return Ok(()),
                Some("accounts.google.com") if url.scheme() == "https" => {
                    return Err(AutomationError::LoginRequired);
                }
                _ if Instant::now() < deadline => thread::sleep(Duration::from_millis(350)),
                _ => return Err(failed("Automation page did not reach the expected service")),
            }
        }
    }

    fn cdp(&self, method: &'static str, params: Value) -> Result<Value, AutomationError> {
        let app = self.app.clone();
        let label = self.label.clone();
        let hosts = self.hosts;
        let (sender, receiver) = mpsc::sync_channel(1);
        Self::dispatch(&self.app, move || {
            let window = app
                .get_webview_window(&label)
                .ok_or_else(|| failed("Automation window closed"))?;
            let url = window.url().map_err(failed)?;
            if url.scheme() != "https" || !url.host_str().is_some_and(|host| hosts.contains(&host))
            {
                return Err(if url.scheme() == "https" && url.host_str() == Some("accounts.google.com") {
                    AutomationError::LoginRequired
                } else {
                    failed("Automation navigated away from the expected service")
                });
            }
            let errors = sender.clone();
            window
                .with_webview(move |platform| {
                    let start = (|| {
                        let native =
                            unsafe { platform.controller().CoreWebView2() }.map_err(failed)?;
                        let method: Vec<u16> = method.encode_utf16().chain([0]).collect();
                        let params: Vec<u16> =
                            params.to_string().encode_utf16().chain([0]).collect();
                        let callback = CallDevToolsProtocolMethodCompletedHandler::create(
                            Box::new(move |status, body| {
                                let result = status
                                    .map_err(failed)
                                    .and_then(|()| serde_json::from_str(&body).map_err(failed));
                                let _ = sender.send(result);
                                Ok(())
                            }),
                        );
                        unsafe {
                            native.CallDevToolsProtocolMethod(
                                PCWSTR(method.as_ptr()),
                                PCWSTR(params.as_ptr()),
                                &callback,
                            )
                        }
                        .map_err(failed)
                    })();
                    if let Err(error) = start {
                        let _ = errors.send(Err(error));
                    }
                })
                .map_err(failed)
        })?;
        receiver
            .recv_timeout(Duration::from_secs(25))
            .map_err(failed)?
    }

    pub(super) fn eval(&self, expression: &str) -> Result<Value, AutomationError> {
        let allowed = json!(self.hosts);
        let expression = format!("(() => {{ if (location.protocol !== 'https:' || !{allowed}.includes(location.hostname)) throw Error('Unexpected page'); return ({expression}); }})()");
        let result = self.cdp(
            "Runtime.evaluate",
            json!({
                "expression": expression, "returnByValue": true
            }),
        )?;
        if result.get("exceptionDetails").is_some() {
            return Err(failed(
                result["exceptionDetails"]["exception"]["description"]
                    .as_str()
                    .unwrap_or("Browser script failed"),
            ));
        }
        Ok(result["result"]["value"].clone())
    }

    pub(super) fn wait(&self, expression: &str, seconds: u64) -> Result<Value, AutomationError> {
        let deadline = Instant::now() + Duration::from_secs(seconds);
        loop {
            let value = self.eval(expression)?;
            if !matches!(value, Value::Null | Value::Bool(false)) {
                return Ok(value);
            }
            if Instant::now() >= deadline {
                return Err(failed("Timed out waiting for the platform"));
            }
            thread::sleep(Duration::from_millis(350));
        }
    }

    pub(super) fn enter(&self) -> Result<(), AutomationError> {
        for event in ["rawKeyDown", "keyUp"] {
            self.cdp("Input.dispatchKeyEvent", json!({"type": event, "key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13}))?;
        }
        Ok(())
    }

    pub(super) fn intercept_file_chooser(&self) -> Result<(), AutomationError> {
        self.cdp(
            "Page.setInterceptFileChooserDialog",
            json!({"enabled": true}),
        )
        .map(|_| ())
    }

    pub(super) fn upload_from_chooser(
        &self,
        path: &Path,
        click_upload: impl FnOnce() -> Result<(), AutomationError>,
    ) -> Result<(), AutomationError> {
        let path = local_file(path)?;
        let (events, pending) = mpsc::channel();
        let token = self.chooser_listener(Some(events), 0)?;
        let result = (|| {
            self.cdp("Page.enable", json!({}))?;
            self.intercept_file_chooser()?;
            click_upload()?;
            let node = pending.recv_timeout(Duration::from_secs(25))
                .map_err(|_| failed("Flow upload: the Upload button did not open a file chooser"))??;
            self.cdp("DOM.setFileInputFiles", json!({"backendNodeId": node, "files": [path]}))
                .map_err(|error| match error {
                    AutomationError::Failed(message) => failed(format!("Flow upload: could not set files on the chooser: {message}")),
                    other => other,
                })?;
            Ok(())
        })();
        let remove = self.chooser_listener(None, token).map(|_| ());
        let reset = self.cdp("Page.setInterceptFileChooserDialog", json!({"enabled": false})).map(|_| ());
        result.and(remove).and(reset)
    }

    pub(super) fn click_at(&self, point: &Value) -> Result<(), AutomationError> {
        let x = point["x"].as_f64().filter(|x| x.is_finite())
            .ok_or_else(|| failed("Flow upload: invalid button position"))?;
        let y = point["y"].as_f64().filter(|y| y.is_finite())
            .ok_or_else(|| failed("Flow upload: invalid button position"))?;
        self.cdp("Input.dispatchMouseEvent", json!({"type": "mouseMoved", "x": x, "y": y}))?;
        for (event, buttons) in [("mousePressed", 1), ("mouseReleased", 0)] {
            self.cdp("Input.dispatchMouseEvent", json!({
                "type": event, "x": x, "y": y, "button": "left", "buttons": buttons, "clickCount": 1
            }))?;
        }
        Ok(())
    }

    fn chooser_listener(
        &self,
        events: Option<mpsc::Sender<Result<u64, AutomationError>>>,
        mut token: i64,
    ) -> Result<i64, AutomationError> {
        let app = self.app.clone();
        let label = self.label.clone();
        let (done, result) = mpsc::channel();
        Self::dispatch(&self.app, move || {
            let window = app.get_webview_window(&label)
                .ok_or_else(|| failed("Automation window closed"))?;
            window.with_webview(move |platform| {
                let registration = (|| {
                    let native = unsafe { platform.controller().CoreWebView2() }.map_err(failed)?;
                    let event: Vec<u16> = "Page.fileChooserOpened".encode_utf16().chain([0]).collect();
                    let receiver = unsafe { native.GetDevToolsProtocolEventReceiver(PCWSTR(event.as_ptr())) }
                        .map_err(failed)?;
                    if let Some(events) = events {
                        let callback = DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_, args| {
                            let node = (|| {
                                let args = args.ok_or_else(|| failed("File chooser did not supply event arguments"))?;
                                let mut raw = PWSTR::null();
                                unsafe { args.ParameterObjectAsJson(&mut raw) }.map_err(failed)?;
                                let data: Value = serde_json::from_str(&take_pwstr(raw)).map_err(failed)?;
                                data["backendNodeId"].as_u64().filter(|id| *id > 0)
                                    .ok_or_else(|| failed("Flow file chooser did not identify its file input"))
                            })();
                            let _ = events.send(node);
                            Ok(())
                        }));
                        unsafe { receiver.add_DevToolsProtocolEventReceived(&callback, &mut token) }
                            .map_err(failed)?;
                    } else {
                        unsafe { receiver.remove_DevToolsProtocolEventReceived(token) }.map_err(failed)?;
                    }
                    Ok(token)
                })();
                let _ = done.send(registration);
            }).map_err(failed)
        })?;
        result.recv_timeout(Duration::from_secs(20))
            .map_err(|_| failed("Timed out registering Flow's file chooser listener"))?
    }

    pub(super) fn insert_text(&self, text: &str) -> Result<(), AutomationError> {
        self.cdp("Input.insertText", json!({"text": text}))
            .map(|_| ())
    }

    pub(super) fn upload(&self, selector: &str, path: &Path) -> Result<(), AutomationError> {
        let path = local_file(path)?;
        let candidate = json!(selector);
        self.wait(&format!("!!document.querySelector({candidate})"), 20)?;
        let document = self.cdp("DOM.getDocument", json!({ "depth": 0 }))?;
        let input = self.cdp(
            "DOM.querySelector",
            json!({"nodeId": document["root"]["nodeId"], "selector": selector}),
        )?;
        if input["nodeId"].as_u64().filter(|id| *id > 0).is_none() {
            return Err(failed("Upload field disappeared"));
        }
        self.cdp(
            "DOM.setFileInputFiles",
            json!({"nodeId": input["nodeId"], "files": [path]}),
        )?;
        Ok(())
    }
}

pub(super) fn local_file(path: &Path) -> Result<PathBuf, AutomationError> {
    let file = std::path::absolute(path).map_err(failed)?;
    if !file.is_file() {
        return Err(AutomationError::InvalidInput("Media file does not exist"));
    }
    Ok(file)
}

impl Drop for Browser {
    fn drop(&mut self) {
        let app = self.app.clone();
        let label = self.label.clone();
        let profile = self.profile.clone();
        let _ = self.app.run_on_main_thread(move || {
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.destroy();
            }
            if let Ok(mut profiles) = ACTIVE_PROFILES.lock() {
                profiles.remove(&profile);
            }
        });
    }
}
