# Full-source review — 6 November 2026

## Snapshot and scope

PR14 branch: `feat/claude-platform-relogin-scope-20261102`.
Remote starting commit: `1195b11ce8e6b96b9b0d6c48bba1970789973e01`,
tree `09fb0e6e3b74fc79250dd128e95aab869972ff76` (preview 1.5.22).
All 30 tracked files under `src/` and `src-tauri/src/` were reread, together
with the tests, commands/permissions, configuration, installer, workflows and
support scripts. Generated dependencies, lockfile contents and binary assets
are not application source and were not read line by line.

Before editing, remote backup `backup/pr14-before-resize-review-20261106`
was created at that commit, and a complete local git bundle was verified.
Main was not merged. This is a source review, not a claim that every native
path has been exercised.

## Confirmed defect and correction

`FlowShell` scheduled resize through RAF, but each frame could still append
another captured rectangle to the shared FIFO while native work was pending.
Both window resize and ResizeObserver feed that path. Returning to normal
window size did not remove already queued rectangles.

Measured with the production React build and mock IPC: hold the first native
resize unresolved; make 45 panel-size changes 40 ms apart while also dispatching
window resize; release the held call and count native invocation starts.

| Measurement | Starting source | Patched source |
| --- | ---: | ---: |
| Resize invocations after drain | 91 | 2 |
| Final rectangle width | 1056 | 1056 |
| Actual panel width | 1056 | 1056 |

These are counts for this stimulus and browser, not universal event ratios or
Windows performance measurements. The first call deliberately stalls; the
second patched call samples the latest rectangle after the first settles.

The correction adds backpressure to the existing effect: one outstanding
resize, a dirty flag, and at most one subsequent RAF reading current bounds.
It retains the existing FIFO and disposed/stopped checks. It does not add a
retry loop, a new controller manager, focus manipulation or a clipboard shim.
The runtime diff is 13 added lines and one removed line in `App.tsx`.

## Copy / renderer findings and limits

- The user reports Restore Down does **not** restore the failed Copy button;
  Close All and application restart do. Maximize is a possible trigger, not
  an established cause. The resize correction is **not a verified Copy fix**.
- The existing diagnostic capture reaches trusted Copy click handling with
  focus, visibility and user activation. That establishes delivery to the
  diagnostic listener, not completion of Claude's handler or clipboard write.
  No new failing/healthy 1.5.22 native trace or process stack is available.
- Cached restore does position, size, show and the standard Tauri set_focus.
  New foreground views also request focus; background preloads do not. No
  additional MoveFocus workaround is justified by the available evidence.
- Pinned Wry 0.55.1 installs its parent WM_SIZE/focus subclass only for a
  non-child WebView. The theory that each child overwrites that subclass is
  inconsistent with that source. Flowpilot child bounds use the shell path.
- `enable_clipboard_access` in pinned Wry auto-allows CLIPBOARD_READ. Enabling
  it would not establish a remedy for user-gesture Copy and was not added.
- Upstream WebView2 #5613 requires HostInputProcessing plus a drag/drop
  sequence. Neither condition is established here; no drag/drop or runtime
  switch was applied as a speculative remedy. Old WPF/DPI rendering reports
  likewise do not establish the cause in this Tauri application.
- Normal builds do not install the legacy blob script, modify clipboard
  prototypes, intercept service fetch/SSE, or call TrySuspend/Resume. Existing
  optional diagnostics remain off in the normal installer.

Remaining source findings from `source-review-20261105.md` were checked again:
normal-build ProcessFailed handling is absent; account persistence/profile
operations are not transactional; there is no cross-service resource budget;
cache-maintenance environment arguments differ from shared Flow arguments;
operation locks span native calls; disconnected blob/debug-dialog code remains.
These are separate correctness/maintenance issues, not proven causes of Copy.
The creation rollback and write-only visible state findings were addressed in
1.5.22; they must not be reported as still unfixed. The code is not being
certified as fully following best practice.

## Validation

- 93 local Node tests, TypeScript and Vite production build passed.
- The committed manual check `tests/manual/workspace-resize.mjs` passed:
  blocked resize burst, final bounds, Back/switch-profile while blocked, and Close All
  while blocked. No obsolete dirty resize ran between the old call and hide.
- Seven existing production-React/mock-IPC lifecycle checks passed, including
  slow open, sidebar resume, bookmark hide/restore, narrow/full view, close
  scopes, and error recovery. No page errors were observed.
- These browser checks mock native IPC. They do not reproduce Windows
  maximize, WebView2 pointer/clipboard behavior, renderer hangs or streaming.
- No Windows desktop/runtime is accessible here. Copy Claude and delayed
  ChatGPT rendering remain **unresolved**. A Windows build only verifies
  compilation/packaging; it cannot close those issues.

PR installer version is 1.5.23 to identify this bounded-resize correction.
CI continues compilation and packaging only. Tests are not embedded in the
EXE. Service pages, sessions, folder mapping and deletion rules are unchanged.

## Primary source checks

- https://github.com/tauri-apps/wry/blob/wry-v0.55.1/src/webview2/mod.rs
- https://github.com/tauri-apps/tauri/blob/tauri-v2.11.5/crates/tauri/src/webview/mod.rs
- https://github.com/MicrosoftEdge/WebView2Feedback/issues/5613
- https://github.com/MicrosoftEdge/WebView2Feedback/issues/2247
- https://github.com/MicrosoftEdge/WebView2Feedback/issues/5706
