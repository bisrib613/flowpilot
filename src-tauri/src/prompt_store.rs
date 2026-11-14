//! Local prompt library. Failed reads never become empty libraries on write.
use std::{collections::HashSet, fs, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, path::BaseDirectory};
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Prompt {
    id: String, title: String, prompt: String, category: String,
    pinned: bool, color: String, created_at: u64, updated_at: u64,
}
#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum Mutation {
    Save { id: Option<String>, title: String, prompt: String, category: String },
    Delete { id: String },
    Pin { id: String, pinned: bool },
    Color { id: String, color: String },
}
fn color_valid(value: &str) -> bool { ["default", "blue", "purple", "green", "orange", "red"].contains(&value) }
fn validate(items: &[Prompt]) -> Result<(), String> {
    let mut ids = HashSet::new();
    if items.len() > 10_000 { return Err("Prompt library is too large".into()); }
    for p in items {
        if uuid::Uuid::parse_str(&p.id).is_err() || !ids.insert(&p.id)
            || p.title.trim().is_empty() || p.title.chars().count() > 200
            || p.prompt.trim().is_empty() || p.prompt.chars().count() > 100_000
            || p.category.chars().count() > 100 || !color_valid(&p.color) {
            return Err("Invalid prompt library; existing data has not been changed".into());
        }
    }
    Ok(())
}
fn read(file: &std::path::Path) -> Result<Vec<Prompt>, String> {
    let bytes = match fs::read(file) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(_) => return Err("Unable to read prompt library".into()),
    };
    let items: Vec<Prompt> = serde_json::from_slice(&bytes).map_err(|_| "Prompt library is damaged; no data was overwritten")?;
    validate(&items)?;
    Ok(items)
}
#[tauri::command]
pub fn list_prompts<R: Runtime>(app: AppHandle<R>) -> Result<Vec<Prompt>, String> {
    let _guard = LOCK.lock().map_err(|_| "Prompt storage unavailable")?;
    let file = app.path().resolve("prompt-library.json", BaseDirectory::AppLocalData).map_err(|e| e.to_string())?;
    read(&file)
}
fn apply(items: &mut Vec<Prompt>, mutation: Mutation, now: u64) -> Result<(), String> {
    match mutation {
        Mutation::Save { id, title, prompt, category } => {
            if let Some(id) = id {
                let p = items.iter_mut().find(|p| p.id == id).ok_or("Prompt no longer exists")?;
                p.title = title.trim().into(); p.prompt = prompt; p.category = category.trim().into(); p.updated_at = now;
            } else {
                items.push(Prompt { id: uuid::Uuid::new_v4().to_string(), title: title.trim().into(), prompt, category: category.trim().into(), pinned: false, color: "default".into(), created_at: now, updated_at: now });
            }
        }
        Mutation::Delete { id } => {
            let index = items.iter().position(|p| p.id == id).ok_or("Prompt no longer exists")?;
            items.remove(index);
        }
        Mutation::Pin { id, pinned } => {
            let p = items.iter_mut().find(|p| p.id == id).ok_or("Prompt no longer exists")?;
            p.pinned = pinned; p.updated_at = now;
        }
        Mutation::Color { id, color } => {
            let p = items.iter_mut().find(|p| p.id == id).ok_or("Prompt no longer exists")?;
            p.color = color; p.updated_at = now;
        }
    }
    validate(items)
}
#[tauri::command]
pub fn mutate_prompt<R: Runtime>(app: AppHandle<R>, mutation: Mutation) -> Result<Vec<Prompt>, String> {
    let _guard = LOCK.lock().map_err(|_| "Prompt storage unavailable")?;
    let file = app.path().resolve("prompt-library.json", BaseDirectory::AppLocalData).map_err(|e| e.to_string())?;
    let mut items = read(&file)?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "System clock unavailable")?.as_secs();
    apply(&mut items, mutation, now)?;
    crate::atomic_store::write(&file, &serde_json::to_vec(&items).map_err(|_| "Unable to serialize prompt library")?)?;
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn editing_and_pinning_preserve_other_prompts() {
        let mut rows = vec![];
        for title in ["One", "Two"] {
            apply(&mut rows, Mutation::Save { id: None, title: title.into(), prompt: "Body".into(), category: "".into() }, 1).unwrap();
        }
        let id = rows[0].id.clone();
        apply(&mut rows, Mutation::Pin { id: id.clone(), pinned: true }, 2).unwrap();
        apply(&mut rows, Mutation::Save { id: Some(id), title: "Edited".into(), prompt: "New".into(), category: "Work".into() }, 3).unwrap();
        assert!(rows[0].pinned);
        assert_eq!(rows[0].created_at, 1);
        assert_eq!(rows[1].title, "Two");
    }
    #[test]
    fn corrupt_library_is_an_error_and_remains_untouched() {
        let file = std::env::temp_dir().join(format!("flowpilot-prompt-test-{}", uuid::Uuid::new_v4()));
        fs::write(&file, b"broken json").unwrap();
        assert!(read(&file).is_err());
        assert_eq!(fs::read(&file).unwrap(), b"broken json");
        fs::remove_file(file).unwrap();
    }
}
