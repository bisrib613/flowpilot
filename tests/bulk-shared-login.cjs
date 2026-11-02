const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const vm = require("node:vm")
const serviceSource = fs.readFileSync("src-tauri/src/bulk_shared_service_login.js", "utf8")
const chooserSource = fs.readFileSync("src-tauri/src/bulk_shared_google_chooser.js", "utf8")

function fixture({ host = "claude.ai", path = "/", buttons = [],
  signals = [], identities = [], inputs = [], service = "claude",
  expected = "", click = true } = {}) {
  const clicked = []
  const window = {}
  window.self = window
  window.top = window
  const location = { hostname: host, pathname: path, origin: "https://" + host, protocol: "https:" }
  class Element {
    constructor(opts = {}) { this.opts = opts; this.disabled = false; this.textContent = opts.text || ""; this.innerText = this.textContent }
    getClientRects() { return [1] }
    getAttribute(name) { return this.opts[name] || null }
    closest(selector) { return selector.includes("form") ? (this.opts.inForm ? this : null) : null }
    click() { clicked.push(this.opts.text || this.opts["data-identifier"] || this.opts["data-email"]) }
  }
  const buttonNodes = buttons.map(text => new Element({ text }))
  const signalNodes = signals.map(() => new Element())
  const identityNodes = identities.map(email => new Element({ "data-identifier": email }))
  const inputNodes = inputs.map(type => new Element({ type }))
  const document = {
    querySelectorAll(selector) {
      if (selector === 'button, a, [role="button"]') return buttonNodes
      if (selector === '[data-identifier], [data-email]') return identityNodes
      if (selector.startsWith("input")) return inputNodes.filter(node =>
        selector.includes('type="password"') && node.opts.type === "password" ||
        selector.includes('type="email"') && node.opts.type === "email")
      if (signals.includes(selector)) return signalNodes
      return []
    }
  }
  const sandbox = { window, location, HTMLElement: Element, document,
    getComputedStyle: () => ({ visibility: "visible" }) }
  const execute = (which, canClick = click) => {
    const source = which === "service" ? serviceSource
      .replace("__FLOWPILOT_SERVICE__", JSON.stringify(service))
      .replace("__FLOWPILOT_CAN_CLICK__", JSON.stringify(canClick))
      : chooserSource
      .replace("__FLOWPILOT_EXPECTED_EMAIL__", JSON.stringify(expected))
      .replace("__FLOWPILOT_CAN_CLICK__", JSON.stringify(canClick))
    return vm.runInNewContext(source, sandbox, { timeout: 1000 })
  }
  return { execute, clicked, buttonNodes, document, signalNodes }
}

test("Claude Google login button is clicked once per page", () => {
  const f = fixture({ buttons: ["Continue with Google"] })
  assert.equal(f.execute("service"), "google_clicked")
  assert.deepEqual(f.clicked, ["Continue with Google"])
  assert.equal(f.execute("service"), "waiting")
  assert.equal(f.clicked.length, 1)
})
test("same-window login entry then Google CTA is supported", () => {
  const f = fixture({ buttons: ["Log in"] })
  assert.equal(f.execute("service"), "entry_clicked")
  f.buttonNodes[0].textContent = "Continue with Google"
  f.buttonNodes[0].innerText = "Continue with Google"
  assert.equal(f.execute("service"), "google_clicked")
})
test("logged-in in-app navigation is recognized without login clicks", () => {
  const f = fixture({ signals: ['a[href^="/new"]'] })
  assert.equal(f.execute("service"), "signed_in")
  assert.deepEqual(f.clicked, [])
})
test("unknown or mismatched origins never trigger a Google click", () => {
  const f = fixture({ host: "evil.invalid", buttons: ["Continue with Google"] })
  assert.equal(f.execute("service"), "waiting")
  assert.deepEqual(f.clicked, [])
})
test("ambiguous service login CTAs fail without clicking", () => {
  const f = fixture({ buttons: ["Continue with Google", "Continue with Google"] })
  assert.equal(f.execute("service"), "needs_attention")
  assert.deepEqual(f.clicked, [])
})
test("Google chooser selects known Flow identity without filling credentials", () => {
  const f = fixture({ host: "accounts.google.com", identities: ["one@gmail.com", "two@gmail.com"], expected: "two@gmail.com" })
  assert.equal(f.execute("google"), "chooser_clicked")
  assert.deepEqual(f.clicked, ["two@gmail.com"])
  assert.equal(f.execute("google"), "waiting")
})
test("Google chooser only selects sole account when Flow email is unspecified", () => {
  const only = fixture({ host: "accounts.google.com", identities: ["one@gmail.com"] })
  assert.equal(only.execute("google"), "chooser_clicked")
  const ambiguous = fixture({ host: "accounts.google.com", identities: ["one@gmail.com", "two@gmail.com"] })
  assert.equal(ambiguous.execute("google"), "needs_attention")
  assert.deepEqual(ambiguous.clicked, [])
})
test("unrecognized Google identity cannot be selected", () => {
  const f = fixture({ host: "accounts.google.com", expected: "other@gmail.com", identities: ["one@gmail.com"] })
  assert.equal(f.execute("google"), "needs_attention")
  assert.deepEqual(f.clicked, [])
})
test("password challenge is recognized as invalid shared session", () => {
  const f = fixture({ host: "accounts.google.com", path: "/v3/signin/challenge/pwd", inputs: ["password"] })
  assert.equal(f.execute("google"), "invalid_session")
  assert.deepEqual(f.clicked, [])
})
test("verification challenge is not clicked or bypassed", () => {
  const f = fixture({ host: "accounts.google.com", path: "/v3/signin/challenge/totp", identities: ["one@gmail.com"] })
  assert.equal(f.execute("google"), "needs_attention")
  assert.deepEqual(f.clicked, [])
})
