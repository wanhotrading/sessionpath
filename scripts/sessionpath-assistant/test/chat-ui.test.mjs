import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountAssistantChat,validateChatIntent,readChatState,assistantMarketURL} from '../../../docs/assistant-chat.mjs';

const KEY='sessionpath-assistant-chat-v1';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const intent=(overrides={})=>({ok:true,action:'forecast',market:'CL',window:'03:00-05:00',concept:null,message:'Reading the forecast.',interpreter:'rules',...overrides});
function fixture(request){return {schema:'sessionpath.assistant.forecast.v1',ok:true,...request,date:'2026-11-04',timezone:'America/New_York',source:{provider:'TradingView',symbol:request.market+'1!',checkpoint:request.window.slice(0,5)},range:{upper:96.8,lower:95.1,upPoints:.8,downPoints:.9,extensionUpPoints:.2,extensionDownPoints:.1},sampleCount:100,probabilities:{units:'fraction',containment:{p:.42,k:42,n:100},upperTouch:{p:.35,k:35,n:100},lowerTouch:{p:.4,k:40,n:100}},code:'SP6|exact|model|code',warnings:['Mean excursions are historical averages, not probability boundaries.']};}
function harness(t,{market='CL',response=intent(),fetcher,stored,loading=false,result}={}){
 const dom=new JSDOM('<!doctype html><html data-startup="'+(loading?'loading':'ready')+'"><body><select id="asof"><option value="03:00">03</option><option value="05:00">05</option></select><button id="analyze-btn" '+(loading?'disabled':'')+'>Forecast</button><input id="manual-input" value="777"></body></html>',{url:'https://wanhotrading.github.io/sessionpath/?instrument='+market,pretendToBeVisual:true});
 const {document:doc}=dom.window,state={calls:[],requests:[],navigation:[],clipboard:[]};
 if(stored)dom.window.sessionStorage.setItem(KEY,JSON.stringify(stored));
 Object.defineProperty(dom.window.navigator,'clipboard',{value:{writeText:async value=>state.clipboard.push(value)}});
 doc.addEventListener('sessionpath:assistant-request',event=>{state.requests.push(event.detail);if(result===false)return;doc.dispatchEvent(new dom.window.CustomEvent('sessionpath:assistant-result',{detail:typeof result==='function'?result(event.detail):fixture(event.detail)}));});
 const ui=mountAssistantChat({instrument:{id:market},document:doc,requestTimeout:100,rootURL:new URL('https://wanhotrading.github.io/sessionpath/'),fetchImpl:async(url,options)=>{state.calls.push({url,options});return fetcher?fetcher(url,options):Response.json(response);},navigate:url=>state.navigation.push(url)});
 t.after(()=>{ui.destroy();dom.window.close();});return {dom,doc,state,ui};
}

