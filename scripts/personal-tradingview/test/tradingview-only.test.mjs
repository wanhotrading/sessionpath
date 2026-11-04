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
<details id="util-direction-context"><input id="util-three-up" value="12"><input id="util-three-down" value="13"><input id="util-five-up" value="14"><input id="util-five-down" value="15"></details>
<details id="ny-close-archive"><input id="ny-strength-three" value="16"><input id="ny-strength-five" value="17"></details>`;

function fullRead(market='CL'){
 const {packet,now}=fixture({market});
 // Non-midpoint closes distinguish Own versus prior-BBOX position calculations.
 for(const s of packet.snapshots)s.asia_close=100.5;
 packet.snapshots[2].london_close=101.5;
 return {now,body:{schema:'sessionpath.tradingview.read.v1',status:'ready',receivedAt:new Date(now).toISOString(),packet:normalizePacket(packet,{now}),source:'TradingView personal Pine alert',validationBasis:'authenticated_pine_attestation'}};
}
const settle=()=>new Promise(resolve=>realSetTimeout(resolve,0));

async function harness(t,{market='CL',units='points',basis='bbox',loading=false,response,follow=true,autoPositions=false,sourceOnly=true,lateNY=false,audioAvailable=true}={}){
 const dom=new JSDOM(pages[market],{url:'https://wanhotrading.github.io/sessionpath/'+({ES:'es/',GC:'gc/'}[market]??''),pretendToBeVisual:true});
 const original=new Map();
 for(const name of ['window','document','sessionStorage','Event','fetch','setTimeout','clearTimeout'])original.set(name,Object.getOwnPropertyDescriptor(globalThis,name));
 const originalNow=Date.now;
 const state={...fullRead(market),calls:[],submits:0,positionApplies:0,nyRefreshes:0,timers:new Map(),nextTimer:1,audioStarts:0,audioContexts:0};
 const doc=dom.window.document,$=id=>doc.getElementById(id);
 const existingMode=doc.querySelector('meta[name="sessionpath-source-mode"]');existingMode?.remove();
 if(sourceOnly){const mode=doc.createElement('meta');mode.name='sessionpath-source-mode';mode.content='tradingview-only';doc.head.append(mode);}
 doc.documentElement.dataset.startup=loading?'loading':'ready';
 const nyPanel=$('ny-reference')??doc.body.appendChild(doc.createElement('section'));nyPanel.id='ny-reference';nyPanel.innerHTML=lateNY?'':nyHTML;
 const tag=doc.createElement('input');tag.id='retained-tag';tag.type='checkbox';tag.checked=true;$('scenario-form').append(tag);
 for(const id of mainIDs)$(id).value='777';
 $('trading-date').value='2026-11-03';$('asof').value='03:00';$('year').value='2025';$('behavior').value='Lower finish';$('printed').value='777';$('location').value='BELOW';$('range-position').value='0.9';
 globalThis.window=dom.window;globalThis.document=doc;globalThis.sessionStorage=dom.window.sessionStorage;globalThis.Event=dom.window.Event;
 Date.now=()=>state.now;
 globalThis.setTimeout=(fn,ms)=>{const id=state.nextTimer++;state.timers.set(id,{fn,ms});return id;};
 globalThis.clearTimeout=id=>state.timers.delete(id);
 globalThis.fetch=async(url,options)=>{state.calls.push({url:String(url),options});return response?response(state,url,options):Response.json(structuredClone(state.body));};
 $('ud-units').value=units;if($('ny-basis'))$('ny-basis').value=basis;$('analyze-btn').disabled=loading;
 $('scenario-form').addEventListener('submit',e=>{e.preventDefault();state.submits++;});
 function bindNY(){if($('ny-basis'))$('ny-basis').value=basis;$('ny-position-apply')?.addEventListener('click',()=>{state.positionApplies++;$('ny-position-status').textContent='Selected method applied';});$('ny-range-low')?.addEventListener('change',()=>state.nyRefreshes++);}
 bindNY();
 dom.window.HTMLElement.prototype.scrollIntoView=function(){};
 // Observe actual tone scheduling without audio hardware or browser autoplay.
 if(audioAvailable)dom.window.AudioContext=class {
  constructor(){state.audioContexts++;this.state='running';this.currentTime=0;this.destination={};}
  resume(){this.state='running';return Promise.resolve();}
  createGain(){return {gain:{value:0,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
  createOscillator(){return {frequency:{value:0},connect(){},disconnect(){},start(){state.audioStarts++;},stop(){}};}
 };
 mountPersonalTradingView({instrument:{id:market},endpoint:'https://sessionpath-personal.jjj-jason2345.workers.dev',pineURL:'https://wanhotrading.github.io/sessionpath/sessionpath-personal-exporter.pine'});
 const box=$('personal-tradingview'),connect=box.querySelector('.tv-connect'),disconnect=box.querySelector('.tv-disconnect'),key=box.querySelector('input[type=password]');
 box.querySelector('.tv-follow').checked=follow;
 const positionToggle=[...box.querySelectorAll('label')].find(el=>el.textContent.includes('Apply NY position filters automatically'))?.querySelector('input');
 if(positionToggle)positionToggle.checked=autoPositions;
 async function start(){key.value=READ_KEY;connect.click();await settle();}
 async function poll(){const timers=[...state.timers.entries()].filter(([,v])=>v.ms===30000);assert.ok(timers.length,'30-second callbacks are scheduled');state.now+=30000;for(const [id,timer]of timers){state.timers.delete(id);timer.fn();}await settle();}
 function change(id,value){const el=$(id);if(typeof value==='boolean')el.checked=value;else el.value=value;el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));}
 t.after(()=>{dom.window.dispatchEvent(new dom.window.Event('pagehide'));dom.window.close();Date.now=originalNow;for(const [name,descriptor]of original){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
 async function mountNY(){nyPanel.innerHTML=nyHTML;bindNY();await settle();}
 const primary=()=>[...formButtons()].find(el=>/auto.?fill/i.test(el.textContent)&&/TradingView/i.test(el.textContent));
 function formButtons(){return $('scenario-form').querySelectorAll('button');}
 function expireFeedback(){for(const[id,timer]of [...state.timers])if(timer.ms>=1500&&timer.ms<=2100){state.timers.delete(id);timer.fn();}}
 return {dom,doc,$,box,key,connect,disconnect,state,start,poll,change,mountNY,primary,expireFeedback,badge:()=>box.querySelector('.tv-connection-badge').textContent,status:()=>box.querySelector('.tv-connection-status').textContent};
}

function assertNoSuccessFeedback(h){
 assert.equal(h.state.audioStarts,0,'No success tones are scheduled');
 assert.equal(h.doc.querySelectorAll('.auto-fill-updated').length,0,'No fields receive success highlighting');
 assert.ok(!h.$('personal-auto-fill-popup')||h.$('personal-auto-fill-popup').hidden,'No Done popup is visible');
}

test('TradingView-only source has one primary Auto-fill below decision time and above private setup',async t=>{
 const h=await harness(t),bar=h.$('scenario-form').querySelector('.planning-bar'),button=h.primary();assert.ok(button,'a visible primary TradingView Auto-fill exists');
 assert.equal([...h.$('scenario-form').querySelectorAll('button')].filter(el=>/auto.?fill/i.test(el.textContent)&&/TradingView/i.test(el.textContent)).length,1);
 const row=button.closest('#personal-auto-fill-row');assert.ok(row);assert.equal(bar.nextElementSibling,row);assert.equal(row.nextElementSibling,h.box);assert.equal(button.type,'button');assert.equal(h.state.calls.length,0);assert.match(h.$('personal-auto-fill-status').textContent,/not been refreshed/);
});

test('Auto-fill without a key opens and focuses private setup, with zero data requests',async t=>{
 const h=await harness(t);h.primary().click();await settle();assert.equal(h.box.open,true);assert.equal(h.doc.activeElement,h.key);assert.equal(h.state.calls.length,0);assert.equal(h.state.submits,0);assert.equal(h.$('price').value,'777');assert.equal(h.$('personal-auto-fill-status').textContent,h.status());
 assertNoSuccessFeedback(h);
});

test('normal03:00 confirmation wait automatically becomes a successful03:05 fill without reconnecting',async t=>{
 const h=await harness(t,{market:'CL',follow:false});const ready=structuredClone(h.state.body);
 h.state.now=Date.parse('2026-11-03T08:02:00Z');h.state.body={...ready,status:'waiting',receivedAt:'2026-11-03T08:00:01Z',packet:{...ready.packet,observed_at:'2026-11-03T08:00:00Z',sent_at:'2026-11-03T08:00:00Z',snapshots:[]}};
 h.key.value=READ_KEY;h.primary().click();await settle();assert.equal(h.badge(),'Connected');assert.match(h.status(),/03:05 NY/);assertNoSuccessFeedback(h);assert.equal(h.$('price').value,'777');
 h.state.now=Date.parse('2026-11-03T08:05:10Z');h.state.body={...ready,receivedAt:'2026-11-03T08:05:01Z',packet:{...ready.packet,observed_at:'2026-11-03T08:05:00Z',sent_at:'2026-11-03T08:05:00Z',snapshots:[ready.packet.snapshots[0]]}};
 await h.poll();assert.equal(h.badge(),'Connected');assert.match(h.status(),/applied 03:00/);assert.equal(h.$('range-high').value,'102');assert.equal(h.state.submits,1);assert.equal(h.state.audioStarts,3);
});

test('connected key leaves the editable field while polling and explicit refills retain the scoped authorization',async t=>{
 const h=await harness(t);h.key.value=READ_KEY;h.primary().click();await settle();assert.equal(h.key.value,'');assert.equal(h.key.placeholder,'Saved for this tab');assert.equal(h.key.readOnly,true);
 h.key.value='unexpected browser edit';h.key.dispatchEvent(new h.dom.window.Event('input',{bubbles:true}));assert.equal(h.badge(),'Connected');
 await h.poll();assert.equal(h.state.calls.at(-1).options.headers.Authorization,'Bearer '+READ_KEY);assert.equal(h.badge(),'Connected');
 h.primary().click();await settle();assert.equal(h.state.calls.at(-1).options.headers.Authorization,'Bearer '+READ_KEY);assert.equal(h.key.value,'');
 h.disconnect.click();const n=h.state.calls.length;h.primary().click();await settle();assert.equal(h.state.calls.length,n);assert.equal(h.key.placeholder,'');assert.equal(h.key.readOnly,false);
});

for(const market of ['CL','NQ','ES','GC'])test(`${market}: explicit Auto-fill uses only private auth and honors selected03:00 instead of clock's05:00`,async t=>{
 const h=await harness(t,{market});h.key.value=READ_KEY;h.primary().click();await settle();assert.equal(h.state.calls.length,1);const call=h.state.calls[0];assert.equal(new URL(call.url).origin,'https://sessionpath-personal.jjj-jason2345.workers.dev');assert.equal(new URL(call.url).pathname,'/api/snapshots');assert.equal(call.options.headers.Authorization,'Bearer '+READ_KEY);assert.equal(new URL(call.url).searchParams.get('market'),market);assert.equal(h.box.querySelector('.tv-follow').checked,false);assert.equal(h.$('asof').value,'03:00');assert.equal(h.$('range-high').value,'102');assert.equal(h.$('range-low').value,'98');assert.equal(h.state.submits,1);assert.ok(!call.url.includes('yahoo'));assert.ok(!call.url.includes('sessionpath-data'));
 for(const id of [...mainIDs,...nyIDs])assert.ok(h.$(id).classList.contains('auto-fill-updated'),id+' is visibly filled');
 for(const id of ['year','ny-year','ny-asia-shape','util-three-up','ny-strength-three'])assert.ok(!h.$(id).classList.contains('auto-fill-updated'),id+' stays manual');
 assert.ok(!h.key.classList.contains('auto-fill-updated'));assert.equal(h.state.audioStarts,3,'One bell for combined main and NY fills');assert.equal(h.$('personal-auto-fill-popup').hidden,false);assert.match(h.$('personal-auto-fill-popup').textContent,/Done!/);
});

