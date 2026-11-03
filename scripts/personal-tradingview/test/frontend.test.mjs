import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {mountPersonalTradingView} from '../../../docs/tradingview-live-core.mjs';
import {normalizePacket} from '../backend/validation.mjs';
import {fixture} from '../backend/test/fixtures.mjs';

const realSetTimeout=globalThis.setTimeout;
const READ_KEY='a'.repeat(64);
const mainIDs=['price','avr','prior-high','prior-low','open1930','range-high','range-low','up','down'];
const nyIDs=['ny-price','ny-avr','ny-range-high','ny-range-low','ny-position-asia','ny-position-london','ny-printed'];
// Use the real published form and its native constraints. External/module scripts
// stay disabled; only the bridge under test is mounted. The NY controls normally
// arrive from ny-reference-v5.mjs and are supplied as a focused component fixture.
const pages=Object.fromEntries(await Promise.all(['CL','NQ','ES','GC'].map(async market=>[market,await readFile(new URL('../../../docs/'+({ES:'es/',GC:'gc/'}[market]??'')+'index.html',import.meta.url),'utf8')])));
const nyHTML=`
 <input id="ny-date" type="date" value="2026-11-03">
 <select id="ny-basis"><option value="bbox">Prior BBOX</option><option value="own">Own</option></select>
 <select id="ny-position-mode"><option value="wide">Wide</option><option value="exact">Exact</option></select>
 <select id="ny-year"><option value="2024" selected>2024</option></select>
 <select id="ny-asia-shape"><option value="Trend" selected>Trend</option></select>
 ${nyIDs.map(id=>`<input id="${id}" type="number" step="0.01" value="777">`).join('')}
 <button id="ny-position-apply" type="button">Apply positions</button><p id="ny-position-status"></p>
<button id="ny-auto-fill" type="button">Delayed NY auto-fill</button>`;

function fullRead(market='CL'){
 const {packet,now}=fixture({market});
 // Non-midpoint closes distinguish Own versus prior-BBOX position calculations.
 for(const s of packet.snapshots)s.asia_close=100.5;
 packet.snapshots[2].london_close=101.5;
 return {now,body:{schema:'sessionpath.tradingview.read.v1',status:'ready',receivedAt:new Date(now).toISOString(),packet:normalizePacket(packet,{now}),source:'TradingView personal Pine alert',validationBasis:'authenticated_pine_attestation'}};
}
const settle=()=>new Promise(resolve=>realSetTimeout(resolve,0));

