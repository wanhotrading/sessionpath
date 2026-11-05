const MARKETS=['CL','NQ','ES','GC'];
const WINDOWS=['03:00-05:00','05:00-08:30','08:30-16:00'];
const CONCEPTS=['mean_box','containment','avr_expansion','extension'];
const STORAGE='sessionpath-assistant-chat-v1';
const ENDPOINT='https://sessionpath-assistant.jjj-jason2345.workers.dev/api/chat';
const DEFINITIONS={
 mean_box:'The mean box shows average historical upside and downside from the decision open. Its edges are average excursions, not guaranteed boundaries.',
 containment:'Containment is the share of historical full-window paths that stayed inside the fitted mean box. It is different from a final close inside or a return after a breach, and is not a trade win rate.',
 avr_expansion:'Orange boxes show expected additional movement beyond the running high and low since 19:30, scaled by the frozen AVR. Historical averages include zero expansion.',
 extension:'Extensions use the entire SessionPath box width, measured from the opposite extreme. A $89–$91 box has a 1.20× upper level at $91.40. Hit probabilities require the matching breakout definition and time window.'
};
const plain=(value,max=600)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
const abortError=()=>Object.assign(new Error('Request cancelled.'),{name:'AbortError'});
const canonicalDate=value=>{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const stamp=Date.parse(value+'T00:00:00Z');return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===value;
};
const nyDate=now=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now)).map(part=>[part.type,part.value]));return `${p.year}-${p.month}-${p.day}`;};
// Old interpreters can omit date on undated commands. An explicit date request
// must never silently turn into today's live forecast during a staged rollout.
const monthWords='(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const dateMentionPattern=new RegExp('\\b'+monthWords+'\\.?\\s*\\d{1,2}\\b|\\b\\d{1,2}(?:st|nd|rd|th)?\\s*'+monthWords+'\\b|\\b(?:today|yesterday)\\b|\\b\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}\\b|\\b\\d{1,2}\\/\\d{1,2}\\b|\\d{1,2}月|昨天|昨日|今天|今日','iu');
const mentionsDate=query=>dateMentionPattern.test(query);

export function validateChatIntent(value){
 if(!value||value.ok!==true||!['forecast','explain','clarify'].includes(value.action)||!MARKETS.includes(value.market)||!WINDOWS.includes(value.window)||!(value.concept===null||CONCEPTS.includes(value.concept))||!plain(value.message,400)||!['rules','openrouter'].includes(value.interpreter))return null;
 if((value.action==='explain')!==(value.concept!==null))return null;
 const date=value.date??null;if(date!==null&&!canonicalDate(date))return null;
 return {action:value.action,market:value.market,window:value.window,concept:value.concept,date,message:value.message,interpreter:value.interpreter};
}

export function readChatState(storage,now=Date.now()){
 try{
  const raw=storage.getItem(STORAGE);if(!raw||raw.length>16000)return {messages:[],pending:null,lastDate:null};
  const state=JSON.parse(raw),messages=[];
  if(Array.isArray(state.messages))for(const message of state.messages.slice(-10))if(message&&['user','assistant'].includes(message.role)&&plain(message.text,1200))messages.push({role:message.role,text:message.text});
  const p=state.pending,intent=validateChatIntent(p?.intent);
  const pending=p&&intent?.action==='forecast'&&plain(p.query,600)&&Number.isFinite(p.createdAt)&&now-p.createdAt>=0&&now-p.createdAt<=90000?{intent,query:p.query,createdAt:p.createdAt}:null;
  return {messages,pending,lastDate:canonicalDate(state.lastDate)?state.lastDate:null};
 }catch{return {messages:[],pending:null,lastDate:null};}
}

export function assistantMarketURL(market,rootURL=new URL('./',import.meta.url)){
 if(!MARKETS.includes(market))throw new Error('Invalid market.');
 const target=new URL(({ES:'es/',GC:'gc/'}[market]||'./'),rootURL);target.searchParams.set('instrument',market);return target.href;
}

