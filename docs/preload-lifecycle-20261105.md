# Preload lifecycle correction — PR preview 1.5.22

Baseline remote commit: `e4a39b558fef31db7b7b363f7ee44acde5930944`.
Backup: `backup/pr14-before-preload-setup-20261105`, plus a local git bundle.
Work remains on PR14; no merge to main.

## Report and trace boundaries

The user confirmed two preload neighbors per side. Profile 3 initially failed
to Copy, other profiles worked, and profile 3 later recovered. The exact furthest
visited profile is unknown, possibly profile 6. Close All also restores functions.

The actual neighbor policy was executed for both sequences with fixed ordering:
profile 3 survives through profile 5, but is evicted at profile 6. Returning to
profile 1 prunes profiles 4/5; later opening 2/3 can preload them again. This is
a sliding window of sorted neighbors, not a last-five-opened LRU cache.
Policy execution assumes preloads finish and does not record actual controllers.

Reviewed paths include settings -> sorted account list -> neighbor selection ->
shell FIFO/cancellation -> UI dispatch -> native prepare/prune/create/reuse ->
background job ownership -> hide/show/close/remove and permission callbacks.
This is a targeted follow-up to the full-source review, not a claim that native
Copy or streaming was reproduced.

## Corrected defect

Previously, `add_child` succeeded before cache registration at the end of setup.
A permission-dispatch, port-map, hide or focus error could leave a created child
outside cache bookkeeping. Eviction and Close All enumerate that cache.

Now the returned child handle is used directly, registered before fallible setup,
and setup errors invoke the same `destroy_view` path used by normal eviction.
If destruction fails, its error is reported alongside the original error; cache
removal still occurs only after successful native close. There is no silent
success or automatic retry. Existing cached views do not enter this new-child
rollback boundary, so a restore error does not destroy a user's existing view.

One small Rust helper makes this rollback contract independently testable. The
write-only `visible` flag and obsolete `shortcutBounds` helper/test were removed.
Actual visibility remains controlled by native hide/show calls. The switcher
continues to render all profiles independently of the preload limit.

No session mapping, cookies, deletion ownership, service UI, preload limit,
focus policy, clipboard API or streaming transport was changed. No claim is
made that an initialization error occurred in the affected user's profile.

## Validation

- 93 Node tests, TypeScript and production Vite build passed locally.
- Three standalone Rust rollback tests passed locally. They exercise setup failure at tracking,
  permissions, ports, and hide/focus, successful setup, and cleanup failure.
  The failure stages are simulated; these tests do not invoke COM/WebView2.
- Full Windows compilation/packaging is checked on the PR commit. CI remains
  compilation/packaging only, with no test job added.
- Interactive Windows WebView2 is unavailable here. Real Copy buttons,
  renderer responsiveness, native teardown and ChatGPT streaming remain
  unverified. Do not interpret a successful build or policy test as recovery.
