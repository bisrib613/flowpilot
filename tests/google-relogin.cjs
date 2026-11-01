const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const vm = require("node:vm")

const source = fs.readFileSync("src-tauri/src/google_relogin.js", "utf8")

// Deterministic DOM fixtures model the attributes and user events Google
// exposes. These are contract tests, NOT live Google authentication tests.
function environment({
  origin = "https://accounts.google.com",
  pathname = "/v3/signin/identifier",
  expected = "",
  choices = ["one@gmail.com"],
  stage = "chooser",
  captcha = false,
  inputCount = 1,
  buttonCount = 1,
  storage = new Map(),
  emailAttribute = "data-identifier",
  password = "test-secret"
} = {}) {
  const clicks = []
  const submitted = []
  const timers = []
  const observers = []
  let currentStage = stage
  let challenge = captcha
  let currentPath = pathname

  class Element {
    constructor() { this.isConnected = true }
    getClientRects() { return [1] }
    closest() { return null }
    querySelector() { return null }
    matches() { return false }
    getAttribute() { return null }
  }
  class Choice extends Element {
    constructor(value) { super(); this.email = value }
    getAttribute(key) { return key === emailAttribute ? this.email : null }
    click() { clicks.push(this.email) }
  }
  class Input extends Element {
    constructor() {
      super()
      this.type = "password"
      this.disabled = false
      this.events = []
      this._value = ""
    }
    get value() { return this._value }
    set value(value) { this._value = value }
    dispatchEvent(event) { this.events.push(event.type) }
  }
  class Button extends Element {
    matches(selector) { return selector === "button" }
    click() { submitted.push("clicked") }
  }
  const inputs = Array.from({ length: inputCount }, () => new Input())
  const buttons = Array.from({ length: buttonCount }, () => new Button())
  const choiceNodes = choices.map(value => new Choice(value))
  const window = { location: { origin, pathname: currentPath } }
  window.self = window
  window.top = window

  const document = {
    documentElement: {},
    querySelectorAll(selector) {
      if (selector.includes('iframe[src*="recaptcha"]')) {
        return challenge ? [new Element()] : []
      }
      if (selector.includes("data-identifier") && selector.includes("data-email")) {
        return currentStage === "chooser" ? choiceNodes : []
      }
      if (selector.includes('input[name="Passwd"]')) {
        return currentStage === "password" ? inputs : []
      }
      if (selector.includes("#passwordNext")) {
        return currentStage === "password" ? buttons : []
      }
      return []
    }
  }
  class Observer {
    constructor(callback) { this.callback = callback; this.connected = false; observers.push(this) }
    observe() { this.connected = true }
    disconnect() { this.connected = false }
  }
  const sandbox = {
    window, document, HTMLElement: Element, HTMLInputElement: Input,
    MutationObserver: Observer, sessionStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    Event: class { constructor(type) { this.type = type } },
    Date, JSON, setTimeout: callback => { timers.push(callback) }
  }
  const compiled = source
    .replace("__FLOWPILOT_EMAIL__", JSON.stringify(expected))
    .replace("__FLOWPILOT_PASSWORD__", JSON.stringify(password))
  vm.runInNewContext(compiled, sandbox, { timeout: 1000 })
  return {
    clicks, submitted, inputs, storage,
    transition(nextStage, nextPath = currentPath) {
      currentStage = nextStage
      currentPath = nextPath
      window.location.pathname = nextPath
      for (const observer of observers) if (observer.connected) observer.callback()
    },
    captcha(value) { challenge = value; for (const o of observers) if (o.connected) o.callback() },
    flush() { while (timers.length) timers.shift()() },
    connectedObservers() { return observers.filter(o => o.connected).length }
  }
}

test("chooser -> SPA password without reload fills password and clicks Next", () => {
  const app = environment({ expected: "one@gmail.com", choices: ["one@gmail.com", "two@gmail.com"] })
  assert.deepEqual(app.clicks, ["one@gmail.com"])
  assert.equal(app.connectedObservers(), 1, "observer must survive chooser click")
  app.transition("password", "/v3/signin/challenge/pwd")
  assert.equal(app.inputs[0].value, "test-secret")
  assert.deepEqual(app.inputs[0].events, ["input", "change"])
  app.flush()
  assert.equal(app.submitted.length, 1)
  assert.equal(app.storage.size, 0)
})

