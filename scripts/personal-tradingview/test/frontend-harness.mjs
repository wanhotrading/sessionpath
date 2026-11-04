import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {mountPersonalTradingView} from '../../../docs/tradingview-live-core.mjs';
import {normalizePacket} from '../backend/validation.mjs';
import {fixture} from '../backend/test/fixtures.mjs';

const realSetTimeout=globalThis.setTimeout;
export const READ_KEY='a'.repeat(64);
export const mainIDs=['price','avr','prior-high','prior-low','open1930','range-high','range-low','up','down'];
export const nyIDs=['ny-price','ny-avr','ny-range-high','ny-range-low','ny-position-asia','ny-position-london','ny-printed'];
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
export const settle=()=>new Promise(resolve=>realSetTimeout(resolve,0));

export async function harness(t,{market='CL',units='points',basis='bbox',loading=false,response,sourceOnly=true,lateNY=false,audioAvailable=true,readKey=READ_KEY,reconnect=false,managedReadURL}={}){
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
 if(readKey!==null)dom.window.sessionStorage.setItem('sessionpath-personal-read-v1',readKey);
 if(reconnect)dom.window.sessionStorage.setItem('sessionpath-personal-enabled-v1','true');
 mountPersonalTradingView({instrument:{id:market},endpoint:'https://sessionpath-personal.jjj-jason2345.workers.dev',managedReadURL});
 async function start(){primary()?.click();await settle();}
 async function poll(){const timers=[...state.timers.entries()].filter(([,v])=>v.ms===30000);assert.ok(timers.length,'30-second callbacks are scheduled');state.now+=30000;for(const [id,timer]of timers){state.timers.delete(id);timer.fn();}await settle();}
 function change(id,value){const el=$(id);if(typeof value==='boolean')el.checked=value;else el.value=value;el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));}
 t.after(()=>{dom.window.dispatchEvent(new dom.window.Event('pagehide'));dom.window.close();Date.now=originalNow;for(const [name,descriptor]of original){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
 async function mountNY(){nyPanel.innerHTML=nyHTML;bindNY();await settle();}
 const primary=()=>$('personal-auto-fill');
 function formButtons(){return $('scenario-form').querySelectorAll('button');}
 function expireFeedback(){for(const[id,timer]of [...state.timers])if(timer.ms>=1500&&timer.ms<=2100){state.timers.delete(id);timer.fn();}}
 return {dom,doc,$,state,start,poll,change,mountNY,primary,expireFeedback,status:()=>$('personal-auto-fill-status')?.textContent};
}

export function assertNoSuccessFeedback(h){
 assert.equal(h.state.audioStarts,0,'No success tones are scheduled');
 assert.equal(h.doc.querySelectorAll('.auto-fill-updated').length,0,'No fields receive success highlighting');
 assert.ok(!h.$('personal-auto-fill-popup')||h.$('personal-auto-fill-popup').hidden,'No Done popup is visible');
}

