use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager, Runtime};

static SETTINGS_LOCK: Mutex<()> = Mutex::new(());

fn config_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("download-folder.json"))
}

pub fn folder<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let _guard = SETTINGS_LOCK.lock().map_err(|_| "Download settings unavailable")?;
    let config = config_path(app)?;
    match fs::read(config) {
        Ok(bytes) => {
            let path: PathBuf = serde_json::from_slice(&bytes).map_err(|_| "Download folder setting is invalid. Choose a folder in Settings.")?;
            if !path.is_absolute() || !path.is_dir() {
                return Err("Download folder is unavailable. Reconnect the drive or choose another folder in Settings.".into());
            }
            Ok(path)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let path = app.path().download_dir().map_err(|e| e.to_string())?.join("Flowpilot");
            fs::create_dir_all(&path).map_err(|e| e.to_string())?;
            Ok(path)
        }
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn get_download_folder(app: AppHandle) -> Result<String, String> {
    folder(&app).map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn choose_download_folder(app: AppHandle) -> Result<Option<String>, String> {
    let current = folder(&app).ok();
    let selected = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = rfd::FileDialog::new().set_title("Choose download folder");
        if let Some(path) = current { dialog = dialog.set_directory(path); }
        dialog.pick_folder()
    }).await.map_err(|e| e.to_string())?;
    let Some(path) = selected else { return Ok(None); };
    if !path.is_absolute() || !path.is_dir() { return Err("Choose an existing folder.".into()); }
    // Verify access without touching existing files.
    let probe = path.join(format!(".flowpilot-write-check-{}", uuid::Uuid::new_v4()));
    let file = fs::OpenOptions::new().write(true).create_new(true).open(&probe)
        .map_err(|e| format!("Cannot write to this folder: {e}"))?;
    drop(file);
    fs::remove_file(&probe).map_err(|e| e.to_string())?;
    let _guard = SETTINGS_LOCK.lock().map_err(|_| "Download settings unavailable")?;
    let config = config_path(&app)?;
    if let Some(parent) = config.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    fs::write(config, serde_json::to_vec(&path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn open_download_folder(app: AppHandle) -> Result<(), String> {
    let path = folder(&app)?;
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe").arg(path).spawn().map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("Opening the download folder is supported on Windows.".into())
    }
}
