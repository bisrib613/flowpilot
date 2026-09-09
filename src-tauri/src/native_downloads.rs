//! Native downloads retain the WebView's authentication and support arbitrary file types.
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager, Runtime, Webview};
use tauri::webview::DownloadEvent;

fn filename(suggested: &Path, suffix: &str) -> String {
    let raw = suggested.file_name().and_then(|name| name.to_str()).unwrap_or("download");
    let clean: String = raw.chars().map(|c| {
        if c.is_control() || "<>:\"/\\|?*".contains(c) { '_' } else { c }
    }).take(160).collect();
    let clean = clean.trim_matches(|c: char| c == '.' || c.is_whitespace());
    let clean = if clean.is_empty() { "download" } else { clean };
    let path = Path::new(clean);
    let stem = path.file_stem().and_then(|v| v.to_str()).unwrap_or("download");
    match path.extension().and_then(|v| v.to_str()).filter(|v| !v.is_empty()) {
        Some(extension) => format!("{stem}-{suffix}.{extension}"),
        None => format!("{stem}-{suffix}"),
    }
}

fn destination<R: Runtime>(webview: &Webview<R>, suggested: &Path) -> Result<PathBuf, String> {
    let folder = webview.app_handle().path().download_dir().map_err(|e| e.to_string())?.join("Flowpilot");
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    // Unique names also prevent simultaneous downloads from overwriting each other.
    Ok(folder.join(filename(suggested, &uuid::Uuid::new_v4().to_string())))
}

fn notify<R: Runtime>(webview: &Webview<R>, message: String) {
    let _ = webview.app_handle().emit_to("main", "flowpilot-download", message);
}

pub fn handle<R: Runtime>(webview: Webview<R>, event: DownloadEvent<'_>) -> bool {
    match event {
        DownloadEvent::Requested { destination: target, .. } => {
            match destination(&webview, target) {
                Ok(path) => {
                    notify(&webview, format!("Downloading to {}", path.display()));
                    *target = path;
                    true
                }
                Err(error) => {
                    notify(&webview, format!("Download could not start: {error}"));
                    false
                }
            }
        }
        DownloadEvent::Finished { path, success, .. } => {
            let location = path.map(|p| p.display().to_string()).unwrap_or_else(|| "Downloads / Flowpilot".into());
            notify(&webview, if success { format!("Downloaded: {location}") } else { format!("Download failed or was cancelled: {location}") });
            true
        }
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keeps_image_document_and_video_extensions() {
        for name in ["storyboard.png", "document.pdf", "clip.mp4", "archive.zip"] {
            let result = filename(Path::new(name), "unique");
            assert_eq!(Path::new(&result).extension(), Path::new(name).extension());
        }
    }
    #[test]
    fn filenames_are_single_safe_components() {
        for name in ["../image.png", "bad:name?.png", "..", "CON", ""] {
            let result = filename(Path::new(name), "unique");
            assert!(!result.contains(['/', '\\', ':', '?']));
            assert!(result.contains("unique"));
        }
    }
}
