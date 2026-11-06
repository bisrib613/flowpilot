# Approved Flowpilot redesign

The approved reference is [Nadibear Accounts](https://www.figma.com/design/p0dtyZz5MxyzWDlrmyAQ8j?node-id=2-313) and its Workspace frame `2:943`. This implementation replaces the dark account-manager shell with the approved blue-grey frame, subdued inset sheet, 56px profile rows, pink primary actions, and IBM Plex Sans. The comfort revision below supersedes the original white surface and underline-only switcher.

## Restore point

Before any implementation edits, the remote branch [`backup/pr14-before-approved-redesign-20261104`](https://github.com/bisrib613/flowpilot/tree/backup/pr14-before-approved-redesign-20261104) was created and verified at `6301e34791302c8dd1bb1c484d89a645d7b6cde6`. A local Git bundle, working-tree archive, and binary patch were also captured. Main remains unmerged.

## Behavior

- Reuse the same profile switcher in Accounts and Workspace. It retains the current service's open profile and existing paging, and uses the selected list sort. Neighbor preloads follow that same order.
- Show Resume only for an in-memory workspace target; this does not assert that the account is authenticated.
- Show the Flow session source from actual profile metadata. Counts, profile identities, and favorites remain data driven.
- Preserve Add account, bulk share, search, manual drag, sorting, bookmarks, and all three Close scopes. Position profile menus within the viewport, including the last row of a scrolled list.
- Bundle the three font weights and Figma icon exports locally. Font redistribution terms are in `public/fonts/OFL.txt`.
- Retain the native service WebView and its measured DOM bounds. Do not restyle Claude, ChatGPT, or another service's own content.
- This change does not alter authentication, session directories, deletion rules, or the Rust backend.

## Validation

- `npm run build`: all 87 existing Node checks, TypeScript, and the production Vite build pass.
- Manual Chromium browser review at 1440×900 and 1366×768, using illustrative profile fixtures and mocked native IPC: row geometry, bundled assets, resume, bottom-row menu/Rename, search, sort/switcher consistency, favorites, Add account/cancel, and Settings navigation pass without page errors.
- React lifecycle exercise with mocked IPC: independent service resume, Accounts/back, Add account/cancel, and current-profile/service/all-service Close scopes pass.
- Windows NSIS packaging uses the existing PR-only workflow, with preview version 1.5.14. This is not a stable release.

The browser review cannot validate real Windows WebView2 rendering, native focus/clipboard behavior, OAuth, or rounded clipping of a native child WebView. Those still require a Windows installer smoke test; a successful package build alone does not verify them.

## Comfort and current-profile revision

Restore point: local branch `backup/pr14-before-comfort-revision-20261104` at `1edb4a2`. This is a refinement of the approved layout for long desktop sessions, rather than a new composition.

UX priority: identify the account currently in use immediately and reduce the large bright surface. Taste App Screens is the main interface guide; AntiSlop checks purposeful styling; OpenDesign supplies the visual and interaction review. Existing framed-sheet direction and IBM Plex Sans remain. The filled blue current-profile tab is an explicit user-approved exception to the guide's neutral navigation default. It expresses real current-account state, not authentication or whether every other profile is open.

### Surface and state tokens

| Role | Value | Purpose |
| --- | --- | --- |
| Canvas | `#bdcadd` | Shared sidebar and toolbar, lower luminance than the previous pale blue |
| Surface | `#dce3ed` | Accounts, settings, dialogs and menus; replaces broad pure white |
| Raised control | `#e8edf4` | Search and sorting controls |
| Selected row | `#c4d3e8` | Existing resumable-profile state |
| Primary ink | `#213149` | Identity and headings |
| Secondary ink | `#44546c` | Metadata and navigation, at least 4.5:1 on the canvas |
| Link/focus | `#294f91` | Actions and keyboard focus |
| Idle tab | `#cbd5e3` | Other profiles, dark text |
| Hover tab | `#b3c4dc` | Temporary pointer feedback |
| Current tab | `#355b91` / `#f1f5fb` | Persistent filled selection with semibold text and existing aria-current |
| Current hover | `#2b4e80` | Keeps the selected tab distinct while hovered |
| Primary action | `#e36a95` / `#4b1530` | Muted pink for Add account |

Tab geometry: 136px width, 36px height, 8px corners, 6px gaps inside the existing 52px switcher. The focus ring has reserved space inside the scroll container. All states preserve geometry; long names retain ellipsis and the full-name tooltip. No underline pseudo-element remains. Text sizes stay 12px metadata / 14px body / 16px sections / 22px title, with 400/500/600 weights. Floating surfaces alone receive shadows; rows stay flat. Existing disabled state and reduced-motion behavior remain.

Validation: production build and 87 existing checks pass. Chromium fixture review covers Accounts and Workspace at 1440×900 and 1366×768, active profile/resume, switcher sort, search, menu positioning, Add account/cancel and Settings. Text contrast is measured separately from overall surface luminance: passing text contrast does not establish subjective viewing comfort. Native Windows focus/clipboard and perceived brightness on the user's monitor still require the actual application.