test('two rapid Auto-fill clicks do not overlap fetches or apply a response after the user changes context',async t=>{
 let complete;const h=await harness(t,{response:()=>new Promise(resolve=>{complete=resolve;})});h.key.value=READ_KEY;const button=h.primary();button.click();button.click();await settle();assert.equal(h.state.calls.length,1);h.change('asof','05:00');complete(Response.json(h.state.body));await settle();assert.equal(h.state.submits,0);assert.equal(h.$('price').value,'777');
 assertNoSuccessFeedback(h);
});

test('rapid repeat click preserves the first request so an unchanged selected checkpoint still applies once',async t=>{
 let complete;const h=await harness(t,{response:()=>new Promise(resolve=>{complete=resolve;})});h.key.value=READ_KEY;const button=h.primary();button.click();button.click();await settle();assert.equal(h.state.calls.length,1);assert.equal(button.disabled,true);assert.equal(h.connect.disabled,true);complete(Response.json(h.state.body));await settle();assert.equal(h.state.submits,1);assert.equal(h.$('asof').value,'03:00');assert.equal(h.$('range-high').value,'102');assert.equal(button.disabled,false);assert.equal(h.connect.disabled,false);assert.match(h.$('personal-auto-fill-status').textContent,/applied 03:00/);
});

test('TradingView-only disconnect retains manual input instructions without suggesting Yahoo/delayed source',async t=>{
 const h=await harness(t);await h.start();h.disconnect.click();assert.equal(h.badge(),'Off');assert.match(h.status(),/manual/i);assert.doesNotMatch(h.status(),/Yahoo|delayed/i);assert.equal(h.$('personal-auto-fill-status').textContent,h.status());
});