async function harness(t,{market='CL',units='points',basis='bbox',loading=false,response,follow=true,autoPositions=false}={}){
 const dom=new JSDOM(pages[market],{url:'https://wanhotrading.github.io/sessionpath/'+({ES:'es/',GC:'gc/'}[market]??''),pretendToBeVisual:true});
 const original=new Map();
 for(const name of ['window','document','sessionStorage','Event','fetch','setTimeout','clearTimeout'])original.set(name,Object.getOwnPropertyDescriptor(globalThis,name));
 const originalNow=Date.now;
 const state={...fullRead(market),calls:[],submits:0,positionApplies:0,nyRefreshes:0,timers:new Map(),nextTimer:1};
 const doc=dom.window.document,$=id=>doc.getElementById(id);
 doc.documentElement.dataset.startup=loading?'loading':'ready';
 const nyPanel=$('ny-reference')??doc.body.appendChild(doc.createElement('section'));nyPanel.id='ny-reference';nyPanel.innerHTML=nyHTML;
 const tag=doc.createElement('input');tag.id='retained-tag';tag.type='checkbox';tag.checked=true;$('scenario-form').append(tag);
 const delayed=doc.createElement('button');delayed.id='context-auto-fill';delayed.type='button';doc.body.append(delayed);
 for(const id of mainIDs)$(id).value='777';
 $('trading-date').value='2026-11-03';$('asof').value='03:00';$('year').value='2025';$('behavior').value='Lower finish';$('printed').value='777';$('location').value='BELOW';$('range-position').value='0.9';
 globalThis.window=dom.window;globalThis.document=doc;globalThis.sessionStorage=dom.window.sessionStorage;globalThis.Event=dom.window.Event;
 Date.now=()=>state.now;
 globalThis.setTimeout=(fn,ms)=>{const id=state.nextTimer++;state.timers.set(id,{fn,ms});return id;};
 globalThis.clearTimeout=id=>state.timers.delete(id);
 globalThis.fetch=async(url,options)=>{state.calls.push({url:String(url),options});return response?response(state,url,options):Response.json(structuredClone(state.body));};
 $('ud-units').value=units;$('ny-basis').value=basis;$('analyze-btn').disabled=loading;
 $('scenario-form').addEventListener('submit',e=>{e.preventDefault();state.submits++;});
 $('ny-position-apply').addEventListener('click',()=>{state.positionApplies++;$('ny-position-status').textContent='Selected method applied';});
 $('ny-range-low').addEventListener('change',()=>state.nyRefreshes++);
 mountPersonalTradingView({instrument:{id:market},endpoint:'https://sessionpath-personal.jjj-jason2345.workers.dev',pineURL:'https://wanhotrading.github.io/sessionpath/sessionpath-personal-exporter.pine'});
 const box=$('personal-tradingview'),connect=box.querySelector('.tv-connect'),disconnect=box.querySelector('.tv-disconnect'),key=box.querySelector('input[type=password]');
 box.querySelector('.tv-follow').checked=follow;
 const positionToggle=[...box.querySelectorAll('label')].find(el=>el.textContent.includes('Apply NY position filters automatically'))?.querySelector('input');
 if(positionToggle)positionToggle.checked=autoPositions;
 async function start(){key.value=READ_KEY;connect.click();await settle();}
 async function poll(){const timers=[...state.timers.entries()].filter(([,v])=>v.ms===30000);assert.ok(timers.length,'30-second callbacks are scheduled');state.now+=30000;for(const [id,timer]of timers){state.timers.delete(id);timer.fn();}await settle();}
 function change(id,value){const el=$(id);if(typeof value==='boolean')el.checked=value;else el.value=value;el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));}
 t.after(()=>{dom.window.dispatchEvent(new dom.window.Event('pagehide'));dom.window.close();Date.now=originalNow;for(const [name,descriptor]of original){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
 return {dom,doc,$,box,key,connect,disconnect,state,start,poll,change,badge:()=>box.querySelector('.tv-connection-badge').textContent,status:()=>box.querySelector('.tv-connection-status').textContent};
}

for(const market of ['CL','NQ','ES','GC'])test(`${market}: authenticated backend-normalized packet fills frozen main/NY inputs and refreshes forecasts`,async t=>{
 const h=await harness(t,{market});await h.start();
 assert.equal(h.$('asof').value,'05:00');
 assert.deepEqual(Object.fromEntries(mainIDs.map(id=>[id,Number(h.$(id).value)])),{price:100,avr:5.123456,'prior-high':105,'prior-low':95,open1930:100,'range-high':103,'range-low':97,up:3,down:3});
 assert.deepEqual(Object.fromEntries(nyIDs.map(id=>[id,Number(h.$(id).value)])),{'ny-price':100,'ny-avr':5.123456,'ny-range-high':104,'ny-range-low':96,'ny-position-asia':55,'ny-position-london':65,'ny-printed':156.1});
 assert.equal(h.$('printed').value,'117.1');assert.equal(h.$('location').value,'Q3');assert.equal(h.$('range-position').value,'0.5');assert.equal(h.$('behavior').value,'Higher finish');
 assert.equal(h.state.submits,1,'live application refreshes the main forecast even when automatic AVR has sub-tick precision');assert.equal(h.state.positionApplies,0,'quarter filters are retained unless explicitly opted in');assert.equal(h.state.nyRefreshes,1);assert.equal(h.badge(),'Connected');
 assert.equal(new URL(h.state.calls[0].url).search,'?market='+market);assert.equal(h.state.calls[0].options.headers.Authorization,'Bearer '+READ_KEY);assert.equal(h.state.calls[0].options.credentials,'omit');assert.equal(h.state.calls[0].options.cache,'no-store');
 assert.equal(h.$('year').value,'2025');assert.equal(h.$('ny-year').value,'2024');assert.equal(h.$('behavior').value,'Higher finish');assert.equal(h.$('ny-asia-shape').value,'Trend');assert.equal(h.$('retained-tag').checked,true);
 assert.equal(h.dom.window.localStorage.length,0,'private key never enters persistent localStorage');
});

test('percent units scale only U/D; Own positions use each completed session range',async t=>{
 const h=await harness(t,{units:'percent',basis:'own'});await h.start();
 assert.ok(Math.abs(Number(h.$('up').value)-300/5.123456)<1e-8);assert.ok(Math.abs(Number(h.$('down').value)-300/5.123456)<1e-8);
 assert.equal(Number(h.$('range-high').value),103);assert.equal(Number(h.$('avr').value),5.123456);
 assert.equal(Number(h.$('ny-position-asia').value),75);assert.equal(Number(h.$('ny-position-london').value),75);
 assert.equal(h.state.submits,1,'computed fractional percentages still refresh analysis');
});

test('explicit position-filter opt-in applies the completed NY positions',async t=>{const h=await harness(t,{autoPositions:true});await h.start();assert.equal(h.state.positionApplies,1);assert.match(h.$('ny-position-status').textContent,/TradingView personal snapshot/);});

test('new live-price heartbeat preserves frozen decision opens and avoids duplicate forecast refresh',async t=>{
 const h=await harness(t);await h.start();h.state.body.packet.last_price=110;await h.poll();
 assert.equal(Number(h.$('price').value),100);assert.equal(Number(h.$('ny-price').value),100);assert.equal(h.state.submits,1);assert.equal(h.state.positionApplies,0);assert.equal(h.state.nyRefreshes,1);
});

test('Replay blocks live application and resumes only after Replay is switched off',async t=>{
 const h=await harness(t);h.$('replay-toggle').checked=true;await h.start();
 assert.equal(h.badge(),'Paused');assert.match(h.status(),/Replay/);assert.equal(h.state.submits,0);assert.equal(h.$('price').value,'777');
 h.change('replay-toggle',false);await settle();assert.equal(h.state.submits,1);assert.equal(h.$('price').value,'100');
});

test('research loading blocks all model writes, then the next read applies once ready',async t=>{
 const h=await harness(t,{loading:true});await h.start();assert.equal(h.badge(),'Waiting');assert.equal(h.state.submits,0);assert.equal(h.$('price').value,'777');assert.equal(h.$('ny-price').value,'777');
 h.$('analyze-btn').disabled=false;h.doc.documentElement.dataset.startup='ready';await h.poll();assert.equal(h.state.submits,1);assert.equal(h.$('price').value,'100');
});

test('early session reconnect cannot submit before the application registers its model handlers',async t=>{
 const h=await harness(t);h.doc.documentElement.dataset.startup='loading';h.$('analyze-btn').disabled=false;await h.start();
 assert.equal(h.state.submits,0);assert.equal(h.$('price').value,'777');assert.equal(h.badge(),'Waiting');
 h.doc.documentElement.dataset.startup='ready';await h.poll();assert.equal(h.state.submits,1);assert.equal(h.$('price').value,'100');
});

for(const mode of ['stale','old-ready-timestamp','wrong-market','wrong-date','unauthorized','waiting'])test(`${mode} response keeps existing inputs and forecasts`,async t=>{
 const response=(state)=>{const body=structuredClone(state.body);if(mode==='unauthorized')return new Response('{}',{status:401});if(mode==='stale')body.status='stale';if(mode==='old-ready-timestamp')body.packet.observed_at='2026-11-03T13:25:00.000Z';if(mode==='wrong-market')body.packet.market='NQ';if(mode==='wrong-date')body.packet.session_date='2026-11-02';if(mode==='waiting'){body.status='waiting';body.packet=null;body.receivedAt=null;}return Response.json(body);};
 const h=await harness(t,{response});await h.start();assert.equal(h.$('price').value,'777');assert.equal(h.$('ny-price').value,'777');assert.equal(h.state.submits,0);assert.equal(h.state.positionApplies,0);assert.equal(h.badge(),mode==='waiting'?'Waiting':'Unavailable');
});

test('no key or malformed key never starts an anonymous data request',async t=>{const h=await harness(t);assert.equal(h.state.calls.length,0);assert.equal(h.badge(),'Off');h.key.value='short';h.connect.click();await settle();assert.equal(h.state.calls.length,0);assert.equal(h.$('price').value,'777');});

test('Disconnect clears tab credentials and ignores a late successful response',async t=>{
 let complete;const h=await harness(t,{response:()=>new Promise(resolve=>{complete=resolve;})});await h.start();assert.equal(h.state.calls.length,1);h.disconnect.click();assert.equal(h.state.calls[0].options.signal.aborted,true);complete(Response.json(h.state.body));await settle();
 assert.equal(h.badge(),'Off');assert.equal(h.key.value,'');assert.equal(h.dom.window.sessionStorage.getItem('sessionpath-personal-read-v1'),null);assert.equal(h.dom.window.sessionStorage.getItem('sessionpath-personal-enabled-v1'),null);assert.equal(h.$('price').value,'777');assert.equal(h.state.submits,0);if([...h.state.timers.values()].some(v=>v.ms===30000))await h.poll();assert.equal(h.state.calls.length,1,'placement cleanup is allowed, but no data polling continues after disconnect');
});

test('context changed during fetch discards that response, then applies a current request',async t=>{
 let complete;const h=await harness(t,{follow:false,response:state=>state.calls.length===1?new Promise(resolve=>{complete=resolve;}):Response.json(state.body)});await h.start();h.change('asof','05:00');complete(Response.json(h.state.body));await settle();assert.equal(h.state.submits,0);assert.equal(h.$('price').value,'777');await h.poll();assert.equal(h.state.submits,1);assert.equal(h.$('range-high').value,'103');
});

test('NY date away and back resets its applied fingerprint and refills today',async t=>{
 const h=await harness(t);await h.start();h.change('ny-date','2026-11-02');await settle();h.$('ny-price').value='999';h.change('ny-date','2026-11-03');await settle();assert.equal(h.$('ny-price').value,'100');assert.equal(h.state.nyRefreshes,2);
});

test('programmatic delayed-button click is untrusted; browser-only manual pause path is not fabricated',async t=>{
 const h=await harness(t);await h.start();let trust;h.$('context-auto-fill').addEventListener('click',e=>{trust=e.isTrusted;});h.$('context-auto-fill').click();assert.equal(trust,false);assert.equal(h.badge(),'Connected');
 // jsdom cannot synthesize a trusted user event. Actual keyboard edits and
 // capture-phase delayed-source pause require the real browser acceptance check.
});

test('personal controls relocate immediately after a planning row mounted asynchronously',async t=>{
 const h=await harness(t),form=h.$('scenario-form'),bar=form.querySelector('.planning-bar');
 assert.equal(h.box.parentElement,form);assert.equal(bar.nextElementSibling,h.box);
 const row=h.doc.createElement('div');row.id='planning-auto-fill-row';bar.after(row);await settle();
 assert.equal(row.nextElementSibling,h.box);assert.equal(h.box.parentElement,form);assert.equal(h.doc.querySelectorAll('#personal-tradingview').length,1);
 row.append(h.doc.createElement('span'));await settle();assert.equal(row.nextElementSibling,h.box);assert.equal(h.state.calls.length,0);
});

test('Enter in private key cancels the main form default action',async t=>{
 const h=await harness(t);h.key.value='short';const event=new h.dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});
 const allowed=h.key.dispatchEvent(event);await settle();assert.equal(allowed,false,'key handler must prevent implicit main-form submission');assert.equal(event.defaultPrevented,true);assert.equal(h.state.submits,0);assert.equal(h.state.calls.length,0);
});

test('network source unavailable status retains inputs without exposing a raw fetch diagnostic',async t=>{
 const h=await harness(t,{response:()=>{throw new TypeError('Failed to fetch');}});await h.start();assert.equal(h.badge(),'Unavailable');assert.match(h.status(),/Cannot reach your private TradingView feed/);assert.equal(h.$('price').value,'777');assert.equal(h.state.submits,0);
});

test('private connection input and change events do not reach the model form',async t=>{
 const h=await harness(t);let inputs=0,changes=0;h.$('scenario-form').addEventListener('input',()=>inputs++);h.$('scenario-form').addEventListener('change',()=>changes++);
 h.key.value='short';h.key.dispatchEvent(new h.dom.window.Event('input',{bubbles:true}));
 const follow=h.box.querySelector('.tv-follow');follow.checked=false;follow.dispatchEvent(new h.dom.window.Event('change',{bubbles:true}));
 assert.equal(inputs,0);assert.equal(changes,0);assert.equal(h.state.submits,0);assert.equal(h.state.calls.length,0);
});
