const {test} = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
function fixture(writeText, host = 'claude.ai') {
  const events = {}, timers = new Map(), messages = []
  let sequence = 0, receive
  const clipboard = {writeText}
  const bridge = {addEventListener: (_, fn) => {receive = fn}, postMessage: m => messages.push(m)}
  const context = {location: {protocol: 'https:', hostname: host}, navigator: {clipboard}, document: {
    visibilityState: 'visible', addEventListener: (name, fn) => events[name] = fn
  }, performance: {now: () => 100}, crypto: {randomUUID: () => `id-${++sequence}`},
  chrome: {webview: bridge}, DOMException, Promise,
  setTimeout: (fn, ms) => {const id=++sequence; timers.set(id, {fn,ms}); return id}, clearTimeout: id=>timers.delete(id)}
  context.window = context; context.top = context; context.self = context
  vm.runInNewContext(fs.readFileSync('src-tauri/src/clipboard_recovery.js','utf8'), context)
  return {clipboard, messages, events, timers, receive: m => receive({data:m}), arm: (isTrusted=true) => events.click({isTrusted})}
}
test('healthy clipboard preserves its receiver and writes once without native fallback', async () => {
  let calls = 0, receiver
  const f=fixture(function(text) {calls++; receiver=this; assert.equal(text,'hello'); return Promise.resolve()})
  f.arm(); await f.clipboard.writeText('hello')
  assert.equal(calls,1); assert.equal(receiver,f.clipboard); assert.equal(f.messages.length,0); assert.equal(f.timers.size,0)
})
test('failed user Copy resolves only after native write acknowledges success', async () => {
  const f=fixture(()=>Promise.reject(new DOMException('blocked','NotAllowedError')))
  f.arm(); const result=f.clipboard.writeText('hello'); await Promise.resolve()
  assert.equal(f.messages.length,1); assert.equal(f.messages[0].text,'hello')
  f.receive({kind:'flowpilot-copy-result',id:f.messages[0].id,ok:true}); await result
  assert.equal(f.timers.size,0)
})
test('pending browser Copy has a bounded native fallback and propagates native failure', async () => {
  const f=fixture(()=>new Promise(()=>{})); f.arm(); const result=f.clipboard.writeText('text')
  const rejected=assert.rejects(result,{name:'NotAllowedError'})
  ;[...f.timers.values()].find(t=>t.ms===1800).fn()
  f.receive({kind:'flowpilot-copy-result',id:f.messages[0].id,ok:false}); await rejected
})
test('synthetic clicks, oversized writes and unrelated origins never gain recovery', async () => {
  const fail=()=>Promise.reject(new DOMException('blocked','NotAllowedError'))
  const f=fixture(fail); f.arm(false); await assert.rejects(f.clipboard.writeText('text')); assert.equal(f.messages.length,0)
  f.arm(); await assert.rejects(f.clipboard.writeText('x'.repeat(1000001))); assert.equal(f.messages.length,0)
  const other=fixture(fail,'example.com'); assert.equal(other.clipboard.writeText,fail)
})
test('non-clipboard errors retain their original error object', async () => {
  const error=new TypeError('wrong input'), f=fixture(()=>Promise.reject(error)); f.arm()
  await assert.rejects(f.clipboard.writeText('text'), e=>e===error); assert.equal(f.messages.length,0)
})
test('Auto Post actions accept null payload without crashing before dispatch', () => {
  const run=vm.runInNewContext('('+fs.readFileSync('src-tauri/src/automation/publishing/social.js','utf8')+')', {
    document: {querySelectorAll:()=>[],querySelector:()=>null}, URL, location:{origin:'https://www.threads.com',pathname:'/'}
  })
  for (const action of ['pinBoard','threadOpen','threadReady','threadAdd','threadAttach','threadPreview']) assert.doesNotThrow(()=>run(action,null))
})
