const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm')
function fixture({childName='motion.mp4',ready=false,covered=false,duplicate=false,consent=false}={}) {
 const child={getAttribute:key=>key==='title'?childName:null,innerText:''}
 const tile={getClientRects:()=>[1],getAttribute:()=>null,innerText:'',querySelectorAll:()=>[child],
  querySelector:s=>s==='video'?{readyState:ready?1:0,duration:ready?10:NaN}:null,
  setAttribute:()=>{},scrollIntoView:()=>{},getBoundingClientRect:()=>({left:0,top:0,right:800,bottom:1200}),contains:x=>x===tile}
 let absent=false
 const document={querySelector:s=>s==='flow-upload-consent-dialog'&&consent?{getClientRects:()=>[1]}:null,
  querySelectorAll:s=>s==='flow-grid-tile-container'?(absent?[]:duplicate?[tile,tile]:[tile]):[],elementFromPoint:()=>covered?null:tile}
 const run=vm.runInNewContext('('+fs.readFileSync('src-tauri/src/automation/flow.js','utf8')+')',{document,window:{},WeakSet,innerWidth:800,innerHeight:600})
 const invoke=action=>run(action,{names:['motion.mp4','motion'],kind:'video'})
 invoke.beforeAdd=()=>{absent=true;invoke('beforeUpload');absent=false}
 return invoke
}
test('asset identity matches child metadata while host has no filename',()=>assert.equal(fixture({ready:true})('asset'),'motion.mp4'))
test('ready video does not depend on hover hit testing',()=>assert.equal(fixture({ready:true,covered:true})('assetHover'),'motion.mp4'))
test('hover uses visible viewport portion of an oversized tile',()=>{
 const point=fixture()('assetHover'); assert.equal(point.x,400);assert.equal(point.y,300)
})
test('unready video stays pending after locating its card',()=>assert.equal(fixture()('asset'),null))
test('ambiguous or unrelated cards are never used as a reference',()=>{
 assert.equal(fixture({duplicate:true,ready:true})('asset'),null)
 assert.equal(fixture({childName:'another.mp4',ready:true})('asset'),null)
})
test('blocked hover and consent produce distinguishable states',()=>{
 assert.equal(fixture({covered:true})('assetState').hoverReachable,false)
 assert.equal(fixture({consent:true})('assetHover'),'consent-required')
})

test('new unnamed tile can be hovered but cannot be accepted without identity',()=>{
 const run=fixture({childName:'',ready:true});run.beforeAdd()
 assert.equal(run('assetHover').x,400);assert.equal(run('asset'),null)
})
test('multiple unnamed new cards are not guessed',()=>{
 const run=fixture({childName:'',duplicate:true});run.beforeAdd();assert.equal(run('assetHover'),null)
})
