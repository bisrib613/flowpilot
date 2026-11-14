# Flowpilot shell revision

The shell is an operational workspace, not a dashboard or a marketing surface.
Keep the platform sidebar, flat profile rows, rounded horizontal profile switcher,
and the service's native UI. Do not inject shell styles into service WebViews.

## Surfaces and hierarchy

The shell uses low-saturation neutral surfaces: canvas `#cacdce`, content
`#e1e3e3`, raised controls `#eef0ef`. Large fields carry no blue wash. Blue
`#365f84` identifies the current profile and keyboard focus. Primary management
actions use charcoal `#35434b`; error text uses `#a72d4d`. No theme toggle is
needed to compensate for the shell palette.

The runtime loads one stylesheet, `src/styles/workspace.css`. The retired dark
theme files must not be reintroduced as an implicit component baseline. Typography
stays IBM Plex Sans 400/500/600. Native service logos retain their original colors.

Management and workspace outer sheets use a shared 12px horizontal gutter.
Management content has 20px inset plus its 1px border. The first switcher tab
aligns with that content inset; arrows occupy separate edge slots. The redundant
visible platform heading is removed; platform context remains in sidebar and
accessible labels. The native viewport has a thin 2px seam, not a bright bezel.

## Switcher behavior

All profiles are rendered, in the same sort order as the list. No page slicing or
Oldest/Latest More controls. The strip supports native horizontal gestures,
ordinary mouse-wheel movement while horizontal movement is possible, and left/right
scroll buttons. Wheel events at the reached edge are not canceled. Ctrl-wheel
zoom and Shift/native horizontal gestures are left to the browser. Home/End and
arrow keys move keyboard focus; Enter/Space activate the focused profile.

The active profile is persistently filled blue; hover and keyboard focus are
separate treatments. Changing the active profile reveals it without resetting
ordinary manual scrolling. Disabled edge arrows retain their slots to prevent
the tabs shifting when an edge is reached. Reduced-motion preference disables
smooth arrow scrolling.

## Modal and status behavior

Dialogs move initial focus inside, make background siblings inert, contain Tab,
close on Escape unless deletion is in flight, and restore focus after dismissal.
Delete requests have a pending lock and visible failure message; native deletion
and session ownership rules are unchanged. Errors and non-ready workspace status
remain visible at narrow widths. Batch result panels belong to the initiating
service. Help describes optional Credential Manager password storage accurately.

## Validation performed

- Existing 87 Node checks, TypeScript and Vite production build passed.
- Actual React UI with mock Tauri IPC: 100 profiles, long names, both scroll edges,
  mouse wheel, horizontal gesture, keyboard Home/End, shared sort order.
- Modal initial focus, inert background, repeated Tab, Escape, focus restoration,
  bulk Select all, and no second background dialog.
- Profile layouts at 1920x1080, 1366x768 and 540x620; dark/light host fixtures.
- Help and badge foregrounds inspected after eliminating legacy styles.

These browser checks do not exercise real Windows WebView2, OAuth, native
clipboard behavior, or Windows 125%/150% scaling. Clipboard investigation remains
open; see `copy-button-investigation.md`.

## Method references

OpenDesign `frontend-design`, pinned `web-design-guidelines`, and craft color,
laws-of-ux, state-coverage and accessibility informed this revision. Application
scanability, user requirements and actual component behavior take precedence over
generic marketing embellishments. Reference source examined at OpenDesign commit
`ce5d5dc84280ab1efafc2e3e15c382e0358857ee`.
