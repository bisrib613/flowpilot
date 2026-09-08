const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
const { test } = require('node:test')
const exportsObject = {}
let saved = null
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/workspace-policy.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText, { exports: exportsObject, localStorage: { getItem: () => saved } })
const neighbors = (...args) => Array.from(exportsObject.neighborIndices(...args))
const bounds = (...args) => Array.from(exportsObject.shortcutBounds(...args))
test('boundaries do not transfer unused slots to the opposite side', () => {
  assert.deepEqual(neighbors(100, 0, 4), [1, 2, 3, 4])
  assert.deepEqual(neighbors(100, 2, 4).sort((a,b) => a-b), [0,1,3,4,5,6])
  assert.deepEqual(neighbors(100, 99, 4), [98,97,96,95])
  assert.deepEqual(neighbors(1, 0, 4), [])
  assert.deepEqual(neighbors(100, 6, 0), [])
})
test('next profile retains overlap and replaces only the farthest neighbor', () => {
  const before = new Set([6, ...neighbors(100, 6, 4)])
  const after = new Set([7, ...neighbors(100, 7, 4)])
  assert.deepEqual([...before].filter(i => !after.has(i)), [2])
  assert.deepEqual([...after].filter(i => !before.has(i)), [11])
})
test('100-profile traversal stays within bounds and the configured per-side limit', () => {
  for(let limit=0; limit<=5; limit++) for(let active=0; active<100; active++) {
    const list=neighbors(100, active, limit)
    assert.equal(new Set(list).size,list.length)
    assert.equal(list.filter(i=>i<active).length,Math.min(active,limit))
    assert.equal(list.filter(i=>i>active).length,Math.min(99-active,limit))
    assert.ok(list.every(i=>i>=0 && i<100 && i!==active))
  }
})
test('More expands shortcuts independently of live WebViews', () => {
  assert.deepEqual(bounds(100,6), [1,12])
  assert.deepEqual(bounds(100,6,5,5), [0,17])
  assert.deepEqual(bounds(3,0), [0,3])
  assert.deepEqual(neighbors(100,6,2), [7,5,8,4])
})
test('preload preference rejects invalid values and preserves Off', () => {
  for (const value of [null,'no','6','-1','2.5']) { saved=value; assert.equal(exportsObject.readPreloadSides(),2) }
  saved='0'; assert.equal(exportsObject.readPreloadSides(),0)
  saved='5'; assert.equal(exportsObject.readPreloadSides(),5)
})
