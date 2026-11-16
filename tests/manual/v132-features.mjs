// Local browser integration check. IPC is mocked: this does not prove Windows WebView2 behavior.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.FLOWPILOT_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({executablePath:process.env.FLOWPILOT_CHROMIUM_EXECUTABLE, args:['--no-sandbox','--disable-dev-shm-usage'],headless:true});
const page = await browser.newPage({viewport:{width:1280,height:800}});
await page.addInitScript(() => {
  window.calls=[]; window.prompts=[]; window.failLoad=false; window.failSave=false;
  const rows=['flow','gemini','suno'].map((service,i)=>({id:'p'+i,name:service+' profile',service,order:i,email:null,avatarUrl:null,avatar:'P',favorite:false}));
  let callback=0;
  window.__TAURI_INTERNALS__={transformCallback:()=>++callback,unregisterCallback(){},invoke:async(cmd,args)=>{
    window.calls.push({cmd,args});
    if(cmd==='load_accounts')return rows;
    if(cmd==='plugin:event|listen')return ++callback;
    if(cmd==='plugin:updater|check')return null;
    if(cmd==='plugin:app|version')return '1.5.25';
    if(cmd==='list_prompts'){if(window.failLoad)throw Error('read');return window.prompts}
    if(cmd==='mutate_prompt'){
      if(window.failSave)throw Error('write');
      const m=args.mutation;
      if(m.op==='save') {
        if(m.id) Object.assign(window.prompts.find(p=>p.id===m.id),m);
        else window.prompts.push({...m,id:crypto.randomUUID(),pinned:false,color:'default'});
      } else if(m.op==='delete') window.prompts=window.prompts.filter(p=>p.id!==m.id);
      else Object.assign(window.prompts.find(p=>p.id===m.id),m);
      return window.prompts;
    }
    return 1;
  }};
  window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
  Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copied=text}}});
});
await page.goto(process.env.FLOWPILOT_PREVIEW_URL || 'http://127.0.0.1:5173');
await page.getByRole('button',{name:'Prompt Library',exact:true}).click();
await page.getByRole('button',{name:'+ New prompt',exact:true}).click();
await page.getByLabel('Title',{exact:true}).fill('Test reusable prompt');
await page.getByLabel('Category',{exact:true}).fill('Writing');
await page.getByLabel('Prompt',{exact:true}).fill('Example prompt body');
// Tab must include the textarea and remain in the dialog.
await page.getByLabel('Prompt',{exact:true}).focus();
await page.keyboard.press('Tab');
assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Cancel');
assert.equal(await page.locator('aside').evaluate(e=>e.hasAttribute('inert')),true);
await page.getByRole('button',{name:'Save',exact:true}).click();
await page.locator('.prompt-card').waitFor();
assert.equal(await page.locator('aside').evaluate(e=>e.hasAttribute('inert')),false);
await page.getByRole('button',{name:'Copy',exact:true}).click();
await page.getByRole('status').filter({hasText:'Copied Test reusable prompt'}).waitFor();
assert.equal(await page.evaluate(()=>window.copied),'Example prompt body');
await page.getByRole('button',{name:'Pin',exact:true}).click();
await page.getByRole('button',{name:'Unpin',exact:true}).waitFor();
await page.getByLabel('Color for Test reusable prompt').selectOption('purple');
await page.locator('.prompt-color-purple').waitFor();
await page.getByLabel('Search prompts').fill('no result');
assert.equal(await page.locator('.prompt-card').count(),0);
await page.getByLabel('Search prompts').fill('');
await page.getByRole('button',{name:'Edit',exact:true}).click();
await page.getByLabel('Title',{exact:true}).fill('Renamed prompt');
await page.evaluate(()=>{window.failSave=true});
await page.getByRole('button',{name:'Save',exact:true}).click();
await page.getByRole('alert').waitFor();
assert.equal(await page.getByRole('dialog').count(),1);
await page.evaluate(()=>{window.failSave=false});
await page.getByRole('button',{name:'Save',exact:true}).click();
await page.getByRole('button',{name:'Renamed prompt',exact:true}).click();
await page.getByRole('dialog').waitFor();
await page.keyboard.press('Escape');
await page.getByRole('button',{name:'Delete',exact:true}).click();
await page.getByRole('button',{name:'Cancel',exact:true}).click();
assert.equal(await page.locator('.prompt-card').count(),1);
await page.setViewportSize({width:760,height:620});
await page.screenshot({path:'/tmp/flowpilot-prompts-narrow.png',fullPage:true});
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
await page.getByRole('button',{name:'Delete',exact:true}).click();
await page.getByRole('button',{name:'Delete prompt',exact:true}).click();
await page.getByText('Save your first prompt to reuse it across services.').waitFor();
await page.setViewportSize({width:1280,height:800});
for(const service of ['Gemini','Suno','Google Flow']) {
  await page.locator(`aside button[title="${service}"]`).click();
  await page.locator('.card .wide').first().click();
  await page.locator('.flow-status.is-ready').waitFor();
  if(service!=='Suno'){
    await page.getByRole('button',{name:service==='Gemini'?'Gemini TTS':'Storyboard',exact:true}).click();
    await page.waitForFunction(()=>window.calls.some(c=>c.cmd==='navigate_service_bookmark'));
  }
}
const calls=await page.evaluate(()=>window.calls);
assert.ok(calls.some(c=>c.cmd==='navigate_service_bookmark'&&c.args.service==='gemini'&&c.args.url==='https://share.gemini.google/jLVZLHqihx0e'));
assert.ok(calls.some(c=>c.cmd==='navigate_service_bookmark'&&c.args.service==='flow'&&c.args.url.includes('/shared/tool/')));
await page.getByRole('button',{name:'‹ Accounts',exact:true}).click();
await page.evaluate(()=>{window.failLoad=true});
await page.getByRole('button',{name:'Prompt Library',exact:true}).click();
await page.getByRole('alert').waitFor();
assert.equal(await page.getByRole('button',{name:'+ New prompt',exact:true}).isDisabled(),true);
await page.evaluate(()=>{window.failLoad=false});
await page.getByRole('button',{name:'Retry loading',exact:true}).click();
await page.getByText('Save your first prompt to reuse it across services.').waitFor();
console.log('PASS: prompt CRUD/pin/color/search/copy/error/retry, dialog inert/focus, narrow layout, provider navigation and tool targets (mocked IPC).');
await browser.close();
