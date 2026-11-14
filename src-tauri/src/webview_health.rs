//! Controller-local state driven only by native process/navigation events.
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

#[derive(Default)]
pub struct ViewHealth(Mutex<Health>);

#[derive(Default)]
struct Health {
    exited: bool,
    last_stall: Option<Instant>,
    repeated_stall: bool,
}

pub enum Failure {
    Exited,
    Unresponsive,
    Other,
}

impl ViewHealth {
    fn state(&self) -> MutexGuard<'_, Health> {
        self.0.lock().unwrap_or_else(|error| error.into_inner())
    }

    pub fn record(&self, failure: Failure) {
        match failure {
            Failure::Exited => self.state().exited = true,
            Failure::Unresponsive => self.record_stall(Instant::now()),
            Failure::Other => {}
        }
    }

    fn record_stall(&self, now: Instant) {
        let mut state = self.state();
        // Ignore isolated busy periods; WebView2 repeats this notification
        // while its main-frame renderer remains unresponsive.
        state.repeated_stall = state.last_stall.is_some_and(|last|
            now.saturating_duration_since(last) <= Duration::from_secs(45));
        state.last_stall = Some(now);
    }

    pub fn navigation_completed(&self) {
        let mut state = self.state();
        state.last_stall = None;
        state.repeated_stall = false;
        // A late navigation event must not clear an exited browser/renderer.
    }

    pub fn needs_recreate(&self) -> bool {
        let state = self.state();
        state.exited || state.repeated_stall
    }
}

#[cfg(test)]
mod tests {
    use super::{Failure, ViewHealth};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    #[test]
    fn healthy_and_auto_recoverable_events_do_not_discard_a_view() {
        let health = ViewHealth::default();
        health.record(Failure::Other);
        assert!(!health.needs_recreate());
    }

    #[test]
    fn one_busy_event_is_tolerated_but_repeated_stalls_are_not_reused() {
        let health = ViewHealth::default();
        health.record(Failure::Unresponsive);
        assert!(!health.needs_recreate());
        health.record(Failure::Unresponsive);
        assert!(health.needs_recreate());
        health.navigation_completed();
        assert!(!health.needs_recreate());
    }

    #[test]
    fn distant_busy_events_are_not_counted_as_a_continuous_stall() {
        let health = ViewHealth::default();
        let now = Instant::now();
        health.record_stall(now);
        health.record_stall(now + Duration::from_secs(60));
        assert!(!health.needs_recreate());
        health.record_stall(now + Duration::from_secs(75));
        assert!(health.needs_recreate());
    }

    #[test]
    fn exit_cannot_be_cleared_by_a_late_navigation_or_busy_event() {
        let health = ViewHealth::default();
        health.record(Failure::Exited);
        health.record(Failure::Unresponsive);
        health.navigation_completed();
        assert!(health.needs_recreate());
    }

    #[test]
    fn old_callbacks_cannot_poison_a_replacement_with_the_same_profile_id() {
        let old = Arc::new(ViewHealth::default());
        let callback = old.clone();
        let replacement = Arc::new(ViewHealth::default());
        callback.record(Failure::Exited);
        assert!(old.needs_recreate());
        assert!(!replacement.needs_recreate());
    }
}
