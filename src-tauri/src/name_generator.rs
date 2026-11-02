//! Optional Indonesian signup names. The key never enters a service WebView.
use keyring::Entry;
use serde_json::Value;
use std::time::Duration;

const SERVICE: &str = "Flowpilot.BehindTheName";
const USER: &str = "api-key";
const DISABLED: &str = "__FLOWPILOT_NAME_GENERATOR_DISABLED__";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, USER).map_err(|_| "Credential Manager unavailable".into())
}

fn selected_key(saved: Option<&str>, environment: Option<&str>) -> Option<String> {
    let value = saved.or(environment)?.trim();
    if value.is_empty() || value == DISABLED { None } else { Some(value.to_string()) }
}

fn configured_key() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(key) => Ok(selected_key(Some(&key), None)),
        Err(keyring::Error::NoEntry) => {
            let value = std::env::var("BEHIND_THE_NAME_API_KEY").ok();
            Ok(selected_key(None, value.as_deref()))
        }
        Err(_) => Err("Could not read name generator setting".into()),
    }
}

#[tauri::command]
pub fn name_generator_status() -> Result<bool, String> {
    configured_key().map(|key| key.is_some())
}

#[tauri::command]
pub fn name_generator_save_key(api_key: String) -> Result<(), String> {
    let key = api_key.trim();
    if key.is_empty() || key == DISABLED || key.len() > 512 || key.chars().any(char::is_control) {
        return Err("Enter a valid API key (maximum 512 characters)".into());
    }
    entry()?.set_password(key).map_err(|_| "Could not save API key".into())
}

#[tauri::command]
pub fn name_generator_disable() -> Result<(), String> {
    // Override an environment-provided key as well; Disable must stay disabled.
    entry()?.set_password(DISABLED).map_err(|_| "Could not disable name generator".into())
}

fn parse_name(payload: &Value) -> Option<String> {
    let names = payload.get("names").unwrap_or(payload).as_array()?;
    if names.is_empty() || names.len() > 6 { return None; }
    let mut parts = Vec::new();
    for value in names {
        let part = value.as_str()?.split_whitespace().collect::<Vec<_>>().join(" ");
        if part.is_empty() || part.chars().count() > 40 ||
            !part.chars().all(|c| c.is_alphabetic() || matches!(c, ' ' | '-' | '\'' | '’')) {
            return None;
        }
        parts.push(part);
    }
    let name = parts.join(" ");
    (name.chars().count() <= 100).then_some(name)
}

// Called once only after the observed signup form asks for a name. Normal
// logins spend no API quota. Errors fall back without logging URLs or bodies:
// Behind the Name requires the secret in the HTTPS query string.
pub async fn random_indonesian_name() -> Option<String> {
    let key = configured_key().ok().flatten()?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .redirect(reqwest::redirect::Policy::none())
        .build().ok()?;
    let mut response = client.get("https://www.behindthename.com/api/random.json")
        .query(&[("key", key.as_str()), ("usage", "ins"), ("number", "2")])
        .send().await.ok()?.error_for_status().ok()?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if bytes.len() + chunk.len() > 8192 { return None; }
        bytes.extend_from_slice(&chunk);
    }
    let payload: Value = serde_json::from_slice(&bytes).ok()?;
    parse_name(&payload)
}

#[cfg(test)]
mod tests {
    use super::{parse_name, selected_key, DISABLED};
    use serde_json::json;

    #[test]
    fn configured_key_precedence_and_disable() {
        assert_eq!(selected_key(None, Some(" test-environment-key ")), Some("test-environment-key".into()));
        assert_eq!(selected_key(Some("saved-key"), Some("env-key")), Some("saved-key".into()));
        assert_eq!(selected_key(Some(DISABLED), Some("env-key")), None);
        assert_eq!(selected_key(None, None), None);
        assert_eq!(selected_key(None, Some(" ")), None);
    }

    #[test]
    fn accepts_name_lists_and_normalizes_spacing() {
        assert_eq!(parse_name(&json!({"names": [" Budi ", "Santoso"]})), Some("Budi Santoso".into()));
        assert_eq!(parse_name(&json!(["Dewi", "Lestari"])), Some("Dewi Lestari".into()));
        assert_eq!(parse_name(&json!({"names": ["Ni", "Luh"]})), Some("Ni Luh".into()));
    }

    #[test]
    fn malformed_api_responses_fall_back() {
        for payload in [json!({"error": "invalid key"}), json!({"names": []}),
            json!({"names": [null]}), json!({"names": ["<script>"]}),
            json!({"names": [" "]}), json!({"names": ["a".repeat(41)]})] {
            assert_eq!(parse_name(&payload), None);
        }
    }
}
