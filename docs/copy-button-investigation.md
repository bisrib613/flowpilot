# Service Copy button investigation

Reported on Claude: Copy fails both in the hover toolbar and below the response in the same profile, while Edit works and other profiles can copy. Hover alone is not the cause. Screenshots cannot establish whether pointer delivery, page handling, or the browser clipboard operation fails.

The PR preview 1.5.15 explicitly focuses newly created foreground child WebViews, matching the existing cached-view path. Background preloads still request no focus. This removes a lifecycle inconsistency; it is not proof of the reported bug's root cause or resolution.

The PR installer temporarily enables the existing `diag` feature. Trusted Claude, ChatGPT and Flow top-level pages record pointerdown, pointerup, click, focus, visibility, and recent-copy unhandled rejection categories. The probe is passive and does not replace clipboard APIs, cancel clicks, or change page focus. Native logging accepts only fixed event/control categories and boolean flags, plus the native WebView label. It records no conversation text, clipboard data, page URLs, error messages, credentials, or button labels.

On Windows, the diagnostic file is `%TEMP%\Flowpilot\flowpilot_diag.log`, avoiding the potentially read-only installation directory. Compare one failed Copy click with a working profile. A `click control=copy` record establishes delivery to the page capture listener, not successful completion of the site's handler. `prevented=1` only means preventDefault was observed, not necessarily a defect. A nearby rejection is a correlation, not proof that the clipboard produced it. Missing click records alone do not prove an overlay: icon-only buttons without descriptive attributes may be classified as `other`.

The frontend build and isolated JS probe checks can run locally. Rust/COM and real input behavior require the Windows build and the affected profile. Keep this bug open until both Copy locations work on the affected profile after switching and background preloading. Do not grant clipboard-read permission or delete profile data as a speculative workaround.
