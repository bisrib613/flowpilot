# Local workspace resize check

`workspace-resize.mjs` exercises the production React build with mocked Tauri
IPC. It holds a resize promise while the real resize effect receives events,
then checks bounded calls, final dimensions, Back/switch-profile and Close All ordering.
It does **not** test native WebView2, Copy, Windows maximize or chat streaming.

Run `npm run build`, then `npm run preview -- --host 127.0.0.1` in one terminal.
In another, run `node tests/manual/workspace-resize.mjs` with Playwright and its
Chromium browser installed separately. This script is deliberately absent from
CI and production entry points. No test code or browser dependency is added to
the EXE.

Optional environment variables:

- `FLOWPILOT_PLAYWRIGHT_MODULE`: absolute module directory if Playwright is
  installed outside the repository; otherwise resolves `playwright` normally.
- `FLOWPILOT_CHROMIUM_EXECUTABLE`: alternate Chromium binary.
- `FLOWPILOT_CHROMIUM_ARGS`: JSON array of launch arguments, default `[]`.
- `FLOWPILOT_PREVIEW_URL`: default `http://127.0.0.1:5173`.
