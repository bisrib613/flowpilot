//! Fixed-field diagnostic sink, enabled only in diagnostic builds.
#[cfg(all(windows, feature = "diag"))]
pub(crate) fn diag(event: &str, detail: &str) { crate::webview_diagnostics::command_event(event, detail); }
#[cfg(not(all(windows, feature = "diag")))]
pub(crate) fn diag(_event: &str, _detail: &str) {}
