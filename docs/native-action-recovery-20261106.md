# Native action failure review and cache recovery — 6 November 2026

## Evidence and starting point

Starting remote commit: `f547353a0dfdeae392a5bea890e7b8dbf82f74e7`, preview
1.5.23. The prior complete-source review is `source-review-20261106.md`.
That tree was checked again before editing. Backup branch:
`backup/pr14-before-native-failure-20261106`; a local git bundle was verified.

The user reports both Copy and Download can stop performing their action and
both recover after restarting Flowpilot. Close All also restored behavior in
earlier reports. The new videos are not tests of 1.5.23: the user explicitly
says that version has not been tried. Visual hover/loading feedback does not
establish native download delivery or successful clipboard writes.

1.5.23 fixed a separately reproduced queue backlog (91 to two resize calls in
the local fixture). It did not establish or fix the cause of these incidents.
There is still no native ProcessFailed trace for the reported incident.

## Confirmed source defect

The normal build never registered ProcessFailed handling for service children.
It reused a cached controller whenever its label existed, with no knowledge of
native process failure. The diagnostic feature only logged those events. Thus
an actual browser/main-frame process failure could leave a controller eligible
for normal cache restore until eviction or Close/Restart destroyed it.

This is a missing failure-handling path established by source inspection. It
does **not** establish that the user's incident raised ProcessFailed, or that
Copy and Download necessarily fail at the same native API.

## Correction in 1.5.24

- Each cache entry retains its usage revision and a controller-local health
  object. Foreground promotion updates the revision without resetting health.
- Normal Windows builds attach native process and successful-navigation event
  handlers. These handlers update only that health object. They do not close,
  reload, focus, or create controllers from inside a COM callback.
- BrowserProcessExited and main-frame RenderProcessExited mark the controller
  for replacement. GPU/utility/subframe events do not trigger whole-view reset.
- One RenderProcessUnresponsive event is tolerated. Two notifications within
  45 seconds mark a persistent stall; the window is an application policy, not
  a guarantee about runtime timing. Successful navigation clears stall state,
  but does not clear an exited browser/renderer state. Distant busy events are
  not counted as one continuous stall.
- On the next explicit foreground opening, a failed cached controller is closed
  and recreated through the existing creation path. Background preloading
  reports failure instead of repeatedly recreating it. A callback belonging to
  an old controller retains its old health object and cannot invalidate a new
  controller with the same profile ID.
- The current active page is not forcibly reloaded by the event handler. A
  genuinely failed or repeatedly stalled cached page may be reloaded on the
  next foreground opening; unsent in-page state is not guaranteed to survive
  controller recreation. Healthy cached views retain the previous reuse path.

There is no heartbeat, retry timer, service-page clipboard/download wrapper,
new focus workaround, external browser dependency or production test runner.
Normal builds retain diagnostics off; the existing fixed process kind/label
event is logged only with `diag`. The duplicated diagnostic-only ProcessFailed
handler was removed. Chat/clipboard contents and credentials are not inspected.
Profile directories, cookies, linked-session mapping and deletion policy are
unchanged. Main is not merged.

## Validation and limits

Local checks use the actual `webview_health.rs` and the cache/lease definitions,
functions and selected unit tests extracted from `webview_manager.rs` by
`tests/manual/check-native-health.py`. This allows std-only Rust execution
without pretending that Tauri/Windows COM runs on Linux. Covered behavior:
healthy reuse, isolated temporary busy events, repeated stalls, successful
navigation recovery, sticky exits, promotion without health reset, replacement
isolation from old callbacks, and existing background ownership leases.

The frontend's existing local tests and production compile are also run. CI
still compiles/packages only; no CI tests or runtime tests were added.
Windows packaging must independently compile the native callback integration.

No affected interactive Windows WebView2 runtime is accessible here. Neither
these state/cache tests nor successful Windows compilation prove Copy or
Download recovered in the user's profiles. This patch repairs failure-state
handling and targeted cache recovery; it does not prove prevention of the
underlying hang. Failures without native ProcessFailed signals remain open.

## Primary sources checked against pinned code

- Microsoft process-event guidance:
  https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-related-events
- Pinned Wry, including visibility, focus, download callbacks and creation:
  https://github.com/tauri-apps/wry/blob/wry-v0.55.1/src/webview2/mod.rs
- Pinned Tauri runtime dispatch and child creation:
  https://github.com/tauri-apps/tauri/blob/tauri-runtime-wry-v2.11.4/crates/tauri-runtime-wry/src/lib.rs

Pinned runtime source dispatches messages inline on its UI thread. Generic
documentation about synchronous-command deadlocks is not sufficient to claim
that Flowpilot's current run_on_ui_thread path itself necessarily deadlocks.
The drag/drop and focus-recovery upstream reports inspected do not establish
this incident's cause, so those workarounds were not added.
