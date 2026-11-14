// Desktop workflows and the internal publishing implementation.

#[cfg(windows)]
pub(crate) mod browser;
pub(crate) mod flow;
pub(crate) mod motion_control;
pub(crate) mod motion_runtime;
#[allow(dead_code, unused_imports)] // Auto Post has no desktop caller yet.
pub(crate) mod publishing;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum AutomationError {
    InvalidInput(&'static str),
    LoginRequired,
    DependencyMissing(&'static str),
    Failed(String),
    // A request may have been accepted. Check the platform before retrying.
    SubmissionUnconfirmed,
}
