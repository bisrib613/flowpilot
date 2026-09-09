const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const read = (path) => fs.readFileSync(path, 'utf8')
const manifest = new Set([...read('src-tauri/build.rs').matchAll(/"([a-z_]+)"/g)].map(match => match[1]))
const handler = read('src-tauri/src/lib.rs').replace(/#\[cfg[^\n]+\]\s*[^\n]+,/g, '').match(/generate_handler!\[([\s\S]*?)\]/)[1]
const registered = new Set(handler.split(',').map(name => name.trim().split('::').pop()).filter(Boolean))
const capability = JSON.parse(read('src-tauri/capabilities/default.json'))
const invoked = new Set(['src/App.tsx', 'src/services/account-store.ts'].flatMap(path =>
  [...read(path).matchAll(/invoke(?:<[^>]+>)?\(\s*"([a-z_]+)"/g)].map(match => match[1])))
test('registered application commands are declared in the build manifest', () => {
  assert.deepEqual([...registered].filter(name => !manifest.has(name)), [])
})
test('local UI commands are registered and granted by the main capability', () => {
  assert.ok(invoked.has('prepare_workspace'))
  assert.ok(invoked.has('preload_workspace'))
  assert.ok(invoked.has('close_workspaces'))
  assert.deepEqual([...invoked].filter(name => !registered.has(name)), [])
  assert.deepEqual([...invoked].filter(name => !capability.permissions.includes(`allow-${name.replaceAll('_', '-')}`)), [])
})
test('workspace management grants stay local', () => {
  assert.deepEqual(capability.windows, ['main'])
  assert.equal(capability.remote, undefined)
  for (const file of fs.readdirSync('src-tauri/capabilities').filter(name => name.endsWith('.json'))) {
    const entry = JSON.parse(read(`src-tauri/capabilities/${file}`))
    if (entry.remote) assert.ok(!entry.permissions.some(name => ['allow-prepare-workspace', 'allow-preload-workspace', 'allow-close-workspaces'].includes(name)))
  }
})