test('late NY panels receive manual-review notes while their existing direction entries remain untouched',async t=>{
 const h=await harness(t,{lateNY:true});await h.mountNY();assert.ok(h.$('ny-util-autofill-status'),'manual utilization status mounts without the Yahoo module');assert.ok(h.$('ny-close-autofill-status'),'manual counts status mounts without the Yahoo module');assert.match(h.$('ny-util-autofill-status').textContent,/manual/i);assert.match(h.$('ny-close-autofill-status').textContent,/manual/i);
 await h.start();for(const [id,value]of Object.entries({'util-three-up':'12','util-three-down':'13','util-five-up':'14','util-five-down':'15','ny-strength-three':'16','ny-strength-five':'17'}))assert.equal(h.$(id).value,value);assert.match(h.$('ny-close-autofill-status').textContent,/manual/i);
});

test('mixed mode still keeps its legacy setup and source copy without inventing a TradingView-only primary row',async t=>{
 const h=await harness(t,{sourceOnly:false});assert.equal(h.primary(),undefined);await h.start();assert.equal(h.state.submits,1);h.disconnect.click();assert.match(h.status(),/delayed Auto-fill/);
});

test('success feedback expires, remains silent on unchanged polling, and repeats on explicit refill',async t=>{
 const h=await harness(t);await h.start();assert.equal(h.state.audioStarts,3);assert.equal(h.state.submits,1);
 h.expireFeedback();assert.equal(h.doc.querySelectorAll('.auto-fill-updated').length,0);assert.equal(h.$('personal-auto-fill-popup').hidden,true);
 h.state.body.packet.last_price=110;await h.poll();assert.equal(h.state.audioStarts,3,'A heartbeat alone is not a new fill');assert.equal(h.doc.querySelectorAll('.auto-fill-updated').length,0);assert.equal(h.$('personal-auto-fill-popup').hidden,true);
 await h.start();assert.equal(h.state.audioStarts,6,'Explicitly refilling the same snapshot rings once more');assert.equal(h.$('price').classList.contains('auto-fill-updated'),true);assert.equal(h.$('personal-auto-fill-popup').hidden,false);
});

