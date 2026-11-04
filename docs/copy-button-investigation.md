# Service Copy button investigation

Reported on Claude: Copy fails both in the hover toolbar and below the response in the same profile, while Edit works and other profiles can copy. Hover alone is not the cause. Screenshots cannot establish whether pointer delivery, page handling, or the browser clipboard operation fails.

The PR preview 1.5.15 explicitly focuses newly created foreground child WebViews, matching the existing cached-view path. Background preloads still request no focus. This removes a lifecycle inconsistency; it is not proof of the reported bug's root cause or resolution.

The PR installer temporarily enables the existing `diag` feature. Trusted Claude, ChatGPT and Flow top-level pages record pointerdown, pointerup, click, focus, visibility, and recent-copy unhandled rejection categories. The probe is passive and does not replace clipboard APIs, cancel clicks, or change page focus. Native logging accepts only fixed event/control categories and boolean flags, plus the native WebView label. It records no conversation text, clipboard data, page URLs, error messages, credentials, or button labels.

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
