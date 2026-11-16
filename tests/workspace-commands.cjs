const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')

function fixture(invoke) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/workspace-commands.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText, { exports, require: () => ({ invoke }) })
  return exports
}

test('a slow old open finishes before its hide and the next profile opens', async () => {
  const events = []
  let release
  const api = fixture(async (command) => {
    events.push(command + ':start')
    if (command === 'open-old') await new Promise(resolve => { release = resolve })
    events.push(command + ':end')
    return command
  })
  const old = api.workspaceCommand('open-old', {})
  const hide = api.workspaceCommand('hide-old', {})
  const next = api.workspaceCommand('open-next', {})
  await Promise.resolve()
  assert.deepEqual(events, ['open-old:start'])
  release()
  await Promise.all([old, hide, next])
  assert.deepEqual(events, ['open-old:start', 'open-old:end', 'hide-old:start', 'hide-old:end', 'open-next:start', 'open-next:end'])
})

test('Back followed by resume of the same account ends visible, not hidden', async () => {
  let visible = false
  let release
  const api = fixture(async command => {
    if (command === 'prepare-old') await new Promise(resolve => { release = resolve })
    visible = command !== 'hide'
  })
  const first = api.workspaceCommand('prepare-old', {})
  const cleanup = api.workspaceCommand('hide', {})
  const resumed = api.workspaceCommand('prepare-resumed', {})
  await Promise.resolve()
  release()
  await Promise.all([first, cleanup, resumed])
  assert.equal(visible, true)
})

test('discarded preload never reaches native but cleanup and the new open still run', async () => {
  const calls = []
  let release
  let current = true
  const api = fixture(async command => {
    calls.push(command)
    if (command === 'prepare') await new Promise(resolve => { release = resolve })
  })
  const prepare = api.workspaceCommand('prepare', {})
  const preload = api.workspaceCommand('preload', {}, () => current)
  const skipped = assert.rejects(preload, api.WorkspaceCommandCancelled)
  const hide = api.workspaceCommand('hide', {})
  const next = api.workspaceCommand('prepare-next', {})
  await Promise.resolve()
  current = false
  release()
  await Promise.all([prepare, skipped, hide, next])
  assert.deepEqual(calls, ['prepare', 'hide', 'prepare-next'])
})

test('a native error propagates and does not poison later workspace operations', async () => {
  const failure = new Error('native failure')
  const api = fixture(async command => {
    if (command === 'broken') throw failure
    return 42
  })
  await assert.rejects(api.workspaceCommand('broken', {}), error => error === failure)
  assert.equal(await api.workspaceCommand('next', {}), 42)
})

test('bookmark hide, restore and navigation retain their order', async () => {
  const calls = []
  const api = fixture(async command => { calls.push(command) })
  await api.workspaceCommand('hide-for-bookmarks', {})
  await api.workspaceCommand('restore-same-profile', {})
  await api.workspaceCommand('navigate-bookmark', {})
  await api.workspaceCommand('cleanup-hide', {})
  await api.workspaceCommand('prepare-other-service', {})
  assert.deepEqual(calls, ['hide-for-bookmarks', 'restore-same-profile', 'navigate-bookmark', 'cleanup-hide', 'prepare-other-service'])
})