test('forecast requests use the model adapter, exact code and counts without altering manual inputs directly',async t=>{
 const h=harness(t);await h.ui.submit('CL 03-05');assert.equal(h.state.calls.length,1);assert.equal(h.state.calls[0].options.credentials,'omit');assert.deepEqual(JSON.parse(h.state.calls[0].options.body),{message:'CL 03-05',context:{market:'CL',window:'03:00-05:00'}});assert.equal(h.state.requests.length,1);assert.equal(h.doc.querySelector('textarea').value,'SP6|exact|model|code');assert.match(h.ui.element.textContent,/42\.0% · 42\/100/);assert.match(h.ui.element.textContent,/not trade win rates/);assert.equal(h.doc.querySelector('#manual-input').value,'777');assert.equal(h.doc.querySelector('.sp-chat-send').disabled,false);
});
test('copy uses the exact generated code and errors retain recovery controls',async t=>{
 const h=harness(t);await h.ui.submit('CL 03-05');h.doc.querySelector('.sp-chat-copy').click();await tick();assert.deepEqual(h.state.clipboard,['SP6|exact|model|code']);assert.equal(h.doc.querySelector('.sp-chat-copy-feedback').hidden,false);
 const e=harness(t,{result:request=>({schema:'sessionpath.assistant.forecast.v1',ok:false,...request,error:{code:'REPLAY_ACTIVE',message:'Turn Replay off before requesting today’s live forecast.'}})});await e.ui.submit('CL 03-05');assert.match(e.ui.element.textContent,/Turn Replay off/);assert.ok(e.doc.querySelector('.sp-chat-retry'));assert.equal(e.doc.querySelector('textarea'),null);
});
test('untrusted user, service and stored strings remain text; model prose cannot supply numbers',async t=>{
 const h=harness(t,{response:intent({action:'explain',concept:'mean_box',message:'<img src=x onerror="evil()"> guaranteed 99.9%'})});await h.ui.submit('<img src=x onerror="evil()">');assert.equal(h.doc.querySelector('img'),null);assert.match(h.ui.element.textContent,/<img/);assert.doesNotMatch(h.ui.element.textContent,/guaranteed 99\.9/);assert.match(h.ui.element.textContent,/not guaranteed boundaries/);
 assert.equal(validateChatIntent(intent({market:'<script>'})),null);assert.equal(validateChatIntent(intent({action:'execute'})),null);
});
test('double submits are blocked and a late result after pagehide cannot render',async t=>{
 let release;const h=harness(t,{fetcher:()=>new Promise(resolve=>release=resolve)});const first=h.ui.submit('CL 03-05');await h.ui.submit('NQ 03-05');assert.equal(h.state.calls.length,1);assert.equal(h.doc.querySelector('.sp-chat-send').disabled,true);h.dom.window.dispatchEvent(new h.dom.window.Event('pagehide'));release(Response.json(intent()));await first;assert.equal(h.doc.getElementById('sessionpath-assistant'),null);assert.equal(h.state.requests.length,0);
});
test('cross-market continuation has a canonical route, no review parameters, and resumes only once',async t=>{
 const h=harness(t,{response:intent({market:'ES'})});await h.ui.submit('ES 03-05');assert.deepEqual(h.state.navigation,['https://wanhotrading.github.io/sessionpath/es/?instrument=ES']);assert.equal(h.state.requests.length,0);const saved=JSON.parse(h.dom.window.sessionStorage.getItem(KEY));assert.equal(saved.pending.intent.market,'ES');assert.equal(saved.messages.filter(m=>m.role==='user').length,1);
 const next=harness(t,{market:'ES',stored:saved});await tick();assert.equal(next.state.calls.length,0);assert.equal(next.state.requests.length,1);assert.equal(JSON.parse(next.dom.window.sessionStorage.getItem(KEY)).pending,null);assert.equal(next.doc.querySelectorAll('.sp-chat-user').length,1);
});
test('expired or malformed navigation state cannot auto-run and history is bounded',()=>{
 const storage={getItem:()=>JSON.stringify({messages:[...Array(15)].map(()=>({role:'user',text:'<svg onload=evil()>'})),pending:{intent:intent(),query:'CL 03-05',createdAt:1}})};const state=readChatState(storage,100000);assert.equal(state.messages.length,10);assert.equal(state.pending,null);assert.equal(assistantMarketURL('NQ',new URL('https://wanhotrading.github.io/sessionpath/')),'https://wanhotrading.github.io/sessionpath/?instrument=NQ');
});
test('close and Escape collapse the conversation while keeping the bar accessible',async t=>{
 const h=harness(t);h.doc.querySelector('.sp-chat-input').focus();assert.equal(h.doc.querySelector('.sp-chat-panel').hidden,false);h.doc.querySelector('.sp-chat-close').click();assert.equal(h.doc.querySelector('.sp-chat-panel').hidden,true);assert.equal(h.doc.activeElement,h.doc.querySelector('.sp-chat-mark'));h.doc.querySelector('.sp-chat-mark').click();h.ui.element.dispatchEvent(new h.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(h.doc.querySelector('.sp-chat-panel').hidden,true);
});
test('loading gates adapter requests and service errors never produce an export code',async t=>{
 const h=harness(t,{loading:true});await h.ui.submit('CL 03-05');assert.equal(h.state.requests.length,0);assert.match(h.ui.element.textContent,/still loading/);assert.equal(h.doc.querySelector('textarea'),null);
 const e=harness(t,{fetcher:async()=>Response.json({ok:false,error:{code:'RATE_LIMITED',message:'Daily usage limit reached.'}},{status:429})});await e.ui.submit('CL 03-05');assert.match(e.ui.element.textContent,/Daily usage limit/);assert.equal(e.state.requests.length,0);
});
