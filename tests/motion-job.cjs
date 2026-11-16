const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm'), ts=require('typescript')
test('navigation/remount keeps the running job and prevents a duplicate submission', async()=>{
  let finish; const calls=[], exports={}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/motion-job.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{
    exports, require: name=>name==='react'?{useSyncExternalStore:(_,get)=>get()}:{invoke: async(command)=>{
      calls.push(command); return new Promise(resolve=>finish=resolve)
    }}
  })
  const first=exports.generateMotion({})
  assert.equal(exports.useMotionJob().busy,true)
  await exports.generateMotion({}); assert.equal(calls.length,1)
  finish('output.mp4'); await first
  assert.equal(exports.useMotionJob().busy,false); assert.match(exports.useMotionJob().status,/output.mp4/)
})
