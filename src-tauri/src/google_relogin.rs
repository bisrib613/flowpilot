//! Opt-in reauthentication for an account already recognized by Google.
//! Credentials stay in Windows Credential Manager until used on accounts.google.com.
use keyring::Entry;
use tauri::{webview::{PageLoadEvent, PageLoadPayload}, Runtime, Webview, Manager};

const CREDENTIAL_SERVICE: &str = "Flowpilot.GoogleFlow.ReLogin";
const CREDENTIAL_USER: &str = "shared-password";
const SCRIPT_TEMPLATE: &str = include_str!("google_relogin.js");

fn entry() -> Result<Entry, String> {
    Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_USER).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn google_relogin_status() -> Result<bool, String> {
    match entry()?.get_password() {
        Ok(password) => Ok(!password.is_empty()),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(error) => Err(format!("Credential Manager unavailable: {error}")),
    }
}

#[tauri::command]
pub fn google_relogin_save_password(password: String) -> Result<(), String> {
    if password.is_empty() || password.len() > 1024 {
        return Err("Provide a password (maximum 1024 bytes).".into());
    }
    entry()?.set_password(&password).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn google_relogin_disable() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Could not remove saved password: {error}")),
    }
}

// No login page receives the password unless its exact origin is Google Accounts.
// Email is optional: an unconfigured account is selected only when the chooser
// presents precisely one recognized identity.
fn account_email<R: Runtime>(webview: &Webview<R>, account_id: &str) -> Option<String> {
    let rows = crate::account_store::load_accounts(webview.app_handle().clone())
        .ok().flatten()?;
    rows.as_array()?.iter().find(|account| {
        account.get("id").and_then(|v| v.as_str()) == Some(account_id)
          && account.get("service").and_then(|v| v.as_str()).unwrap_or("flow") == "flow"
    })?.get("email").and_then(|v| v.as_str()).map(str::to_owned)
}

pub fn on_page_load<R: Runtime>(
    webview: &Webview<R>,
    payload: PageLoadPayload<'_>,
    account_id: &str,
) {
    if payload.event() != PageLoadEvent::Finished ||
        payload.url().scheme() != "https" ||
        payload.url().host_str() != Some("accounts.google.com") {
        return;
    }
    let Ok(password) = entry().and_then(|e| e.get_password().map_err(|_| "no credential".to_string())) else {
        return;
    };
    if password.is_empty() { return; }
    let email = account_email(&webview, account_id).unwrap_or_default();
    let Ok(email_json) = serde_json::to_string(&email) else { return };
    let Ok(password_json) = serde_json::to_string(&password) else { return };
    let script = SCRIPT_TEMPLATE
        .replace("__FLOWPILOT_EMAIL__", &email_json)
        .replace("__FLOWPILOT_PASSWORD__", &password_json);
    let _ = webview.eval(script);
}

#[cfg(test)]
mod tests {
    use super::SCRIPT_TEMPLATE;

    #[test]
    fn script_only_targets_google_accounts_and_recognized_choices() {
        assert!(SCRIPT_TEMPLATE.contains("https://accounts.google.com"));
        assert!(SCRIPT_TEMPLATE.contains("choices.size === 1"));
        assert!(SCRIPT_TEMPLATE.contains("sessionStorage.getItem(armKey)"));
        assert!(!SCRIPT_TEMPLATE.contains("input[type=email]"));
    }
}