test("chooser -> full document navigation also fills recognized password", () => {
  const storage = new Map()
  environment({ expected: "one@gmail.com", storage })
  const nextPage = environment({
    expected: "one@gmail.com", stage: "password",
    pathname: "/v3/signin/challenge/pwd", storage
  })
  nextPage.flush()
  assert.equal(nextPage.inputs[0].value, "test-secret")
  assert.equal(nextPage.submitted.length, 1)
})

test("data-email chooser attribute is supported", () => {
  const app = environment({ emailAttribute: "data-email" })
  assert.deepEqual(app.clicks, ["one@gmail.com"])
})

test("fresh login password-only form is NEVER filled", () => {
  const app = environment({ expected: "one@gmail.com", stage: "password" })
  app.flush()
  assert.equal(app.inputs[0].value, "")
  assert.equal(app.submitted.length, 0)
})

test("incorrect configured email does not select the wrong identity", () => {
  const app = environment({ expected: "two@gmail.com", choices: ["one@gmail.com"] })
  assert.deepEqual(app.clicks, [])
})

test("ambiguous chooser with no profile email does not guess", () => {
  const app = environment({ choices: ["one@gmail.com", "two@gmail.com"] })
  assert.deepEqual(app.clicks, [])
})

test("missing password selector fails closed", () => {
  const app = environment({ inputCount: 0 })
  app.transition("password", "/v3/signin/challenge/pwd")
  app.flush()
  assert.equal(app.submitted.length, 0)
})

test("missing Next button fails closed", () => {
  const app = environment({ buttonCount: 0 })
  app.transition("password", "/v3/signin/challenge/pwd")
  app.flush()
  assert.equal(app.inputs[0].value, "")
  assert.equal(app.submitted.length, 0)
})

test("ambiguous duplicate password fields fail closed", () => {
  const app = environment({ inputCount: 2 })
  app.transition("password", "/v3/signin/challenge/pwd")
  app.flush()
  assert.equal(app.inputs[0].value, "")
  assert.equal(app.inputs[1].value, "")
  assert.equal(app.submitted.length, 0)
})

test("CAPTCHA on chooser skips without clicking", () => {
  const app = environment({ captcha: true })
  assert.deepEqual(app.clicks, [])
  assert.equal(app.storage.size, 0)
})

test("CAPTCHA between chooser and password skips the profile", () => {
  const app = environment()
  app.captcha(true)
  app.transition("password", "/v3/signin/challenge/pwd")
  app.flush()
  assert.equal(app.inputs[0].value, "")
  assert.equal(app.submitted.length, 0)
  assert.equal(app.storage.size, 0)
})

test("CAPTCHA appearing after fill but before Next clears the field and skips", () => {
  const app = environment()
  app.transition("password", "/v3/signin/challenge/pwd")
  assert.equal(app.inputs[0].value, "test-secret")
  app.captcha(true)
  app.flush()
  assert.equal(app.inputs[0].value, "")
  assert.equal(app.submitted.length, 0)
})

test("non-password verification route is skipped", () => {
  const app = environment({ pathname: "/v3/signin/challenge/totp" })
  assert.deepEqual(app.clicks, [])
})

test("normal password challenge route remains allowed", () => {
  const app = environment()
  app.transition("password", "/v3/signin/challenge/pwd")
  app.flush()
  assert.equal(app.submitted.length, 1)
})

test("other origins and stale selected identities cannot receive password", () => {
  const other = environment({ origin: "https://example.com" })
  assert.deepEqual(other.clicks, [])
  const storage = new Map([["flowpilot-recognized-reauth", JSON.stringify({
    email: "one@gmail.com", timestamp: Date.now() - 100000
  })]])
  const stale = environment({ stage: "password", storage })
  stale.flush()
  assert.equal(stale.inputs[0].value, "")
  assert.equal(stale.submitted.length, 0)
})
