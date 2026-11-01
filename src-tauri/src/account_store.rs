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
    if !file.exists() {
        return Ok(None);
    }
    serde_json::from_str(&fs::read_to_string(file).map_err(|e| e.to_string())?)
        .map(Some)
        .map_err(|e| e.to_string())
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
    if !accounts.is_array() { return Err("Account data must be an array".into()); }
    let bytes = serde_json::to_vec(&accounts).map_err(|e| e.to_string())?;
    let temp = file.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    fs::write(&temp, bytes).map_err(|e| e.to_string())?;
    let result = (|| {
        // Windows requires the existing file to be removed or replaced explicitly.
        #[cfg(windows)]
        if file.exists() {
            // Preserve a recoverable backup if the final rename fails.
            let backup = file.with_extension("json.bak");
            fs::copy(&file, backup).map_err(|e| e.to_string())?;
            fs::remove_file(&file).map_err(|e| e.to_string())?;
        }
        fs::rename(&temp, &file).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let backup = file.with_extension("json.bak");
        if !file.exists() && backup.exists() { let _ = fs::copy(&backup, &file); }
        let _ = fs::remove_file(&temp);
    }
    result
}
