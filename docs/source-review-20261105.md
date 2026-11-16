# Full-source review follow-up — 5 November 2026

## Snapshot and evidence

Reviewed branch: `feat/claude-platform-relogin-scope-20261102`, PR14.
Remote HEAD before this patch: `47896c3cb455b66397df6c18ae00ddfd81131251`,
tree `a6913f50df9758194d127c66090ffffc2a1cb26e`, installer 1.5.20.
The user explicitly confirmed that this version is affected and that Close All
Service restores functionality without restarting Flowpilot. Whether Close
Platform alone restores it has not been established.

This continues the complete source reading recorded in the 4 November review;
the current remote tree was checked against the local tree and its lifecycle
changes were reviewed. Scope: all 29 files in `src/` and `src-tauri/src/`, about
6,256 lines before this patch, plus tests, permissions/capabilities, configuration,
installer, workflows and support scripts. Vendor/generated/binary assets are
excluded. This is not a claim to have run every native path.

Backup: `backup/pr14-before-source-review-20261105` at the remote SHA above;
a local git bundle was also created before edits. Main is not merged.

## What Close All actually resets

`FlowShell.closeWorkspaces` stops shell work and queues `close_workspaces`.
Native code cancels the preload epoch and targets, closes cached service
controllers and their popups, removes their cache/automation-port entries and
clears the active key when that controller is destroyed. The frontend clears
remembered workspaces. Session files and cookies are not erased.

`Close Platform` uses the same destroy path filtered by service. `Close Current`
filters by one profile. Back/Accounts only hides the active view. These are
different lifecycle operations, despite similar words in the interface.

Reopening after Close All creates fresh controllers and reloads the service
page. Therefore recovery narrows the problem to state surviving while those
views stay alive, but does not distinguish controller/process state from page
JavaScript or response connections. Since Close All can execute, a permanent
deadlock of the entire application's main UI thread is less consistent with
this observation. Intermittent stalls and partial renderer hangs remain possible.
No new failure log or Windows process/stack capture was supplied in this turn.

## Findings and disposition

| Priority | Finding | Evidence and effect | Disposition |
| --- | --- | --- | --- |
| P1 | Native renderer failures have no normal-build application handling | `ProcessFailed` is only attached under Windows + `diag`; its handler logs, without recovery or informing the shell. A successful open is treated as a usable view thereafter. | Open. Actual process failure in the user's incident is not established. Do not force reload chats without classifying the event. |
| P1 | Account metadata and profile operations are not transactional | Single Add displays a row before native metadata is saved; autosave failure leaves Open enabled. Delete may remove owned browser data before index persistence succeeds. | Open, unchanged. Requires a storage transaction/recovery change, preserving directory ownership policy. |
| P2 | Timed-out native work could still run later | `run_on_ui_thread` used `mpsc.recv_timeout` on a blocking worker. Timing out stopped waiting, not the queued UI closure. A later old hide/open could mutate a newer workspace. | Corrected here for work still queued when its receiver has closed; not established as the reported hang's cause. |
| P2 | Preload has no global resource budget | `prepare_workspace` prunes only the selected service. Default two neighbors per side retains up to five views/service; configured maximum five/side permits eleven/service. Six services can retain up to 30/default or 66/maximum workspace views, before temporary jobs/popups. These are controller counts, not process counts. | Open. No RAM/CPU measurements prove resource exhaustion. Do not silently evict remembered user work or suspend a streaming page. |
| P2 | Native creation is not failure-atomic | `add_child` precedes fallible setup/hide/focus and final cache registration. A later error can leave a live child absent from `cached_accounts`; bulk destruction enumerates that cache. | Open, source failure path. No evidence this path ran in the affected profiles. |
| P2 | Operation locks span synchronous native creation/navigation | `operation` is a non-reentrant mutex held across native calls; entry points are generally dispatched to the UI thread already. Callback reentry could block. | Risk, not a demonstrated deadlock. Audit callback dispatch/stack before changing synchronization. |
| P2 | Cache maintenance creates a different environment configuration | Hidden maintenance views use the same data directory without the Flow/shared-session browser arguments. | Open compatibility risk; no captured environment error proves this occurred. |
| P3 | Production carries disconnected experimental download code | Old blob initialization script has no installer; labels/capability use `google-flow-*` while current views use `flowpilot-service-*`. Blob/debug-dialog commands remain registered. Actual downloads use `native_downloads::handle`. | Remove separately with permission/caller review. It is not evidence that downloads or clipboard are causing this hang. |
| P3 | Lifecycle and UI responsibilities are concentrated | `App.tsx` is 2,152 lines; manager is 1,255. Settings, account mutations, batch jobs and workspace control share large files. `visible` is written but not read; obsolete `shortcutBounds` remains tested. | Refactor along ownership boundaries after behavior is covered; file size alone does not cause a freeze. |
| P3 | Optional diagnostics perform synchronous file writes in native callbacks | `webview_diagnostics::log_event` writes/flushes per event with no rotation. | Default 1.5.20 build has diagnostics off. Relevant to diagnostic builds, not an explanation for this confirmed normal-build incident. |

