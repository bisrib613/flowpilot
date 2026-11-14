# Service Copy button investigation

## Current status — PR preview 1.5.24

The user reports Copy and Download both recover after application restart.
The new videos precede the user's test of 1.5.23; that preview is untested on
their affected profiles. 1.5.23's bounded resize queue was not a proven remedy.

Normal service children now retain native process-failure health in their cache
entry. A browser/main renderer exit, or repeated unresponsive notifications,
prevents reuse on the next foreground opening: that controller is recreated
without changing its profile directory. Background preload does not loop
recreation, and callbacks never destroy/reload controllers. Healthy views keep
their existing reuse path. See `native-action-recovery-20261106.md` for exact
policy, local checks and limitations. An actual ProcessFailed signal during
the user's incident has **not** been observed. Copy/Download resolution remains
unverified; this corrects missing native failure handling, not a proven cause.

## Previous status — PR preview 1.5.23

The user confirmed Restore Down does not restore failed Copy. The complete
source reread found and reproduced a separate resize backlog: one blocked
native call followed by 45 panel/window resize changes drained 91 invocations.
The existing effect now permits one outstanding resize and samples latest
bounds on a dirty follow-up; the same local browser fixture drained two calls.
Back/resume and Close All during a blocked resize were also checked.
This is not a native Copy or ChatGPT rendering reproduction. Both reported
failures remain unresolved. See `source-review-20261106.md` for evidence,
source scope, remaining findings and verification limits.

## Previous status — PR preview 1.5.22

The user confirmed preload is two profiles per side. The reported profile-3
failure clears after visiting other profiles, but the furthest visited profile
is uncertain. With fixed ordering, profile 3 is retained through profile 5 and
evicted at profile 6. Do not infer reuse versus recreation without the actual
sequence. Close All also restores functionality according to the user.

1.5.21 cancels abandoned queued UI work after timeout. 1.5.22 registers newly
created children before fallible setup and rolls back setup errors using the
common destroy path. A failed destroy leaves the cache entry available for a
later cleanup attempt. Neither correction establishes the user's failure cause.
See `preload-lifecycle-20261105.md` for scope and validation limits.

Copy and delayed ChatGPT rendering remain open. No extra focus workaround,
clipboard wrapper, automatic reload or forced change to preload settings was
added. Normal builds still omit optional diagnostics.

## Lifecycle correction — PR preview 1.5.20

The normal PR installer no longer enables `diag`. The clipboard prototype and
promise wrappers introduced in 1.5.18 have been removed, including from the
optional diagnostic script. Foreground focus again follows Tauri's existing
set_focus path; the additional direct-COM focus result helper has been removed.
MoveFocus was not established as a Copy or renderer-hang fix.

This revision fixes independently identified lifecycle defects: shell controller
commands execute in order, disposed effects skip queued work, Back has one hide
owner, and background cleanup checks its view revision before closing anything.
See `lifecycle-fix-20261104.md` for changes, regression checks and boundaries.
Copy recovery and the reported ChatGPT streaming/rendering hang remain subject
to verification on the affected Windows runtime. The historical previews and
diagnostic experiments below are not descriptions of the default 1.5.20 build.

Reported on Claude: Copy fails both in the hover toolbar and below the response in the same profile, while Edit works and other profiles can copy. Hover alone is not the cause. Screenshots cannot establish whether pointer delivery, page handling, or the browser clipboard operation fails.

The PR preview 1.5.15 explicitly focuses newly created foreground child WebViews, matching the existing cached-view path. Background preloads still request no focus. This removes a lifecycle inconsistency; it is not proof of the reported bug's root cause or resolution.

The PR installer temporarily enables the existing `diag` feature. Trusted Claude, ChatGPT and Flow top-level pages record pointerdown, pointerup, click, focus, visibility, and recent-copy unhandled rejection categories. The original probe was passive; diagnostic preview 1.5.18 additionally observes clipboard write results as described below. Native logging accepts only fixed event/control categories and boolean flags, plus the native WebView label. It records no conversation text, clipboard data, page URLs, error messages, credentials, or button labels.

