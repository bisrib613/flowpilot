# Approved Flowpilot redesign

The approved reference is [Nadibear Accounts](https://www.figma.com/design/p0dtyZz5MxyzWDlrmyAQ8j?node-id=2-313) and its Workspace frame `2:943`. This implementation replaces the dark account-manager shell with the approved light blue frame, white inset sheet, 56px profile rows, pink primary actions, and IBM Plex Sans.

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
