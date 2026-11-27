// Run against the built Pages candidate using the same history the site ships.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const {spawn} = require('node:child_process');
const {mkdtemp,symlink,rm} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const {join,resolve} = require('node:path');
const base = 'http://127.0.0.1:18763/sessionpath/';
const cases = [
  ['CL','',85.66,2.214,'SP6'],['NQ','',26717.5,801.3,'SPNQ'],
  ['ES','es/',7320.5,157.8,'SPES'],['GC','gc/',3701.6,69.48,'SPGC']
];
async function checkMarket(browser,[market,path,open,avr,prefix]){
  const context=await browser.newContext({timezoneId:'America/New_York',permissions:['clipboard-read','clipboard-write']});
  try {
    const page=await context.newPage();
    await page.clock.setFixedTime(new Date('2026-11-27T11:36:00Z'));
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin===new URL(base).origin || ['blob:','data:'].includes(url.protocol))return route.continue();
      if(url.pathname==='/api/autofill' || url.pathname==='/api/history'){
        const live=url.pathname==='/api/autofill';
        const body=live?{schema:'sessionpath.tradingview.read.v1',status:'waiting',packet:null}:
          {schema:'sessionpath.tradingview.history.v1',status:'unavailable',date:'2026-11-27',packet:null};
        return route.fulfill({json:body,headers:{'access-control-allow-origin':'*'}});
      }
      return route.abort();
    });
    await page.goto(base+path+'?instrument='+market,{waitUntil:'domcontentloaded'});
    const card=page.locator('#window-0500');
    const copy=card.getByRole('button',{name:'Copy forecast code'});
    await card.locator('.session-board-source').filter({hasText:/05:00 NY.*2026-11-27/}).waitFor({timeout:90000});
    assert.equal(await page.locator('.session-board-window:visible').count(),1);
    assert.match(await card.locator('h2').innerText(),/05:00–08:30/);
    const values=await card.locator('.session-board-check dd').allTextContents();
    assert.deepEqual(values.map(v=>Number(v.replaceAll(',',''))),[open,avr]);
    assert.match(await card.locator('.session-board-containment dd').innerText(),/^\d+(\.\d+)?%$/);
    await card.getByText('Mean added range',{exact:true}).waitFor();
    await page.waitForFunction(()=>!document.querySelector('#window-0500 .session-board-export button').disabled);
    await copy.click();
    const code=(await page.evaluate(()=>navigator.clipboard.readText())).trim().split('|');
    assert.ok(code[0].startsWith(prefix),market+' code prefix '+code[0]);
    assert.equal(Number(code[1]),Date.parse('2026-11-27T10:00:00Z'));
    assert.equal(Number(code[2]),Date.parse('2026-11-27T13:30:00Z'));
    assert.equal(Number(code[3]),open);
    for(const name of ['BBOX return probability','Continuation & first breach','Session paths']){
      assert.ok(await page.getByRole('heading',{name,exact:true}).first().isVisible(),market+' '+name);
    }
    console.log(market+' 05:00 NY, open '+open+', AVR '+avr+', containment and copied code verified.');
  } finally {await context.close();}
}
(async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sessionpath-release-'));
 let server,browser;
 try{
   await symlink(resolve('docs'),join(dir,'sessionpath'),'dir');
   server=spawn('python3',['-m','http.server','18763','--bind','127.0.0.1','--directory',dir],{stdio:'ignore'});
   for(let i=0;i<50;i++){try{if((await fetch(base)).ok)break;}catch{} await new Promise(resolve=>setTimeout(resolve,100));}
   browser=await chromium.launch({channel:'chrome',headless:true});
   for(const sample of cases)await checkMarket(browser,sample);
 }finally{await browser?.close();server?.kill();await rm(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});

