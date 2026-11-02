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
const sort = (accounts, mode) => exportsObject.sortProfileCards(accounts, mode).map(account => account.id)

const old = [
  { id: "a", name: "Alpha", order: 0 },
  { id: "b", name: "zeta", order: 1 },
  { id: "c", name: "beta 2", order: 2 }
]
test("newest default reverses original order without changing existing records", () => {
  assert.equal(exportsObject.readProfileSort("flow"), "newest")
  assert.deepEqual(sort(old, "newest"), ["c", "b", "a"])
  assert.deepEqual(old.map(a => a.order), [0, 1, 2])
  assert.deepEqual(sort(old, "manual"), ["a", "b", "c"])
})
test("timestamps distinguish new profiles while legacy accounts stay intact", () => {
  const records = [...old, { id: "d", name: "New", order: 3, addedAt: 12345678 }]
  assert.deepEqual(sort(records, "newest"), ["d", "c", "b", "a"])
  assert.deepEqual(sort(records, "oldest"), ["a", "b", "c", "d"])
})
test("last opened puts only actually opened profiles first", () => {
  const records = [...old, { id: "d", name: "Recent", order: 3, lastOpenedAt: 300 },
    { id: "e", name: "Older", order: 4, lastOpenedAt: 100 }]
  assert.deepEqual(sort(records, "recent"), ["d", "e", "c", "b", "a"])
})
test("alphabetical sorts do not mutate manual order", () => {
  assert.deepEqual(sort(old, "name_asc"), ["a", "c", "b"])
  assert.deepEqual(sort(old, "name_desc"), ["b", "c", "a"])
  assert.deepEqual(sort(old, "manual"), ["a", "b", "c"])
})
test("bulk share excludes only Flow sessions already linked in current service", () => {
  const sources = [
    { id: "flow-1", name: "Original 1" },
    { id: "flow-2", name: "Original 2" },
    { id: "flow-3", name: "Original 3" },
  ]
  const target = [{ service: "claude", flowSessionId: "flow-2", order: 0 }]
  assert.deepEqual(exportsObject.availableSharedSources(sources, target).map(a => a.id),
    ["flow-1", "flow-3"])
  assert.equal(exportsObject.availableSharedSources(sources, []).length, 3)
  assert.deepEqual(sources.map(a => a.name), ["Original 1", "Original 2", "Original 3"])
})
test("sort preference validates values and defaults safely", () => {
  for (const bad of ["arbitrary", "last", "", null]) {
    saved = bad
    assert.equal(exportsObject.readProfileSort("claude"), "newest")
  }
  for (const valid of ["newest", "recent", "oldest", "name_asc", "name_desc", "manual"]) {
    saved = valid
    assert.equal(exportsObject.readProfileSort("claude"), valid)
  }
})
