const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const vm = require("node:vm")
const serviceSource = fs.readFileSync("src-tauri/src/bulk_shared_service_login.js", "utf8")
const chooserSource = fs.readFileSync("src-tauri/src/bulk_shared_google_chooser.js", "utf8")

function fixture({ host = "claude.ai", path = "/", buttons = [],
  signals = [], identities = [], inputs = [], service = "claude",
  expected = "", click = true, heading = "", summary = "", extra = {}, fallbackName = "Linked profile", search = "" } = {}) {
  const clicked = []
  const window = {}
  window.self = window
  window.top = window
  const location = { hostname: host, pathname: path, origin: "https://" + host, protocol: "https:", search }
  class Element {
    constructor(opts = {}) { this.opts = opts; this.disabled = !!opts.disabled; this.textContent = opts.text || ""; this.innerText = this.textContent }
    getClientRects() { return this.opts.hidden ? [] : [1] }
    getAttribute(name) { return this.opts[name] || null }
    closest(selector) {
      if (selector.includes("form")) return this.opts.inForm ? this : null
      if (selector.includes("banner")) return this.opts.inBanner ? this : null
      return null
    }
    querySelectorAll() { return this.children || [] }
    click() { clicked.push(this.opts.text || this.opts["data-identifier"] || this.opts["data-email"]) }
  }
  class Input extends Element {
    constructor(opts) { super(opts); this.value = opts.value || ""; this.events = [] }
    get value() { return this._value }
    set value(value) { this._value = value }
    dispatchEvent(event) { this.events.push(event.type) }
    checkValidity() { return this.opts.invalid !== true && !!this.value }
  }
  const buttonNodes = buttons.map(opts => new Element(typeof opts === "string" ? { text: opts } : opts))
  const signalNodes = signals.map(() => new Element())
  const identityNodes = identities.map(email => new Element({ "data-identifier": email }))
  const inputNodes = inputs.map(opts => new Input(typeof opts === "string" ? { type: opts } : opts))
  const extraNodes = Object.fromEntries(Object.entries(extra).map(([selector, opts]) => [selector,
    opts.map(item => {
      const node = new Element(item)
      if (item.children) node.children = item.children.map(child => new Element(child))
      return node
    })]))
  const document = {
    body: { innerText: summary },
    getElementById: id => id === "headingText" ? { textContent: heading } : null,
    querySelectorAll(selector) {
      if (selector === 'button, [role="button"], input[type="submit"]') return buttonNodes
      if (selector === 'button, a, [role="button"]') return buttonNodes
      if (selector === '[data-identifier], [data-email]') return identityNodes
      if (extraNodes[selector]) return extraNodes[selector]
      if (selector === 'input[name="name"]') return inputNodes.filter(node => node.opts.name === "name")
      if (selector === 'input[name="age"]') return inputNodes.filter(node => node.opts.name === "age")
      if (selector.startsWith("input")) return inputNodes.filter(node =>
        selector.includes('type="password"') && node.opts.type === "password" ||
        selector.includes('type="email"') && node.opts.type === "email" ||
        selector.includes("input#identifierId") && node.opts.id === "identifierId" ||
        selector.includes('input[name="identifier"]') && node.opts.name === "identifier")
      if (signals.includes(selector)) return signalNodes
      return []
    }
  }
  const sandbox = { window, location, HTMLElement: Element, HTMLInputElement: Input, Event: class { constructor(type) { this.type = type } }, URLSearchParams, document,
    getComputedStyle: () => ({ visibility: "visible" }) }
  const execute = (which, canClick = click) => {
    const source = which === "service" ? serviceSource
      .replace("__FLOWPILOT_SERVICE__", JSON.stringify(service))
      .replace("__FLOWPILOT_PROFILE_NAME__", JSON.stringify(fallbackName))
      .replace("__FLOWPILOT_CAN_CLICK__", JSON.stringify(canClick))
      : chooserSource
      .replace("__FLOWPILOT_EXPECTED_EMAIL__", JSON.stringify(expected))
      .replace("__FLOWPILOT_CAN_CLICK__", JSON.stringify(canClick))
    return vm.runInNewContext(source, sandbox, { timeout: 1000 })
  }
  return { execute, clicked, buttonNodes, document, signalNodes, inputNodes, extraNodes, window }
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

test("Google OAuth consent screen is recognized and no Continue button is auto-clicked", () => {
  const f = fixture({
    host: "accounts.google.com",
    path: "/signin/oauth/consent",
    buttons: ["Batal", "Lanjutkan"],
    expected: "one@gmail.com",
  })
  assert.equal(f.execute("google"), "consent_required")
  assert.deepEqual(f.clicked, [])
})

test("English Google consent also requires manual approval", () => {
  const f = fixture({
    host: "accounts.google.com",
    path: "/o/oauth2/consent",
    buttons: ["Cancel", "Continue"],
  })
  assert.equal(f.execute("google"), "consent_required")
  assert.deepEqual(f.clicked, [])
})

test("untrusted consent lookalike is never acted on", () => {
  const f = fixture({
    host: "evil.invalid",
    path: "/signin/oauth/consent",
    buttons: ["Batal", "Lanjutkan"],
  })
  assert.equal(f.execute("google"), "waiting")
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

test("observed ChatGPT account shell is recognized without chat history", () => {
  const f = fixture({ service: "chatgpt", host: "chatgpt.com", signals: ['button[aria-label="Open profile menu"]'] })
  assert.equal(f.execute("service"), "signed_in")
  assert.deepEqual(f.clicked, [])
})
test("guest ChatGPT banner login is unambiguous despite sidebar duplicate", () => {
  const f = fixture({ service: "chatgpt", host: "chatgpt.com", buttons: [
    { text: "Log in", inBanner: true }, { text: "Log in" },
  ] })
  assert.equal(f.execute("service"), "entry_clicked")
  assert.deepEqual(f.clicked, ["Log in"])
})
test("busy Google CTA is never clicked while OAuth is pending", () => {
  const f = fixture({ buttons: [{ text: "Continue with Google", "aria-busy": "true" }] })
  assert.equal(f.execute("service"), "waiting")
  assert.deepEqual(f.clicked, [])
})
test("observed Google identifier is text, not email, and means session is invalid", () => {
  const f = fixture({ host: "accounts.google.com", inputs: [{ type: "text", id: "identifierId", name: "identifier" }] })
  assert.equal(f.execute("google"), "invalid_session")
  assert.deepEqual(f.clicked, [])
})
for (const heading of ["Anda login kembali ke Claude", "You're signing back in to OpenAI", "You’re signing back in to Claude"]) {
  test(`returning Google confirmation advances once: ${heading}`, () => {
    const f = fixture({ host: "accounts.google.com", path: "/signin/oauth/id", heading, buttons: ["Batal", "Lanjutkan"] })
    assert.equal(f.execute("google"), "consent_clicked")
    assert.deepEqual(f.clicked, ["Lanjutkan"])
    assert.equal(f.execute("google"), "waiting")
    assert.equal(f.clicked.length, 1)
  })
}
test("first consent on the observed /signin/oauth/id route is not a returning grant", () => {
  const f = fixture({ host: "accounts.google.com", path: "/signin/oauth/id", heading: "Login ke Claude", buttons: ["Batal", "Lanjutkan"] })
  assert.equal(f.execute("google"), "consent_required")
  assert.deepEqual(f.clicked, [])
})
const captchaSelector = 'iframe[title="hCaptcha challenge"], iframe[title="recaptcha challenge expires in two minutes"]'
test("service CAPTCHA overrides app navigation and causes no clicks", () => {
  const f = fixture({ signals: ['a[href^="/new"]'], extra: { [captchaSelector]: [{}] } })
  assert.equal(f.execute("service"), "verification_required")
  assert.deepEqual(f.clicked, [])
})
test("hidden CAPTCHA frame does not block an authenticated account", () => {
  const f = fixture({ signals: ['a[href^="/new"]'], extra: { [captchaSelector]: [{ hidden: true }] } })
  assert.equal(f.execute("service"), "signed_in")
})
test("initial reauth login remains clickable, but a new rejected document is reported", () => {
  const f = fixture({ path: "/login", search: "?reauth=1", buttons: ["Continue with Google"] })
  assert.equal(f.execute("service"), "google_clicked")
  // Same opener waiting for OAuth must not be mistaken for a rejected callback.
  assert.equal(f.execute("service", false), "waiting")
  delete f.window.__flowpilotGoogleClicked // full-document reauth after callback
  assert.equal(f.execute("service", false), "reauth_required")
})
test("signup preserves Google name, prepares age 27, then submits on a later poll", () => {
  const f = fixture({ service: "chatgpt", host: "auth.openai.com", path: "/about-you",
    inputs: [{ name: "name", type: "text", value: "Kuki Mana" }, { name: "age", type: "number" }],
    buttons: [{ text: "Continue", type: "submit" }],
  })
  assert.equal(f.execute("service", false), "signup_filled")
  assert.equal(f.inputNodes[0].value, "Kuki Mana")
  assert.equal(f.inputNodes[1].value, "27")
  assert.deepEqual(f.inputNodes[1].events, ["input", "change"])
  assert.deepEqual(f.clicked, [])
  assert.equal(f.execute("service", false), "signup_clicked")
  assert.deepEqual(f.clicked, ["Continue"])
  assert.equal(f.execute("service", false), "waiting")
  assert.equal(f.clicked.length, 1)
})
test("signup uses linked profile as fallback and preserves an already supplied age", () => {
  const f = fixture({ service: "chatgpt", host: "auth.openai.com", path: "/about-you", fallbackName: "Budi Santoso",
    inputs: [{ name: "name", type: "text" }, { name: "age", type: "number", value: "31" }],
    buttons: [{ text: "Continue", type: "submit" }],
  })
  assert.equal(f.execute("service"), "signup_filled")
  assert.equal(f.inputNodes[0].value, "Budi Santoso")
  assert.equal(f.inputNodes[1].value, "31")
})
test("unexpected or invalid signup fields are preserved for manual attention", () => {
  for (const inputs of [[], [{ name: "name", type: "text", value: "Name" }, { name: "age", type: "number", invalid: true }]]) {
    const f = fixture({ service: "chatgpt", host: "auth.openai.com", path: "/about-you", inputs,
      buttons: [{ text: "Continue", type: "submit" }],
    })
    assert.equal(f.execute("service"), "signup_required")
    assert.deepEqual(f.clicked, [])
  }
})
test("signup automation never runs on a lookalike host or another service", () => {
  for (const config of [{ host: "auth.openai.com.evil.invalid", service: "chatgpt" }, { host: "auth.openai.com", service: "claude" }]) {
    const f = fixture({ ...config, path: "/about-you", inputs: [{ name: "age", type: "number" }], buttons: ["Continue"] })
    assert.equal(f.execute("service"), "waiting")
    assert.equal(f.inputNodes[0].value, "")
    assert.deepEqual(f.clicked, [])
  }
})
test("welcome dialog is completed before reporting authenticated shell success", () => {
  const f = fixture({ service: "chatgpt", host: "chatgpt.com", signals: ['button[aria-label="Open profile menu"]'],
    extra: { 'dialog, [role="dialog"]': [{ text: "You're all set\nChatGPT can make mistakes.", children: [{ text: "Continue", type: "submit" }] }] },
  })
  assert.equal(f.execute("service", false), "onboarding_clicked")
  assert.deepEqual(f.clicked, ["Continue"])
  assert.equal(f.execute("service", false), "waiting")
  f.extraNodes['dialog, [role="dialog"]'].length = 0
  assert.equal(f.execute("service", false), "signed_in")
})
test("unknown onboarding dialog prevents false success and arbitrary Continue clicks", () => {
  const f = fixture({ service: "chatgpt", host: "chatgpt.com", signals: ['button[aria-label="Open profile menu"]'],
    extra: { 'dialog, [role="dialog"]': [{ text: "Choose a plan", children: [{ text: "Continue" }] }] },
  })
  assert.equal(f.execute("service"), "onboarding_required")
  assert.deepEqual(f.clicked, [])
})
test("auth route cannot pass as signed in from a stale navigation element", () => {
  const f = fixture({ service: "chatgpt", host: "auth.openai.com", path: "/log-in", signals: ['button[aria-label="Open profile menu"]'] })
  assert.equal(f.execute("service"), "waiting")
})

test("ChatGPT login dialog is not mistaken for onboarding", () => {
  const f = fixture({ service: "chatgpt", host: "chatgpt.com", buttons: ["Continue with Google"],
    extra: { 'dialog, [role="dialog"]': [{ text: "Log in or sign up" }] },
  })
  assert.equal(f.execute("service"), "google_clicked")
  assert.deepEqual(f.clicked, ["Continue with Google"])
})
test("a guest New chat button alone does not prove ChatGPT authentication", () => {
  const f = fixture({ service: "chatgpt", host: "chatgpt.com", signals: ['[data-testid="new-chat-button"]'] })
  assert.equal(f.execute("service"), "waiting")
})
test("Claude stable Google test ID remains usable if button copy changes", () => {
  const f = fixture({ buttons: [{ text: "Google sign-in", "data-testid": "login-with-google" }] })
  assert.equal(f.execute("service"), "google_clicked")
})

test("returning consent enforces the configured profile email", () => {
  for (const [summary, outcome] of [
    ["Anda login kembali ke Claude\none@gmail.com", "consent_clicked"],
    ["Anda login kembali ke Claude\nother@gmail.com", "needs_attention"],
    ["Anda login kembali ke Claude", "needs_attention"],
    ["one@gmail.com\nother@gmail.com", "needs_attention"],
  ]) {
    const f = fixture({ host: "accounts.google.com", path: "/signin/oauth/id", heading: "Anda login kembali ke Claude",
      expected: "one@gmail.com", summary, buttons: ["Batal", "Lanjutkan"],
    })
    assert.equal(f.execute("google"), outcome)
    assert.equal(f.clicked.length, outcome === "consent_clicked" ? 1 : 0)
  }
})
