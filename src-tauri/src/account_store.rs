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
    replace(&file, &bytes)
}

fn replace(file: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
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
    crate::atomic_store::write(file, bytes)
}

/// Compare-and-swap prevents deletion from silently overwriting concurrent edits.
pub(crate) fn remove_index<R: Runtime>(app: &AppHandle<R>, expected: &serde_json::Value, id: &str, service: &str) -> Result<(), String> {
    let _guard = ACCOUNTS_LOCK.lock().map_err(|_| "Account storage lock unavailable")?;
    let file = path(app)?;
    let current: serde_json::Value = serde_json::from_slice(&fs::read(&file).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if &current != expected { return Err("Accounts changed during deletion. Try again.".into()); }
    let mut rows = current.as_array().ok_or("Invalid account data")?.clone();
    rows.retain(|row| !(row["id"].as_str() == Some(id) && row["service"].as_str().unwrap_or("flow") == service));
    replace(&file, &serde_json::to_vec(&rows).map_err(|e| e.to_string())?)
}

fn validate(value: &serde_json::Value) -> Result<(), String> {
    let rows = value.as_array().ok_or("Account data must be an array")?;
    let mut ids = std::collections::HashSet::new();
    for row in rows {
        let valid = row.get("id").is_some_and(|v| v.is_string())
            && row.get("name").is_some_and(|v| v.is_string())
            && row.get("email").is_some_and(|v| v.is_null() || v.is_string())
            && row.get("avatarUrl").is_some_and(|v| v.is_null() || v.is_string())
            && row.get("avatar").is_some_and(|v| v.is_string())
            && row.get("favorite").is_some_and(|v| v.is_boolean())
            && row.get("order").is_some_and(|v| v.is_number());
        let id = row["id"].as_str().unwrap_or("");
        let service = row["service"].as_str().unwrap_or("flow");
        let valid = valid && !id.is_empty() && id.len() <= 128
            && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
            && ids.insert(id)
            && ["flow", "claude", "chatgpt", "dola", "leonardo", "migoo", "gemini", "suno", "pinterest", "threads"].contains(&service)
            && row.get("service").map_or(true, |v| v.is_string())
            && row.get("flowSessionId").map_or(true, |v| service != "flow" && v.as_str().is_some_and(|id|
                !id.is_empty() && id.len() <= 128 && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')))
            && ["addedAt", "lastOpenedAt"].iter().all(|key| row.get(*key).map_or(true, |v| v.as_f64().is_some_and(|n| n.is_finite() && n >= 0.0)));
        if !valid { return Err("Invalid account data; existing files were left unchanged".into()); }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn account() -> serde_json::Value {
        serde_json::json!({"id":"a", "name":"A", "email":null,"avatarUrl":null,"avatar":"A","favorite":false,"order":0,"service":"flow"})
    }
    #[test]
    fn validates_service_link_and_identity_before_replacing_data() {
        let a = account();
        assert!(validate(&serde_json::json!([a])).is_ok());
        assert!(validate(&serde_json::json!([a,a])).is_err());
        for (key, value) in [("id", "../outside"), ("service", "unknown"), ("flowSessionId", "a")] {
            let mut invalid = account(); invalid[key] = value.into();
            assert!(validate(&serde_json::json!([invalid])).is_err());
        }
    }
    #[test]
    fn corrupt_existing_index_is_never_replaced() {
        let file=std::env::temp_dir().join(format!("flowpilot-store-test-{}", uuid::Uuid::new_v4()));
        fs::write(&file,b"broken").unwrap();
        assert!(replace(&file,b"[]").is_err());
        assert_eq!(fs::read(&file).unwrap(),b"broken");
        fs::remove_file(file).unwrap();
    }
}
