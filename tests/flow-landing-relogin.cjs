const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const vm = require("node:vm")

const source = fs.readFileSync("src-tauri/src/flow_landing_relogin.js", "utf8")

function landing({
  origin = "https://flow.google.com", pathname = "/about",
  entries = [], loadedLater = false
} = {}) {
  let nodes = entries.map(x => ({ ...x }))
  const clicked = []
  const observers = []
  class Element {
    constructor(config) { Object.assign(this, config) }
    getClientRects() { return this.visible === false ? [] : [1] }
    getAttribute(key) { return key === "aria-label" ? this.ariaLabel || null : null }
    click() { clicked.push(this.textContent || this.ariaLabel) }
  }
  const wrapped = () => nodes.map(x => new Element(x))
  const window = { location: { origin, pathname } }
  const document = {
    documentElement: {},
    querySelectorAll: selector => selector === 'a, button, [role="button"]' ? wrapped() : []
  }
  class Observer {
    constructor(callback) { this.callback = callback; this.connected = false; observers.push(this) }
    observe() { this.connected = true }
    disconnect() { this.connected = false }
  }
  vm.runInNewContext(source, {
    window, document, HTMLElement: Element, MutationObserver: Observer, Date
  }, { timeout: 1000 })
  return {
    clicked,
    add(config) {
      nodes.push(config)
      for (const observer of observers) if (observer.connected) observer.callback()
    },
    notify() { for (const observer of observers) if (observer.connected) observer.callback() }
  }
}

test("Create with Google Flow is clicked exactly once", () => {
  const app = landing({ entries: [{ textContent: "Create with Google Flow" }] })
  assert.deepEqual(app.clicked, ["Create with Google Flow"])
  app.notify()
  assert.equal(app.clicked.length, 1)
})

test("trailing icon label still matches", () => {
  const app = landing({ entries: [{ textContent: "Create with Google Flow arrow_forward" }] })
  assert.equal(app.clicked.length, 1)
})

test("button added dynamically is detected", () => {
  const app = landing()
  assert.equal(app.clicked.length, 0)
  app.add({ textContent: "Try Flow" })
  assert.deepEqual(app.clicked, ["Try Flow"])
})

test("aria-label can identify the sign-in CTA", () => {
  const app = landing({ entries: [{ textContent: "Continue", ariaLabel: "Sign in with Google" }] })
  assert.deepEqual(app.clicked, ["Continue"])
})

test("other buttons and hidden or disabled CTA are never clicked", () => {
  const app = landing({ entries: [
    { textContent: "Learn more" },
    { textContent: "Create with Google Flow", visible: false },
    { textContent: "Create with Google Flow", disabled: true }
  ] })
  assert.equal(app.clicked.length, 0)
})

test("never interact away from flow.google.com/about", () => {
  for (const [origin, pathname] of [
    ["https://example.com", "/about"],
    ["https://flow.google.com", "/"],
    ["https://flow.google.com", "/project/123"]
  ]) {
    const app = landing({ origin, pathname, entries: [{ textContent: "Create with Google Flow" }] })
    assert.equal(app.clicked.length, 0)
  }
})
