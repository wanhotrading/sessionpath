// Run against the built Pages candidate using the same history the site ships.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const {spawn} = require('node:child_process');
const {mkdtemp,readFile,symlink,rm} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const {join,resolve} = require('node:path');
const base = 'http://127.0.0.1:18763/sessionpath/';
const cases = [
  ['CL','',85.66,2.214,'SP6'],['NQ','',26717.5,801.3,'SPNQ'],
  ['ES','es/',7320.5,157.8,'SPES'],['GC','gc/',3701.6,69.48,'SPGC']
];
async function checkNyExtensions(page, market, path) {
  await page.getByRole('button', {name:'Open tools', exact:true}).click();
  const tools = page.getByRole('dialog', {name:'Tools', exact:true});
  await tools.getByRole('link', {name:'08:30–16:00 NY box extensions', exact:true}).click();
  await page.waitForURL(url => url.pathname === '/sessionpath/'+path+'ny-sessionpath-extension.html');
  assert.equal(new URL(page.url()).searchParams.get('instrument'), market);
  await page.getByRole('heading', {name:'NY SessionPath · 1.20×–1.50×', exact:true}).waitFor();

  const dataPath = path ? path + 'data/' + market.toLowerCase() + '/ny-sessionpath-extension-data.json' : 'ny-sessionpath-extension-data.json';
  const {groups} = JSON.parse(await readFile(resolve('docs',dataPath),'utf8'));
  const baseline = groups.find(group => group.market === market && group.method === 'nyOwnWide' &&
    group.minFit === 50 && group.cohort === 'ALL');
  const hitCount = rate => (100*rate.k/rate.n).toFixed(1)+'% ('+rate.k.toLocaleString('en-US')+'/'+rate.n.toLocaleString('en-US')+')';
  for (const multiple of [1.2,1.3,1.5]) {
    const result = baseline.levels.find(level => level.multiple === multiple);
    const level = (table) => page.locator(table+' tr').filter({
      has:page.getByRole('cell', {name:multiple.toFixed(2)+'×', exact:true})
    });
    const wholeWindow = level('#unconditional').getByRole('cell').nth(3);
    const pending = level('#pending-results').getByRole('cell').nth(4);
    await wholeWindow.waitFor();
    assert.ok((await wholeWindow.innerText()).includes(hitCount(result.either)), market+' whole-window '+multiple);
    assert.ok((await pending.innerText()).includes(hitCount(result.afterConfirmation.all.pendingHit)),
      market+' after confirmation '+multiple);
  }

  await page.getByRole('link', {name:'Tail event · NY behaviour', exact:true}).click();
  const extensions = page.getByRole('link', {name:'08:30–16:00 NY box extensions', exact:true});
  await page.waitForFunction(expected => {
    const link = document.getElementById('ny-extension-link');
    return link && new URL(link.href).searchParams.get('instrument') === expected;
  }, market);
  assert.ok(await extensions.isVisible(), market+' Tail event link');
  console.log(market+' Tail event links and 08:30–16:00 NY extension results verified.');
}
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
    await checkNyExtensions(page,market,path);
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