function waitForReady(doc,signal,timeout=30000){
 return new Promise((resolve,reject)=>{
  let timer;const started=Date.now();
  const stop=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);};
  const cancel=()=>{stop();reject(abortError());};
  const check=()=>{if(signal.aborted)return cancel();if(doc.documentElement.dataset.startup==='ready'&&doc.querySelector('#analyze-btn:not(:disabled)')){stop();resolve();}else if(Date.now()-started>=timeout){stop();reject(new Error('SessionPath is still loading. Please try again.'));}else timer=setTimeout(check,500);};
  signal.addEventListener('abort',cancel,{once:true});check();
 });
}

function requestForecast(doc,intent,signal,requestId,timeout=30000){
 return new Promise((resolve,reject)=>{
  let timer;const stop=()=>{clearTimeout(timer);doc.removeEventListener('sessionpath:assistant-result',receive);signal.removeEventListener('abort',cancel);};
  const cancel=()=>{stop();reject(abortError());};
  const receive=event=>{if(event.detail?.requestId!==requestId)return;stop();resolve(event.detail);};
  if(signal.aborted)return cancel();doc.addEventListener('sessionpath:assistant-result',receive);signal.addEventListener('abort',cancel,{once:true});
  timer=setTimeout(()=>{stop();reject(new Error('The forecast took too long. Please try again.'));},timeout);
  doc.dispatchEvent(new doc.defaultView.CustomEvent('sessionpath:assistant-request',{detail:{requestId,market:intent.market,window:intent.window,date:intent.date??null}}));
 });
}

function validForecast(result,intent){
 if(!result||result.schema!=='sessionpath.assistant.forecast.v1'||result.ok!==true||result.market!==intent.market||result.window!==intent.window||!canonicalDate(result.date)||result.timezone!=='America/New_York'||!plain(result.code,12000)||!result.code||!Number.isInteger(result.sampleCount)||result.sampleCount<1)return false;
 if(!result.range||!['upper','lower','upPoints','downPoints'].every(key=>Number.isFinite(result.range[key]))||result.range.upPoints<0||result.range.downPoints<0)return false;
 if(result.probabilities?.units!=='fraction')return false;
 return ['containment','upperTouch','lowerTouch'].every(key=>{const p=result.probabilities[key];return p&&Number.isFinite(p.p)&&p.p>=0&&p.p<=1&&Number.isInteger(p.n)&&p.n===result.sampleCount&&Number.isInteger(p.k)&&p.k>=0&&p.k<=p.n&&Math.abs(p.k/p.n-p.p)<=1/p.n;});
}