On Windows, the diagnostic file is `%TEMP%\Flowpilot\flowpilot_diag.log`, avoiding the potentially read-only installation directory. Compare one failed Copy click with a working profile. A `click control=copy` record establishes delivery to the page capture listener, not successful completion of the site's handler. `prevented=1` only means preventDefault was observed, not necessarily a defect. A nearby rejection is a correlation, not proof that the clipboard produced it. Missing click records alone do not prove an overlay: icon-only buttons without descriptive attributes may be classified as `other`.

The frontend build and isolated JS probe checks can run locally. Rust/COM and real input behavior require the Windows build and the affected profile. Keep this bug open until both Copy locations work on the affected profile after switching and background preloading. Do not grant clipboard-read permission or delete profile data as a speculative workaround.

## Continued investigation, PR preview 1.5.17

Source inspection found no shell handler that cancels service Copy clicks or
replaces `navigator.clipboard`. The permission handler only grants trusted-origin
multiple downloads; other permissions retain WebView2 defaults. Both cached and
new foreground views explicitly receive focus; background views request no focus.
Closing/hiding a view is distinct from destroying it. None of these facts proves
the affected profile is focused or permitted at the instant its Copy handler runs.

No affected Windows profile or diagnostic log is available in the build environment.
There is therefore no verified root-cause patch for this intermittent problem.
Do not present the shell revision as a clipboard fix.

The diagnostic preview now correlates `WorkspaceLifecycle` events (open request,
created/restored focus, preload hidden, hidden, destroyed) with the existing
per-WebView pointer/focus probe. `PermissionRequested` records only the WebView
label and WebView2's numeric permission kind; it does not read the requesting URL,
change a permission decision, or log clipboard contents. A passive `copy-event`
record observes legacy DOM copy events without reading ClipboardEvent data.
Async `writeText` need not emit a DOM copy event; absence is not proof of failure.

On an affected Windows run, compare a healthy profile's Copy action with the
affected profile before restart. Include both hover and response-footer Copy,
then profile switching and background preload. Inspect click delivery, focus,
visibility, user activation, recent rejection category, permission requests and
lifecycle order. Repeat after restart without deleting any profile data. The
diagnostic log remains `%TEMP%\Flowpilot\flowpilot_diag.log`.


## User log comparison and diagnostic preview 1.5.18

Two user-supplied logs on 2026-11-04 contain 8 Copy clicks in one Claude
WebView and 2 in a second WebView. Every recorded Copy click has focus,
visibility, activation, trusted input and hit flags set to 1, and prevented set
to 0. There is no recorded permission request or unhandled rejection. The user
also reports that the Copy icon never changes to a checkmark when broken.
The logs do not label successful clipboard writes, so neither view can be
classified as healthy from the log alone. Capture-phase event delivery does
not establish site-handler execution or successful clipboard completion.

The earlier passive log is insufficient to distinguish a site-caught rejection
from a missing handler call. Diagnostic builds now wrap `Clipboard.writeText`,
`Clipboard.write`, and only the copy command of `Document.execCommand` before
site initialization. Each call delegates once to the original with its original
receiver and arguments. Async success values and identical rejection objects
are propagated to the caller. Other execCommand operations pass through.
There is no retry, permission grant, native fallback, or content inspection.

Fixed-enum records: `probe-installed` / `probe-unavailable`, `write-start`,
`write-ok`, `write-error`, `write-false`, and `write-pending` (still unsettled
after 3 seconds). Only the method or allowlisted error category is logged.
No argument, returned content, error message, button label or SVG is logged.
`write-ok` means the browser API fulfilled, not independently verified system
clipboard contents or UI checkmark rendering. Clicks with no write-start require
investigating the site handler path; they do not by themselves prove a site bug.
Overlapping calls have no unique correlation ID in this version.

