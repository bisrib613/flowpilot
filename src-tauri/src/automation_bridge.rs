use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{Ipv4Addr, TcpListener, TcpStream},
    path::PathBuf,
    sync::mpsc,
    time::Duration,
};
use tauri::{path::BaseDirectory, AppHandle, Manager};

const MAX_REQUEST_BYTES: usize = 64 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeDescriptor {
    endpoint: String,
    token: String,
    pid: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenSessionRequest {
    account_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenSessionResponse {
    cdp_endpoint: String,
}

fn descriptor_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().resolve("automation-bridge.json", BaseDirectory::AppLocalData)
        .map_err(|error| error.to_string())
}

fn open_session(app: &AppHandle, account_id: String) -> Result<OpenSessionResponse, String> {
    let worker_app = app.clone();
    let (sender, receiver) = mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let _ = sender.send(crate::webview_manager::open_automation_session(&worker_app, account_id));
    }).map_err(|error| error.to_string())?;
    let port = receiver.recv_timeout(Duration::from_secs(30))
        .map_err(|_| "Timed out while FlowPilot opened the automation session".to_string())??;
    Ok(OpenSessionResponse { cdp_endpoint: format!("http://127.0.0.1:{port}") })
}

fn read_request(stream: &mut TcpStream) -> Result<(String, String, Vec<u8>), String> {
    stream.set_read_timeout(Some(Duration::from_secs(5))).map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(stream.try_clone().map_err(|error| error.to_string())?);
    let mut request_line = String::new();
    reader.read_line(&mut request_line).map_err(|error| error.to_string())?;
    let mut parts = request_line.split_whitespace();
    let route = format!("{} {}", parts.next().unwrap_or_default(), parts.next().unwrap_or_default());
    let mut content_length = 0usize;
    let mut authorization = String::new();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).map_err(|error| error.to_string())?;
        if line == "\r\n" || line.is_empty() { break; }
        let Some((name, value)) = line.split_once(':') else { continue };
        match name.trim().to_ascii_lowercase().as_str() {
            "content-length" => content_length = value.trim().parse().map_err(|_| "Invalid Content-Length".to_string())?,
            "authorization" => authorization = value.trim().to_string(),
            _ => {}
        }
    }
    if content_length > MAX_REQUEST_BYTES { return Err("Request is too large".to_string()); }
    let mut body = vec![0; content_length];
    reader.read_exact(&mut body).map_err(|error| error.to_string())?;
    Ok((route, authorization, body))
}

fn respond(stream: &mut TcpStream, status: &str, value: serde_json::Value) {
    let body = value.to_string();
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
}

fn handle_connection(app: &AppHandle, token: &str, mut stream: TcpStream) {
    let result = (|| -> Result<serde_json::Value, String> {
        let (route, authorization, body) = read_request(&mut stream)?;
        if authorization != format!("Bearer {token}") { return Err("Unauthorized".to_string()); }
        match route.as_str() {
            "GET /v1/health" => Ok(serde_json::json!({ "ok": true })),
            "POST /v1/session/open" => {
                let request: OpenSessionRequest = serde_json::from_slice(&body)
                    .map_err(|_| "Invalid session request".to_string())?;
                serde_json::to_value(open_session(app, request.account_id)?).map_err(|error| error.to_string())
            }
            _ => Err("Not found".to_string()),
        }
    })();
    match result {
        Ok(value) => respond(&mut stream, "200 OK", serde_json::json!({ "ok": true, "value": value })),
        Err(error) if error == "Unauthorized" => respond(&mut stream, "401 Unauthorized", serde_json::json!({ "ok": false, "error": error })),
        Err(error) if error == "Not found" => respond(&mut stream, "404 Not Found", serde_json::json!({ "ok": false, "error": error })),
        Err(error) => respond(&mut stream, "400 Bad Request", serde_json::json!({ "ok": false, "error": error })),
    }
}

pub fn start(app: AppHandle) -> Result<(), String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|error| error.to_string())?;
    let port = listener.local_addr().map_err(|error| error.to_string())?.port();
    let token = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
    let path = descriptor_path(&app)?;
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
    let descriptor = BridgeDescriptor { endpoint: format!("http://127.0.0.1:{port}"), token: token.clone(), pid: std::process::id() };
    fs::write(path, serde_json::to_vec(&descriptor).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    std::thread::spawn(move || {
        for incoming in listener.incoming() {
            match incoming {
                Ok(stream) => handle_connection(&app, &token, stream),
                Err(_) => break,
            }
        }
    });
    Ok(())
}
