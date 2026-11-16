//! One rollback boundary for a newly created native child, not cached reuse.
pub fn initialize<T>(
    setup: impl FnOnce() -> Result<T, String>,
    rollback: impl FnOnce() -> Result<(), String>,
) -> Result<T, String> {
    match setup() {
        Ok(value) => Ok(value),
        Err(error) => match rollback() {
            Ok(()) => Err(error),
            Err(cleanup) => Err(format!("{error}; WebView cleanup failed: {cleanup}")),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::initialize;
    use std::cell::{Cell, RefCell};

    #[test]
    fn each_setup_failure_rolls_back_the_created_child_exactly_once() {
        for background in [false, true] {
            for fail_at in 0..4 {
                let live = Cell::new(true);
                let tracked = Cell::new(false);
                let active = Cell::new(false);
                let cleanup_count = Cell::new(0);
                let stages = RefCell::new(Vec::new());
                let result = initialize(|| {
                    for (index, stage) in ["track", "permissions", "ports", if background { "hide" } else { "focus" }].iter().enumerate() {
                        stages.borrow_mut().push(*stage);
                        if index == fail_at { return Err(format!("failed {stage}")); }
                        if index == 0 { tracked.set(true); }
                    }
                    active.set(!background);
                    Ok(())
                }, || {
                    cleanup_count.set(cleanup_count.get() + 1);
                    live.set(false);
                    tracked.set(false);
                    active.set(false);
                    Ok(())
                });
                assert!(result.is_err());
                assert!(!live.get());
                assert!(!tracked.get());
                assert!(!active.get());
                assert_eq!(cleanup_count.get(), 1);
                assert_eq!(stages.borrow().len(), fail_at + 1);
            }
        }
    }

    #[test]
    fn successful_setup_retains_the_child_without_running_cleanup() {
        assert_eq!(initialize(|| Ok(42), || panic!("must retain the view")), Ok(42));
    }

    #[test]
    fn cleanup_failure_keeps_both_errors_visible_to_the_caller() {
        let result: Result<(), String> = initialize(|| Err("hide failed".into()), || Err("close failed".into()));
        assert_eq!(result.unwrap_err(), "hide failed; WebView cleanup failed: close failed");
    }
}