This instrumentation changes function identity and async promise identity and
adds a settlement microtask. It may influence timing; compare uninstrumented
behavior before declaring any cause fixed. The production build without the
Windows diag feature does not install the probe. This is diagnostic progress,
not a verified clipboard fix. Native Windows reproduction remains unavailable
in the Linux build environment. The user's failed state must be validated in
the diagnostic installer and subsequently in an uninstrumented candidate fix.

Local isolated checks cover success, rejected promise, synchronous throw,
pending operation, unchanged receiver/arguments, unchanged edit commands and
fixed-field payloads. Payload/error-message access traps verify those contents
are not inspected. These checks do not validate WebView2 native clipboard.

## Native backend audit and PR preview 1.5.19

Inspected the actual locked dependency versions: Tauri 2.11.5,
tauri-runtime-wry 2.11.4, Wry 0.55.1, webview2-com 0.38.2.
Pinned upstream source (not the latest default branch):

- https://github.com/tauri-apps/tauri/blob/tauri-runtime-wry-v2.11.4/crates/tauri-runtime-wry/src/lib.rs
- https://github.com/tauri-apps/wry/blob/wry-v0.55.1/src/webview2/mod.rs
- https://github.com/tauri-apps/tauri/blob/tauri-v2.11.5/crates/tauri/src/webview/mod.rs

Confirmed a native error-propagation defect: Tauri's SetFocus message handler
logs a failed Wry focus operation but does not propagate the native HRESULT to
the caller. The public dispatch result therefore cannot acknowledge MoveFocus
success. Flowpilot workspace commands already execute on the UI thread, where
Tauri handles this dispatch inline (not necessarily queued). Earlier
`created-focused` / `restored-focused` records overstated what was confirmed.
This defect is confirmed from source, but no supplied log proves MoveFocus
failed on the affected Copy attempts.

Foreground workspace focus now invokes the same WebView2 controller MoveFocus
operation through with_webview, propagates its COM result to the command, and
logs NativeFocusRequest result=ok or error with numeric HRESULT. No extra retry,
focus stealing on Copy, clipboard-read grant, or page modification is added.
Lifecycle records are named created-focus-request-ok / restored-focus-request-ok;
even COM success is not presented as proof of final OS input focus.

Diagnostic builds additionally register native controller GotFocus/LostFocus
and CoreWebView2 ProcessFailed callbacks, and record the installed runtime's
numeric version. At Copy-click/write event receipt, NativeInputState records:

- Last controller event: 0 unknown, 1 got focus, 2 lost focus.
- Whether this UI thread has an HWND with focus and whether it is within the
  WebView container's descendant tree.
- Whether the WebView container's root HWND is the foreground window.
- Whether GetOpenClipboardWindow returns an associated window.

All HWNDs are reduced to booleans. No titles, other-app identities, clipboard
contents, process IDs, credentials or URLs are recorded by these additions.
GetOpenClipboardWindow can return null when a caller opened the clipboard with
no associated window; a false flag is NOT proof the clipboard is unlocked.
Samples occur on native message receipt and may follow the original DOM event.
The callbacks retain no controller/CoreWebView2 COM object, avoiding an
event-handler reference cycle. Partial diagnostic attachment errors are visible.

Wry 0.55.1's clipboard option grants CLIPBOARD_READ, not a clipboard-write fix.
Its constructor calls MoveFocus only when focused=true; Flowpilot background
preloads use focused(false). Child views do not attach the single-view parent
focus subclass. These observations do not establish whether an installed
WebView2 runtime has an intermittent per-controller defect.

Native focus behavior follows the controller API contract:
https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2controller
Clipboard-open-window caveat:
https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getopenclipboardwindow

The Copy bug remains open. The Linux environment cannot exercise the user's
Windows runtime/profile. Windows CI can verify compilation and packaging, not
native clipboard recovery. Keep testing both Copy locations after switching
and preloading; do not infer recovery from diagnostics or a successful build.
