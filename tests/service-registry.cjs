const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const ts = require("typescript")

const root = path.resolve(__dirname, "..")
const source = fs.readFileSync(path.join(root, "src/services/service-registry.ts"), "utf8")
const transpiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2020,
}}).outputText
const moduleObject = { exports: {} }
new Function("module", "exports", transpiled)(moduleObject, moduleObject.exports)
const { SERVICES, SERVICE_IDS, isServiceId, requiresManualSharedSignIn } = moduleObject.exports

test("all catalog entries have stable IDs, start URLs, and bundled icons", () => {
  assert.equal(SERVICE_IDS.length, 10)
  assert.equal(new Set(SERVICE_IDS).size, SERVICE_IDS.length)
  for (const id of SERVICE_IDS) {
    const item = SERVICES[id]
    assert.equal(isServiceId(id), true)
    assert.match(item.name, /\S/)
    assert.ok(item.logo.startsWith("/"))
    assert.ok(fs.existsSync(path.join(root, "public", item.logo.slice(1))), "missing " + item.logo)
    assert.equal(new URL(item.url).protocol, "https:")
  }
  assert.equal(isServiceId("unknown"), false)
  assert.equal(isServiceId("__proto__"), false)
})

test("Pinterest and Threads are social services with manual bulk login", () => {
  assert.equal(SERVICES.pinterest.url, "https://www.pinterest.com/")
  assert.equal(SERVICES.threads.url, "https://www.threads.com/")
  for (const id of ["pinterest", "threads"]) {
    assert.equal(SERVICES[id].category, "social")
    assert.equal(requiresManualSharedSignIn(id), true)
  }
  assert.equal(requiresManualSharedSignIn("claude"), false)
  assert.equal(requiresManualSharedSignIn("gemini"), true)
  assert.equal(requiresManualSharedSignIn("suno"), true)
})

test("account storage and native WebView accept both social service IDs", () => {
  const rust = fs.readFileSync(path.join(root, "src-tauri/src/webview_manager.rs"), "utf8")
  const accounts = fs.readFileSync(path.join(root, "src/services/account-store.ts"), "utf8")
  const app = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8")
  assert.match(accounts, /isServiceId\(account\.service\)/)
  assert.match(app, /SERVICE_IDS\.map\(/)
  for (const id of ["pinterest", "threads"]) {
    assert.ok(rust.includes('"' + id + '" => Ok("' + SERVICES[id].url + '")'))
    assert.ok(rust.includes('"' + id + '.com"'))
    assert.ok(rust.includes('"www.' + id + '.com"'))
  }
})