test('rejected, waiting and failed reads never produce success feedback',async t=>{
 let mode='unauthorized';
 const h=await harness(t,{response:state=>{
  if(mode==='network')throw new TypeError('Failed to fetch');
  if(mode==='unauthorized')return new Response('{}',{status:401});
  const body=structuredClone(state.body);
  if(mode==='waiting'){body.status='waiting';body.packet=null;}
  if(mode==='stale')body.status='stale';
  if(mode==='wrong-market')body.packet.market='NQ';
  return Response.json(body);
 }});
 for(mode of ['unauthorized','waiting','stale','wrong-market','network']){await h.start();assertNoSuccessFeedback(h);assert.equal(h.$('price').value,'777');assert.equal(h.state.submits,0);}
});

test('research loading and Replay do not signal a successful fill',async t=>{
 const h=await harness(t,{loading:true});await h.start();assertNoSuccessFeedback(h);
 h.doc.documentElement.dataset.startup='ready';h.$('analyze-btn').disabled=false;h.$('replay-toggle').checked=true;await h.start();assertNoSuccessFeedback(h);assert.equal(h.state.submits,0);assert.equal(h.$('price').value,'777');
});

test('unsupported audio preserves successful filling, highlighting and Done popup',async t=>{
 const h=await harness(t,{audioAvailable:false});await h.start();assert.equal(h.state.submits,1);assert.equal(h.$('price').value,'100');assert.equal(h.state.audioStarts,0);assert.equal(h.$('price').classList.contains('auto-fill-updated'),true);assert.equal(h.$('personal-auto-fill-popup').hidden,false);
});

test('a response arriving after Disconnect cannot produce success feedback',async t=>{
 let complete;const h=await harness(t,{response:()=>new Promise(resolve=>{complete=resolve;})});h.key.value=READ_KEY;h.primary().click();await settle();h.disconnect.click();complete(Response.json(h.state.body));await settle();assertNoSuccessFeedback(h);assert.equal(h.state.submits,0);assert.equal(h.$('price').value,'777');
});

