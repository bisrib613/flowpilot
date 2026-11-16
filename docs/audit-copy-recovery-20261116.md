# Audit fixes and Copy recovery — 1.5.40

The Copy fallback wraps text writes on top-level Claude and ChatGPT only. Normal browser writes remain first. Following a real click or keypress, a rejected or stalled write can fall back to the Windows clipboard. Native checks require the active visible service and focused main window. No clipboard reads or conversation scraping are introduced. This does not repair a site handler that never calls writeText, nor prove the original intermittent WebView issue is resolved.

Other changes: single process instance, bounded automation headers, opt-in CDP (`FLOWPILOT_AUTOMATION_CDP=1`), consistent browser environments, closure of automation service windows, bounded normal-view cache, protected profile deletion, atomic download settings, and removal of unused blob/dialog bridges. Motion state survives navigation, supports cancellation at safe boundaries, and checkpoints completed clips for resume. Ambiguous submitted clips require manual reconciliation rather than automatic resubmission.

Validation: frontend behavior tests, TypeScript and production bundle. Windows CI runs native tests before packaging. Real multi-profile Copy behavior still requires Windows runtime validation.
