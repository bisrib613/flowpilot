# Workspace lifecycle correction — PR 1.5.20

The full-source review identified background cleanup closing views after a user
had opened them, and shell hide/open operations with multiple asynchronous
owners. These are source defects, not proof of the cause of every reported
WebView2 hang. This change corrects those paths without another focus workaround.

## Changes

- Background bulk/check jobs capture the view's existing cache revision. A
  foreground reuse or replacement changes that revision. Old cleanup returns
  without closing the view or popups when it no longer owns that revision.
- Owned temporary cleanup uses the existing destroy_view path so active/visible
  state is cleared consistently. Existing user views remain cached.
- Shell prepare/preload/hide/show/resize/navigation/close use one FIFO command
  path. Superseded effects skip queued operations; cleanup hide precedes the
  following activation. A failed command propagates to its caller and does not
  poison the queue. There are no automatic retries or chat reloads.
- Back changes shell navigation; effect cleanup is its single hide owner.
  FlowShell is keyed by service/account so an old asynchronous callback cannot
  write into a different account's workspace state.
- Resize work is grouped per animation frame, ordered with controller commands,
  cancelled on disposal, and errors are reported instead of silently ignored.
- Removed the direct COM focus-result helper. The normal Tauri focus path remains.
- Removed clipboard prototype/promise wrappers. The normal PR installer builds
  without diag. Optional native diagnostics remain read-only and are not installed
  by the default installer.

No service-page layout, cookies, session directories, login policy, or directory
deletion rule is changed. Metadata transactions and unrelated deadcode cleanup
from the full-source review are separate work, not included in this patch.

## Validation

Locally executed:

- 92 Node tests, TypeScript, and production Vite build.
- Five queue regressions execute the real workspace-commands module: slow old
  prepare before cleanup/new open; Back/resume of the same account; discarded
  preload; failed native command followed by a successful command; bookmark order.
- Production React with mocked native IPC: slow prepare -> Back -> same-profile
  resume leaves the simulated native view visible and sends one cleanup hide;
  per-service resume; bookmark hide/restore/navigation; 540/1366 widths and Full
  View; Close profile/service/all; a failed prepare followed by a successful open.
  No page errors were observed in that fixture.

Rust includes a lease regression using the actual cache state and ownership
guard: temporary -> foreground promotion -> switching away, removal, and a new
instance with the same account ID. It has not been executed locally because this
Linux environment has no Rust compiler. CI remains compilation/packaging only,
as requested; do not count that Rust test as passed merely from an installer build.

Windows installer compilation/packaging is checked on the PR commit. This is not
interactive validation of native controller teardown, clipboard, rendering or
real ChatGPT response streaming. Those reported native symptoms remain open
until the affected runtime is exercised. The mock IPC visibility result must not
be presented as proof of native hang or Copy recovery.

## Follow-up native checks

Exercise user-open during bulk/check completion, rapid Back/resume, cross-service
switching while streaming, bookmark hide/restore, and profile/service/all close.
Neither restarting the app nor automatic reload is a proposed product fix.
If a freeze remains, correlate controller/process state with the failed run;
do not add another focus/clipboard patch without evidence.
