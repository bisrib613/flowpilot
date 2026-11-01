const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const vm = require("node:vm")

const source = fs.readFileSync("src-tauri/src/google_relogin.js", "utf8")

function environment({ origin = "https://accounts.google.com", expected = "", choices = [], passwordPage = false, storage = new Map() } = {}) {
  let chooserClicks = []
  let passwordSubmissions = 0
  class Element {
    getClientRects() { return [1] }
    querySelector() { return null }
  }
  class Choice extends Element {
    constructor(value) { super(); this.value = value }
    getAttribute(name) { return name === "data-identifier" ? this.value : null }
    closest() { return this }
    click() { chooserClicks.push(this.value) }
  }
  class Input extends Element {
    constructor() { super(); this._value = ""; this.events = [] }
    get value() { return this._value }
    set value(value) { this._value = value }
    dispatchEvent(event) { this.events.push(event.type) }
  }
  const input = new Input()
  class Next extends Element {
    click() { passwordSubmissions++ }
    querySelector() { return null }
  }
  const next = new Next()
  const win = { location: { origin } }
  win.top = win.self = win
  const context = {
    window: win, HTMLElement: Element, HTMLInputElement: Input,
    document: {
      documentElement: {},
      querySelectorAll: () => passwordPage ? [] : choices.map(x => new Choice(x)),
      querySelector: (selector) => !passwordPage ? null :
        selector === 'input[type="password"]' ? input :
        selector === '#passwordNext' ? next : null
    },
    MutationObserver: class { observe() {} disconnect() {} },
    sessionStorage: {
      getItem: (k) => storage.get(k) || null,
      setItem: (k, v) => storage.set(k, v),
      removeItem: (k) => storage.delete(k)
    },
    Event: class { constructor(type) { this.type = type } },
    Date, JSON
  }
  const compiled = source
    .replace("__FLOWPILOT_EMAIL__", JSON.stringify(expected))
    .replace("__FLOWPILOT_PASSWORD__", JSON.stringify("test-secret"))
  vm.runInNewContext(compiled, context, { timeout: 1000 })
  return { chooserClicks, passwordSubmissions, passwordInput: input, storage }
}

test("recognized account chooser arms, then password page can be submitted", () => {
  const storage = new Map()
  const chooser = environment({ expected: "one@gmail.com", choices: ["one@gmail.com", "two@gmail.com"], storage })
  assert.deepEqual(chooser.chooserClicks, ["one@gmail.com"])
  assert.equal(chooser.passwordSubmissions, 0)
  const passwordPage = environment({ expected: "one@gmail.com", passwordPage: true, storage })
  assert.equal(passwordPage.passwordInput.value, "test-secret")
  assert.equal(passwordPage.passwordSubmissions, 1)
  assert.equal(storage.size, 0)
})

test("fresh password-only page does not receive password", () => {
  const result = environment({ expected: "one@gmail.com", passwordPage: true })
  assert.equal(result.passwordInput.value, "")
  assert.equal(result.passwordSubmissions, 0)
})

test("no configured email never guesses among multiple accounts", () => {
  const result = environment({ choices: ["one@gmail.com", "two@gmail.com"] })
  assert.deepEqual(result.chooserClicks, [])
  assert.equal(result.storage.size, 0)
})

test("no recognized identity matching the configured email means no action", () => {
  const result = environment({ expected: "one@gmail.com", choices: ["two@gmail.com"] })
  assert.deepEqual(result.chooserClicks, [])
})

test("script does not run on other origins", () => {
  const result = environment({ origin: "https://claude.ai", choices: ["one@gmail.com"] })
  assert.deepEqual(result.chooserClicks, [])
})