Some controls are already sound: validated service/profile identifiers, scoped
download permission checks, linked-directory deletion protection, ordered account
writes, preload epochs, full-list switcher rendering, and foreground ownership
leases. Keeping these is preferable to replacing the lifecycle wholesale.

The 1.5.20 lease, single hide owner and shell FIFO corrections address specific
source races. This user's confirmation means they did not resolve the reported
Copy/hang symptom. Previous findings about default clipboard prototype wrappers
and the extra COM focus helper are historical: those were removed in 1.5.20.
Standard `set_focus()` remains. Its underlying MoveFocus call is not proof of
clipboard success or renderer health.

## Patch boundaries

`run_on_ui_thread` now awaits a Tokio oneshot with an async timeout. Once the
receiver has closed, a still-queued closure skips its operation. It no longer
occupies a blocking-pool worker just to await each controller command. This does
not interrupt COM work already started, undo side effects, or repair a renderer.
The check and invocation are not an atomic cancellation barrier; timeout racing
with a start is an in-flight operation. No retry, forced focus, clipboard wrapper,
automatic reload, new diagnostic framework or cache-eviction heuristic was added.

A misleading download allowlist comment was corrected: this code permits
multiple automatic downloads, not clipboard reads/writes. PR packaging version
is 1.5.21 so the small dispatch correction can be distinguished from 1.5.20.
No service UI, sessions, profile directory mapping or deletion rules changed.

## Validation and remaining native work

- Locally: 92 Node tests, TypeScript and Vite production build passed.
- These tests do not exercise the new Rust dispatch path or native WebView2.
  No local Rust compiler or interactive Windows WebView2 runtime is available.
- Windows compilation/packaging must be checked for the new PR commit. CI runs
  compilation/packaging only; no test job was added.
- Copy Claude and delayed ChatGPT rendering remain unresolved. No native success
  is inferred from DOM preview, unit tests, compilation or Close All recovery.

The distinguishing native comparison is affected vs healthy profile with the
same runtime, before/after profile switch and preload, then Close Current,
Close Platform and Close All. Record controller lifecycle/process-failure kinds,
runtime version and controller/resource counts; do not record chat, clipboard,
credentials or tokens. Determine whether controller-only recreation, a shared
environment teardown or merely page reload is the necessary boundary. Existing
logs in `%TEMP%/Flowpilot/flowpilot_diag.log` are from diagnostic builds; the normal
1.5.20 installer does not produce new diagnostic events.

## Primary references

- https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-related-events
  — process failures, renderer unresponsiveness and event-specific recovery.
- https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/threading-model
  — UI-thread callbacks and reentrancy restrictions.
- https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/performance
  — measure real content and manage inactive-view resources.
- https://docs.rs/tokio/1.53.1/tokio/sync/oneshot/struct.Sender.html
- https://docs.rs/tokio/1.53.1/tokio/time/fn.timeout.html