export function mountAssistantChat({instrument,document:doc=globalThis.document,fetchImpl=(...args)=>fetch(...args),navigate=url=>doc.defaultView.location.assign(url),storage=doc.defaultView.sessionStorage,rootURL=new URL('./',import.meta.url),requestTimeout=30000,now=()=>Date.now()}={}){
 if(doc.getElementById('sessionpath-assistant')||!MARKETS.includes(instrument?.id))return null;
 const win=doc.defaultView,element=(tag,className,text)=>{const el=doc.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
 const state=readChatState(storage,now()),messages=state.messages;let pending=state.pending,busy=false,controller=null,destroyed=false,lastWindow=WINDOWS[0],lastDate=state.lastDate,copyTimers=new Set();
 const host=element('aside','sp-assistant');host.id='sessionpath-assistant';host.setAttribute('aria-label','SessionPath assistant');
 const viewport=element('div','sp-chat-viewport');viewport.hidden=true;viewport.dataset.state='closed';
 const panel=element('section','sp-chat-panel');panel.id='sp-chat-panel';panel.hidden=true;panel.setAttribute('aria-label','SessionPath conversation');panel.setAttribute('aria-hidden','true');panel.setAttribute('inert','');panel.inert=true;viewport.append(panel);
 const header=element('div','sp-chat-head'),brand=element('strong','','SessionPath');const subtitle=element('span','','Forecast assistant');const close=element('button','sp-chat-close','×');close.type='button';close.setAttribute('aria-label','Close conversation');header.append(brand,subtitle,close);
 const history=element('div','sp-chat-history');history.setAttribute('role','log');history.setAttribute('aria-label','Conversation');history.setAttribute('aria-live','polite');history.setAttribute('aria-relevant','additions');
 const examples=element('div','sp-chat-examples');for(const query of ['CL 03-05','NQ 05-0830','GC 08:30-16:00']){const button=element('button','',query);button.type='button';button.addEventListener('click',()=>{input.value=query;submit(query);});examples.append(button);}
 const status=element('p','sp-chat-status');status.setAttribute('role','status');
 panel.append(header,history,examples,status);
 const form=element('form','sp-chat-composer');form.noValidate=true;form.tabIndex=-1;const toggle=element('button','sp-chat-mark','SP');toggle.type='button';toggle.setAttribute('aria-label','Open conversation');toggle.setAttribute('aria-controls',panel.id);toggle.setAttribute('aria-expanded','false');
 const input=element('input','sp-chat-input');input.type='text';input.placeholder='Ask SessionPath · CL, 03–05 range';input.maxLength=600;input.setAttribute('aria-label','Ask SessionPath');input.autocomplete='off';
 const send=element('button','sp-chat-send','Send');send.type='submit';form.append(toggle,input,send);host.append(viewport,form);doc.body.append(host);
 const save=()=>{try{storage.setItem(STORAGE,JSON.stringify({messages:messages.slice(-10),pending,lastDate}));}catch{}};
 const reducedMotion=win.matchMedia?.('(prefers-reduced-motion: reduce)');let motionTimer=null;
 const motionOff=()=>reducedMotion?.matches||doc.body.classList.contains('motion-paused');
 function finishMotion(){
  clearTimeout(motionTimer);motionTimer=null;
  if(viewport.dataset.state==='closing'){viewport.dataset.state='closed';panel.hidden=true;viewport.hidden=true;}
  else if(viewport.dataset.state==='opening')viewport.dataset.state='open';
 }
 const open=()=>{
  if(destroyed||['open','opening'].includes(viewport.dataset.state))return;
  clearTimeout(motionTimer);panel.hidden=false;viewport.hidden=false;panel.inert=false;panel.removeAttribute('inert');panel.setAttribute('aria-hidden','false');toggle.setAttribute('aria-expanded','true');
  // Flush only the initial resting frame. Subsequent frames are handled by
  // compositor transforms; no measurements or DOM updates run per frame.
  if(viewport.dataset.state==='closed'&&!motionOff())panel.getBoundingClientRect();
  viewport.dataset.state='opening';if(motionOff())finishMotion();else motionTimer=setTimeout(finishMotion,1000);
 };
 const collapse=()=>{
  if(destroyed||['closed','closing'].includes(viewport.dataset.state))return;
  clearTimeout(motionTimer);toggle.setAttribute('aria-expanded','false');panel.inert=true;panel.setAttribute('inert','');panel.setAttribute('aria-hidden','true');
  // The composer remains in place. Return focus to the form without focusing
  // the input (which would immediately open the conversation again).
  form.focus({preventScroll:true});viewport.dataset.state='closing';if(motionOff())finishMotion();else motionTimer=setTimeout(finishMotion,1000);
 };
 const finishTransition=event=>{if(event.target===panel&&event.propertyName==='transform')finishMotion();};panel.addEventListener('transitionend',finishTransition);
 const finishPausedMotion=()=>{if(motionOff())finishMotion();};reducedMotion?.addEventListener?.('change',finishPausedMotion);
 const motionObserver=new win.MutationObserver(finishPausedMotion);motionObserver.observe(doc.body,{attributes:true,attributeFilter:['class']});
 const scroll=()=>{history.scrollTop=history.scrollHeight;};
 function bubble(role,text,{remember=true}={}){const item=element('div','sp-chat-message sp-chat-'+role);item.append(element('p','',text));history.append(item);if(remember){messages.push({role,text:text.slice(0,1200)});while(messages.length>10)messages.shift();save();}while(history.children.length>10)history.firstElementChild.remove();scroll();return item;}
 for(const message of messages)bubble(message.role,message.text,{remember:false});
 function setBusy(value,text=''){busy=value;send.disabled=value;input.readOnly=value;for(const button of examples.children)button.disabled=value;status.textContent=text;host.setAttribute('aria-busy',String(value));}
 function failure(error,query){if(error?.name==='AbortError'||destroyed)return;bubble('assistant',plain(error?.message,400)?error.message:'Failed to fetch. Please try again.');const retry=element('button','sp-chat-retry','Try again');retry.type='button';retry.addEventListener('click',()=>submit(query));history.lastElementChild.append(retry);scroll();}
 function renderForecast(result,intent){
  const fmt=value=>value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}),heading=`${result.market} · ${result.window.replace('-', ' → ')} NY`;
  const mode=result.mode??(result.date===nyDate(now())?'live':'historical');
  const item=bubble('assistant',`${heading}\n${mode==='historical'?'Historical forecast':'Live forecast'} · ${result.date} (New York)\n${result.sampleCount} matching historical dates`);
  const range=element('div','sp-chat-range');for(const [label,points,price,cls]of [['Mean upside',result.range.upPoints,result.range.upper,'sp-chat-up'],['Mean downside',result.range.downPoints,result.range.lower,'sp-chat-down']]){const metric=element('div',cls);metric.append(element('span','',label),element('strong','',`${fmt(points)} pt`),element('small','',`${fmt(price)} boundary`));range.append(metric);}item.append(range);
  const probabilities=element('dl','sp-chat-probabilities');for(const [key,label]of [['containment','Stayed inside'],['upperTouch','Upper touch'],['lowerTouch','Lower touch']]){const probability=result.probabilities[key],row=element('div','');row.append(element('dt','',label),element('dd','',`${(probability.p*100).toFixed(1)}% · ${probability.k}/${probability.n}`));probabilities.append(row);}item.append(probabilities);
  item.append(element('p','sp-chat-note','Stayed inside = the entire historical window stayed inside its fitted mean box. Touch = reached or exceeded that side. These are fitted historical frequencies, not trade win rates.'));
  if(Number.isFinite(result.range.extensionUpPoints)&&Number.isFinite(result.range.extensionDownPoints))item.append(element('p','sp-chat-note',`Orange added range · upper ${fmt(result.range.extensionUpPoints)} pt / lower ${fmt(result.range.extensionDownPoints)} pt`));
  const source=result.source||{};if(plain(source.symbol,80)&&plain(source.checkpoint,20))item.append(element('p','sp-chat-note',`${source.symbol} · frozen ${source.checkpoint} NY checkpoint`));
  const codeLabel=element('label','sp-chat-code-label','TradingView forecast code');const code=element('textarea','sp-chat-code');code.readOnly=true;code.value=result.code;code.rows=2;code.setAttribute('aria-label',`${result.market} forecast code`);codeLabel.append(code);
  const copy=element('button','sp-chat-copy','Copy code');copy.type='button';const feedback=element('span','sp-chat-copy-feedback','Copied!');feedback.hidden=true;feedback.setAttribute('role','status');
  let copyTimer;copy.addEventListener('click',async()=>{try{await win.navigator.clipboard.writeText(result.code);clearTimeout(copyTimer);copyTimers.delete(copyTimer);feedback.textContent='Copied!';feedback.hidden=false;feedback.classList.remove('sp-chat-faded');copyTimer=setTimeout(()=>{feedback.classList.add('sp-chat-faded');copyTimers.delete(copyTimer);},2000);copyTimers.add(copyTimer);}catch{feedback.textContent='Select and copy the code above.';feedback.hidden=false;code.focus();code.select();}});
  item.append(codeLabel,copy,feedback);for(const warning of Array.isArray(result.warnings)?result.warnings.slice(0,3):[])if(plain(warning,300))item.append(element('p','sp-chat-note',warning));
  const stored=messages[messages.length-1];stored.text+=`\nMean U ${fmt(result.range.upPoints)} pt / D ${fmt(result.range.downPoints)} pt. Containment ${(result.probabilities.containment.p*100).toFixed(1)}%.`;save();scroll();
 }
 async function runForecast(intent,query,signal){
  lastWindow=intent.window;lastDate=intent.date??null;save();
  if(intent.market!==instrument.id){pending={intent:{...intent,ok:true},query,createdAt:now()};save();status.textContent=`Opening ${intent.market}${intent.date?' · '+intent.date:''}…`;navigate(assistantMarketURL(intent.market,rootURL));return;}
  status.textContent=intent.date&&intent.date!==nyDate(now())?`Reading historical inputs for ${intent.date}…`:'Reading the latest TradingView checkpoint…';await waitForReady(doc,signal,requestTimeout);if(signal.aborted)throw abortError();
  const requestId=win.crypto.randomUUID();status.textContent='Calculating your SessionPath forecast…';const result=await requestForecast(doc,intent,signal,requestId,requestTimeout);if(signal.aborted||destroyed)throw abortError();
  if(result?.ok!==true)throw new Error(plain(result?.error?.message,400)?result.error.message:'The forecast is unavailable. Please try again.');
  if(!validForecast(result,intent))throw new Error('The forecast response was incomplete. Please try again.');
  if(intent.date&&result.date!==intent.date)throw new Error(`The forecast does not match ${intent.date}. No code was copied or substituted from another date.`);
  if(result.date>nyDate(now()))throw new Error('That New York trading date has not occurred yet. Choose today or an earlier date.');
  if(!intent.date&&result.date!==nyDate(now()))throw new Error(`Today’s New York checkpoint is unavailable. The received ${result.date} forecast was not substituted.`);
  if(result.mode!==undefined&&!['live','historical'].includes(result.mode))throw new Error('The forecast mode was invalid. Please try again.');
  if(result.mode==='live'&&result.date!==nyDate(now()))throw new Error('The live checkpoint is for a different New York date. Please try again.');
  renderForecast(result,intent);
 }
 async function submit(query=input.value,resumedIntent=null){
  if(busy||destroyed)return;if(!plain(query,600)||!query.trim()){open();status.textContent='Ask for a market and a session, for example CL 03-05.';return;}
  query=query.trim();controller?.abort();controller=new AbortController();const signal=controller.signal;let timedOut=false;open();setBusy(true,'Understanding your request…');if(!resumedIntent)bubble('user',query);input.value='';
  try{
   let intent=resumedIntent;
   if(!intent){
    const cutoff=doc.getElementById('asof')?.value;const contextWindow=lastWindow===WINDOWS[2]?lastWindow:cutoff==='05:00'?WINDOWS[1]:cutoff==='03:00'?WINDOWS[0]:lastWindow;
    // Presence of date (including null) tells the server this client preserves
    // dated intents. Cached pre-date clients must never get a historical intent
    // that they would accidentally execute as today's forecast.
    const context={market:instrument.id,window:contextWindow,date:lastDate??null};
    const timeout=setTimeout(()=>{timedOut=true;controller.abort();},20000);let response;try{response=await fetchImpl(ENDPOINT,{method:'POST',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:query,context}),signal});}finally{clearTimeout(timeout);}
    if(signal.aborted)throw abortError();let body;try{body=await response.json();}catch{throw new Error('The assistant returned an unreadable response. Please try again.');}
    if(!response.ok||body.ok!==true)throw new Error(plain(body?.error?.message,400)?body.error.message:response.status===429?'Usage limit reached. Please try again later.':'The assistant is temporarily unavailable. Please try again.');
    intent=validateChatIntent(body);if(!intent)throw new Error('The assistant could not identify a supported request. Try CL 03-05.');
    if(intent.action==='forecast'&&!Object.hasOwn(body,'date')&&mentionsDate(query))throw new Error('Dated requests are not available from this assistant version yet. Please refresh and try again; today’s code was not substituted.');
   }
   if(intent.action==='forecast')await runForecast(intent,query,signal);
   else if(intent.action==='explain')bubble('assistant',DEFINITIONS[intent.concept]);
   else bubble('assistant',intent.message||'Choose CL, NQ, ES or GC and one window: 03:00–05:00, 05:00–08:30 or 08:30–16:00 NY.');
  }catch(error){failure(timedOut?new Error('The assistant took too long. Please try again.'):error,query);}finally{if(!destroyed)setBusy(false);}
 }
 form.addEventListener('submit',event=>{event.preventDefault();submit();});toggle.addEventListener('click',()=>{open();input.focus();});input.addEventListener('focus',open);input.addEventListener('pointerdown',open);input.addEventListener('input',open);close.addEventListener('click',collapse);host.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();collapse();}});
 function destroy(){destroyed=true;controller?.abort();clearTimeout(motionTimer);motionObserver.disconnect();reducedMotion?.removeEventListener?.('change',finishPausedMotion);for(const timer of copyTimers)clearTimeout(timer);copyTimers.clear();win.removeEventListener('pagehide',destroy);host.remove();}
 win.addEventListener('pagehide',destroy,{once:true});
 if(pending){const continuation=pending;pending=null;save();if(continuation.intent.market===instrument.id)submit(continuation.query,continuation.intent);}
 return {submit,destroy,element:host};
}
