// Manual local regression check; not part of CI or the packaged app.
// Requires a running production Vite preview and a separate Playwright install.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium: playwright } = require(process.env
  .FLOWPILOT_PLAYWRIGHT_MODULE || "playwright");
const browser = await playwright.launch({
  executablePath: process.env.FLOWPILOT_CHROMIUM_EXECUTABLE || undefined,
  args: JSON.parse(process.env.FLOWPILOT_CHROMIUM_ARGS || "[]"),
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await page.addInitScript(() => {
  const accounts = [
    ["f1", "flow", "Flow one"],
    ["f2", "flow", "Flow two"],
  ].map(([id, service, name], order) => ({
    id,
    service,
    name,
    order,
    favorite: false,
    email: null,
    avatarUrl: null,
    avatar: "A",
  }));
  let callback = 0,
    epoch = 0;
  window.events = [];
  window.nativeVisible = null;
  window.holdResize = false;
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => ++callback,
    unregisterCallback() {},
    invoke: async (cmd, args) => {
      if (cmd === "load_accounts") return accounts;
      if (cmd === "plugin:app|version") return "1.5.23";
      if (cmd === "plugin:event|listen") return ++callback;
      if (cmd === "get_download_folder") return "C:/Downloads";
      if (cmd === "google_relogin_status" || cmd === "name_generator_status")
        return true;
      if (
        [
          "prepare_workspace",
          "close_google_flow",
          "open_google_flow",
          "resize_google_flow",
          "navigate_service_bookmark",
          "close_workspaces",
          "preload_workspace",
        ].includes(cmd)
      ) {
        window.events.push({ cmd, phase: "start", id: args?.accountId, args });
        if (cmd === "resize_google_flow" && window.holdResize)
          await new Promise((resolve) => (window.releaseResize = resolve));
        if (cmd === "prepare_workspace") {
          window.nativeVisible = args.accountId;
          epoch++;
        }
        if (
          cmd === "close_google_flow" &&
          window.nativeVisible === args.accountId
        )
          window.nativeVisible = null;
        if (cmd === "open_google_flow") window.nativeVisible = args.accountId;
        if (cmd === "close_workspaces") window.nativeVisible = null;
        window.events.push({ cmd, phase: "end", id: args?.accountId });
        return epoch;
      }
      return null;
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
});

await page.goto(process.env.FLOWPILOT_PREVIEW_URL || "http://127.0.0.1:5173");
await page.locator(".card").first().waitFor();
await page.locator(".card .wide").first().click();
await page.locator(".flow-status.is-ready").waitFor();
await page.waitForTimeout(1000);
await page.evaluate(() => {
  window.events = [];
  window.holdResize = true;
  window.dispatchEvent(new Event("resize"));
});
await page.waitForFunction(() => !!window.releaseResize);
await page.evaluate(async () => {
  for (let i = 0; i < 45; i++) {
    document.querySelector(".workspace-sheet").style.marginRight =
      20 + i + "px";
    window.dispatchEvent(new Event("resize"));
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
});
await page.waitForTimeout(100);
await page.evaluate(() => {
  window.holdResize = false;
  window.releaseResize();
});
await page.waitForTimeout(400);
const result = await page.evaluate(() => ({
  resizeCalls: window.events.filter(
    (e) => e.cmd === "resize_google_flow" && e.phase === "start"
  ).length,
  lastBounds: window.events
    .filter((e) => e.cmd === "resize_google_flow" && e.phase === "start")
    .at(-1)?.args,
  actualWidth: document.querySelector(".webview-host").getBoundingClientRect()
    .width,
}));
assert.equal(result.resizeCalls, 2);
assert.equal(result.lastBounds.width, result.actualWidth);

// Resize is still blocked when the user leaves this workspace. Completion must
// not enqueue its dirty bounds after the hide or affect the next profile.
await page.evaluate(() => {
  window.events = [];
  window.holdResize = true;
  delete window.releaseResize;
  window.dispatchEvent(new Event("resize"));
});
await page.waitForFunction(() => !!window.releaseResize);
await page.evaluate(() => {
  document.querySelector(".workspace-sheet").style.marginRight = "90px";
  window.dispatchEvent(new Event("resize"));
});
await page.waitForTimeout(100);
await page.getByRole("button", { name: "‹ Accounts", exact: true }).click();
await page
  .locator(".card")
  .filter({ hasText: "Flow two" })
  .locator(".wide")
  .click();
await page.evaluate(() => {
  window.holdResize = false;
  window.releaseResize();
});
await page.locator(".flow-status.is-ready").waitFor();
await page.waitForTimeout(1000);
const calls = await page.evaluate(() =>
  window.events.filter((e) => e.phase === "start")
);
const hide = calls.findIndex((e) => e.cmd === "close_google_flow");
const next = calls.findIndex((e) => e.cmd === "prepare_workspace");
assert(hide >= 0 && next > hide);
assert.equal(
  calls.slice(1, hide).filter((e) => e.cmd === "resize_google_flow").length,
  0
);
assert.equal(await page.evaluate(() => window.nativeVisible), "f2");

// Close All also must drain the in-flight call without scheduling dirty work.
await page.evaluate(() => {
  window.events = [];
  window.holdResize = true;
  delete window.releaseResize;
  window.dispatchEvent(new Event("resize"));
});
await page.waitForFunction(() => !!window.releaseResize);
await page.evaluate(() => {
  document.querySelector(".workspace-sheet").style.marginRight = "95px";
  window.dispatchEvent(new Event("resize"));
});
await page.waitForTimeout(100);
await page
  .getByRole("combobox", { name: "Close workspaces", exact: true })
  .selectOption("all");
await page.evaluate(() => {
  window.holdResize = false;
  window.releaseResize();
});
await page.locator(".card").first().waitFor();
await page.waitForTimeout(100);
const closed = await page.evaluate(() =>
  window.events.filter((e) => e.phase === "start")
);
assert.deepEqual(
  closed.map((e) => e.cmd),
  ["resize_google_flow", "close_workspaces", "close_google_flow"]
);
assert.equal(await page.evaluate(() => window.nativeVisible), null);
console.log(
  JSON.stringify({
    backpressure: result,
    backAndSwitchProfile: "passed",
    closeAll: "passed",
    note: "Production React with mocked native IPC; not a Windows WebView2 Copy or renderer test.",
  })
);
await browser.close();
