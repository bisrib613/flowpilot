use std::{fs, path::PathBuf, sync::Mutex};

static ACCOUNTS_LOCK: Mutex<()> = Mutex::new(());
use tauri::{path::BaseDirectory, AppHandle, Manager, Runtime};

fn path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .resolve("accounts.json", BaseDirectory::AppLocalData)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_accounts<R: Runtime>(app: AppHandle<R>) -> Result<Option<serde_json::Value>, String> {
    let _guard = ACCOUNTS_LOCK.lock().map_err(|_| "Account storage lock unavailable")?;
    let file = path(&app)?;
    match fs::read(&file) {
        Ok(bytes) => {
            let value = serde_json::from_slice(&bytes).map_err(|_| "Stored accounts contain invalid JSON")?;
            validate(&value)?;
            Ok(Some(value))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("Unable to read stored accounts".into()),
    }
}

#[tauri::command]
pub fn save_accounts<R: Runtime>(
    app: AppHandle<R>,
    accounts: serde_json::Value,
) -> Result<(), String> {
    let _guard = ACCOUNTS_LOCK.lock().map_err(|_| "Account storage lock unavailable")?;
    let file = path(&app)?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    validate(&accounts)?;
    let bytes = serde_json::to_vec(&accounts).map_err(|e| e.to_string())?;
    // Keep the existing recovery backup, then atomically replace on Windows.
    match fs::read(&file) {
        Ok(previous) => {
            let value = serde_json::from_slice(&previous).map_err(|_| "Existing accounts contain invalid JSON; no files changed")?;
            validate(&value)?;
            crate::atomic_store::write(&file.with_extension("json.bak"), &previous)?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
        Err(_) => return Err("Unable to back up existing accounts".into()),
    }
    crate::atomic_store::write(&file, &bytes)
}

fn validate(value: &serde_json::Value) -> Result<(), String> {
    let rows = value.as_array().ok_or("Account data must be an array")?;
    for row in rows {
        let valid = row.get("id").is_some_and(|v| v.is_string())
            && row.get("name").is_some_and(|v| v.is_string())
            && row.get("email").is_some_and(|v| v.is_null() || v.is_string())
            && row.get("avatarUrl").is_some_and(|v| v.is_null() || v.is_string())
            && row.get("avatar").is_some_and(|v| v.is_string())
            && row.get("favorite").is_some_and(|v| v.is_boolean())
            && row.get("order").is_some_and(|v| v.is_number());
        if !valid { return Err("Invalid account data; existing files were left unchanged".into()); }
    }
    Ok(())
}
