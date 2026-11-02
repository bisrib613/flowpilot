const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const ts = require("typescript")
const vm = require("node:vm")

const exportsObject = {}
let saved = null
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/services/profile-features.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText, {
  exports: exportsObject,
  localStorage: { getItem: () => saved }
})
const sort = (items, key, direction = "asc") =>
  Array.from(exportsObject.sortProfileCards(items, { key, direction }), item => item.id)
const read = () => {
  const { key, direction } = exportsObject.readProfileSort("flow")
  return { key, direction }
}
const old = [
  { id: "a", name: "Alpha", order: 0 },
  { id: "b", name: "zeta", order: 1 },
  { id: "c", name: "beta 2", order: 2 },
]

test("default preserves first-added/manual order without mutating account data", () => {
  saved = null
  assert.deepEqual(read(), { key: "manual", direction: "asc" })
  assert.deepEqual(sort(old, "manual"), ["a", "b", "c"])
  assert.deepEqual(old.map(a => a.order), [0, 1, 2])
  const dragged = [{ ...old[0], order: 2 }, { ...old[1], order: 0 }, { ...old[2], order: 1 }]
  assert.deepEqual(sort(dragged, "manual"), ["b", "c", "a"])
})

test("one Added sort option handles ascending (first) and descending (recent)", () => {
  const accounts = [...old, { id: "d", name: "New", order: 3, addedAt: 12345678 }]
  assert.deepEqual(sort(accounts, "added", "asc"), ["a", "b", "c", "d"])
  assert.deepEqual(sort(accounts, "added", "desc"), ["d", "c", "b", "a"])
  assert.deepEqual(sort(accounts, "manual"), ["a", "b", "c", "d"])
})

test("one Opened option supports oldest and most recently opened, keeping never opened distinct", () => {
  const accounts = [...old, { id: "d", name: "Newly opened", order: 3, lastOpenedAt: 300 },
    { id: "e", name: "Previously opened", order: 4, lastOpenedAt: 100 }]
  assert.deepEqual(sort(accounts, "opened", "desc"), ["d", "e", "a", "b", "c"])
  assert.deepEqual(sort(accounts, "opened", "asc"), ["a", "b", "c", "e", "d"])
})

test("one Name option supports both alphabetical directions without altering manual order", () => {
  assert.deepEqual(sort(old, "name", "asc"), ["a", "c", "b"])
  assert.deepEqual(sort(old, "name", "desc"), ["b", "c", "a"])
  assert.deepEqual(sort(old, "manual"), ["a", "b", "c"])
})

test("bulk sharing excludes sessions already linked in this service", () => {
  const sources = [{ id: "flow-1", name: "One" }, { id: "flow-2", name: "Two" }, { id: "flow-3", name: "Three" }]
  const linked = [{ service: "claude", flowSessionId: "flow-2", order: 0 }]
  assert.deepEqual(Array.from(exportsObject.availableSharedSources(sources, linked), a => a.id), ["flow-1", "flow-3"])
  assert.deepEqual(Array.from(exportsObject.availableSharedSources(sources, []), a => a.id),
    ["flow-1", "flow-2", "flow-3"])
})

test("preference persists compact key:direction and migrates previous sort values", () => {
  const samples = {
    "manual:asc": { key: "manual", direction: "asc" },
    "added:desc": { key: "added", direction: "desc" },
    "opened:asc": { key: "opened", direction: "asc" },
    "name:desc": { key: "name", direction: "desc" },
    manual: { key: "manual", direction: "asc" },
    newest: { key: "added", direction: "desc" },
    oldest: { key: "added", direction: "asc" },
    recent: { key: "opened", direction: "desc" },
    name_asc: { key: "name", direction: "asc" },
    name_desc: { key: "name", direction: "desc" },
  }
  for (const [value, expected] of Object.entries(samples)) {
    saved = value
    assert.deepEqual(read(), expected)
  }
  for (const invalid of [null, "", "unknown", "added:invalid", "name", "manual:up"]) {
    saved = invalid
    assert.deepEqual(read(), { key: "manual", direction: "asc" })
  }
})

test("direction defaults to newest-first for Added/Opened, A–Z for Name", () => {
  assert.equal(exportsObject.defaultSortDirection("added"), "desc")
  assert.equal(exportsObject.defaultSortDirection("opened"), "desc")
  assert.equal(exportsObject.defaultSortDirection("name"), "asc")
})
