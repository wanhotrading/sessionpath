// A personal TradingView transport is independent of the public delayed-data source.
export const PROFILE='continuous-prior10-0930-1600-frozen-before1930-v1';
export const READ_SCHEMA='sessionpath.tradingview.read.v1';
const KEY='sessionpath-personal-read-v1',ENABLED='sessionpath-personal-enabled-v1';
const CUTS=['03:00','05:00','08:30'];
const num=v=>typeof v==='number'&&Number.isFinite(v);
const previousDate=date=>new Date(Date.parse(date+'T12:00:00Z')-86400000).toISOString().slice(0,10);
const previousWeekday=date=>{let d=previousDate(date);while([0,6].includes(new Date(d+'T12:00:00Z').getUTCDay()))d=previousDate(d);return d;};
export function nyClock(now=Date.now()){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
 return {date:`${p.year}-${p.month}-${p.day}`,minute:Number(p.hour)*60+Number(p.minute)};
}
export function checkpointWaitState(body,{market,cutoff='03:00',now=Date.now()}={}){
 const selected=CUTS.includes(cutoff)?cutoff:'03:00',clock=nyClock(now),minute=Number(selected.slice(0,2))*60+Number(selected.slice(3)),due=minute+5;
 const expected=String(Math.floor(due/60)).padStart(2,'0')+':'+String(due%60).padStart(2,'0');
 const p=body?.packet,received=Date.parse(body?.receivedAt),observed=Date.parse(p?.observed_at);
 if(!p||p.market!==market||!Number.isFinite(received)||!Number.isFinite(observed))return {state:'Waiting',code:'NO_MARKET_DATA',message:`No ${market}1! data has reached this connection. Check that its personal sender alert is active.`};
 if(p.session_date!==clock.date||now-received>480000||now-observed>480000)return {state:'Unavailable',code:'STALE_MARKET_DATA',message:`${market}1! has no fresh data for today’s New York session. Check its personal sender alert.`};
 const label=new Date(observed).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hour12:false});
 if(clock.minute<due)return {state:'Connected',code:'CHECKPOINT_PENDING',message:`${market}1! is connected · last bar ${label} NY. The ${selected} checkpoint is expected after ${expected} NY, when its five-minute candle closes. Auto-fill will apply it automatically; keep this page open.`};
 if(observed<now-120000||nyClock(observed).minute<due)return {state:'Connected',code:'AWAITING_CHECKPOINT_DELIVERY',message:`${market}1! is connected · last bar ${label} NY. Waiting for the ${expected} NY update carrying the ${selected} checkpoint. Auto-fill retries automatically.`};
 return {state:'Waiting',code:'CHECKPOINT_INCOMPLETE',message:`${market}1! is sending fresh data, but the ${selected} checkpoint is incomplete. Check the personal sender’s coverage status on TradingView.`};
}
export function validatePersonalRead(body,{market,now=Date.now()}){
 if(body?.schema!==READ_SCHEMA)throw Error('The personal feed returned an unrecognized response.');
 if(body.status==='waiting')return null;
 if(body.status!=='ready')throw Error('TradingView feed is stale. Check that your alert is running.');
 const p=body.packet,clock=nyClock(now),received=Date.parse(body.receivedAt);
 if(!p||p.schema!=='sessionpath.personal.tradingview.v1'||p.market!==market||p.source_symbol!==market+'1!'||p.session_date!==clock.date)throw Error('No matching TradingView snapshot for today’s New York session.');
 if(p.timeframe!=='5'||p.confirmed!==true||p.timezone!=='America/New_York'||p.feed_type!=='continuous_front_contract'||p.backadjustment!=='off'||p.avr_profile!==PROFILE)throw Error('The TradingView sender uses a different data profile. Update the personal sender.');
 const observed=Date.parse(p.observed_at),sent=Date.parse(p.sent_at);
 if(![received,observed,sent].every(Number.isFinite)||received>now+60000||observed>now+60000||sent>now+60000||now-received>480000||now-observed>480000||sent<observed||received<observed-60000)throw Error('TradingView feed is stale or its timestamps are invalid.');
 if(!Array.isArray(p.snapshots)||p.snapshots.length>3||new Set(p.snapshots.map(s=>s.cutoff)).size!==p.snapshots.length)throw Error('TradingView sent invalid checkpoint snapshots.');
 for(const s of p.snapshots){
  const asOf=Date.parse(s.as_of),at=nyClock(asOf),minute=CUTS.includes(s.cutoff)?Number(s.cutoff.slice(0,2))*60+Number(s.cutoff.slice(3)):NaN;
  if(!Number.isFinite(asOf)||asOf%60000!==0||s.ready!==true||at.date!==p.session_date||at.minute!==minute||observed<asOf+300000||s.avr_override!==false||s.avr_count!==10||s.prior_ny_count!==78)throw Error('TradingView checkpoint timing or coverage could not be verified.');
  const tick={CL:.01,NQ:.25,ES:.25,GC:.1}[market];
  if(!['reference_price','open_1930','range_high','range_low','prior_high','prior_low'].every(k=>num(s[k])&&s[k]>0&&s[k]<=1e9&&Math.abs(s[k]/tick-Math.round(s[k]/tick))<.00001)||!num(s.avr)||s.avr<=0||s.prior_high<=s.prior_low||s.range_high<s.range_low||s.range_high<Math.max(s.reference_price,s.open_1930)||s.range_low>Math.min(s.reference_price,s.open_1930))throw Error('TradingView checkpoint prices are incomplete or inconsistent.');
  if(!Array.isArray(s.avr_dates)||s.avr_dates.length!==10||new Set(s.avr_dates).size!==10||s.avr_dates.some((d,i)=>!/^\d{4}-\d{2}-\d{2}$/.test(d)||d>=p.session_date||i>0&&d<=s.avr_dates[i-1])||s.prior_ny_date!==s.avr_dates[9]||s.prior_ny_date!==previousWeekday(p.session_date))throw Error('TradingView AVR does not identify ten prior complete sessions.');
  const frozen=Date.parse(s.avr_frozen_at),anchor=nyClock(frozen);
  if(!Number.isFinite(frozen)||frozen%60000!==0||frozen>=asOf||anchor.minute!==1170||anchor.date!==previousDate(p.session_date))throw Error('TradingView AVR was not frozen at the overnight anchor.');
 }
 return p;
}

export function mainInputPlan(snapshot,units='points'){
 const s=snapshot,m=units==='percent'?100/s.avr:1,q=(s.reference_price-s.prior_low)/(s.prior_high-s.prior_low),position=(s.reference_price-s.range_low)/(s.range_high-s.range_low);
 const location=q<0?'BELOW':q<.25?'Q1':q<.5?'Q2':q<.75?'Q3':q<=1?'Q4':'ABOVE';
 const behavior=['','Higher finish','Lower finish','Trend down then recover','Trend up then fade','Little net change'][s.last_hour_rule]||'';
 return {price:s.reference_price,avr:s.avr,'prior-high':s.prior_high,'prior-low':s.prior_low,open1930:s.open_1930,'range-high':s.range_high,'range-low':s.range_low,up:(s.range_high-s.open_1930)*m,down:(s.open_1930-s.range_low)*m,printed:Number(((s.range_high-s.range_low)/s.avr*100).toFixed(1)),location,behavior,'range-position':Number.isFinite(position)?(.1+.2*Math.min(4,Math.max(0,Math.floor(position*5)))).toFixed(1):''};
}
export function nyInputPlan(s){return {'ny-price':s.reference_price,'ny-avr':s.avr,'ny-range-high':s.range_high,'ny-range-low':s.range_low,'ny-printed':Number(((s.range_high-s.range_low)/s.avr*100).toFixed(1))};}
export function sessionPositions(s,basis='bbox'){
 if(!s.asia_complete||!s.london_complete)return null;
 const result={};
 for(const session of ['asia','london']){
  const close=s[session+'_close'],low=basis==='own'?s[session+'_low']:s.prior_low,high=basis==='own'?s[session+'_high']:s.prior_high;
  if(![close,low,high].every(num)||high<=low)return null;
  result['ny-position-'+session]=100*(close-low)/(high-low);
 }
 return result;
}

export function mountPersonalTradingView({instrument,endpoint,pineURL}){
 const document=globalThis.document,window=document.defaultView;
 const $=id=>document.getElementById(id),form=$('scenario-form');
 if(!form||$('personal-tradingview'))return;
 const sourceOnly=document.querySelector('meta[name="sessionpath-source-mode"]')?.content==='tradingview-only';
 let url;try{url=new URL(endpoint);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error();}catch{return;}
 const box=document.createElement('details');box.id='personal-tradingview';box.className='personal-tradingview';
 box.innerHTML='<summary>TradingView · personal connection <span class="tv-connection-badge">Off</span></summary><div class="tv-connection-body"><div class="tv-connection-controls"><label>Private read key<input type="password" autocomplete="off" spellcheck="false" data-private aria-label="TradingView private read key"></label><button type="button" class="quiet tv-connect">Connect</button><button type="button" class="text-button tv-disconnect">Disconnect</button><label class="inline-check"><input type="checkbox" class="tv-follow" checked> Follow latest checkpoint</label></div><p class="tv-connection-status" role="status" aria-live="polite">Enter your private read key to connect. It stays in this browser tab’s session.</p><div class="tv-setup-links"><a class="quiet tv-pine" download="SessionPath-personal-TradingView-sender.pine">Download personal sender</a><label>TradingView webhook URL<input type="text" readonly data-private aria-label="TradingView personal webhook URL"></label></div></div>';
 let fillButton=null,fillStatus=null;
 if(sourceOnly){
  const row=document.createElement('div');row.id='personal-auto-fill-row';row.className='context-auto-fill-row planning-auto-fill-row';
  fillButton=document.createElement('button');fillButton.type='button';fillButton.id='personal-auto-fill';fillButton.className='quiet';fillButton.textContent='Auto-fill · TradingView';fillButton.setAttribute('aria-controls',box.id);fillButton.setAttribute('aria-describedby','personal-auto-fill-status');
  fillStatus=document.createElement('p');fillStatus.id='personal-auto-fill-status';fillStatus.className='compact-note';fillStatus.setAttribute('role','status');fillStatus.setAttribute('aria-live','polite');fillStatus.textContent='Connect TradingView; existing inputs have not been refreshed from your chart.';
  row.append(fillButton,fillStatus);const planning=form.querySelector('.planning-bar');if(planning)planning.after(row);else form.prepend(row);
 }
 // Both source controls sit below the selected decision time. Auto-fill may
 // mount asynchronously; relocate once when its row becomes available.
 const place=()=>{const row=form.querySelector('.planning-auto-fill-row')||$('planning-auto-fill-row');if(row){row.after(box);return true;}return false;};
 if(!place()){form.querySelector('.planning-bar')?.after(box);if(!box.isConnected)form.prepend(box);const observer=new window.MutationObserver(()=>{if(place()){observer.disconnect();clearTimeout(expiry);}});observer.observe(form,{childList:true,subtree:true});const expiry=setTimeout(()=>observer.disconnect(),30000);}
 const keyInput=box.querySelector('input[type=password]'),connect=box.querySelector('.tv-connect'),disconnect=box.querySelector('.tv-disconnect'),follow=box.querySelector('.tv-follow'),status=box.querySelector('.tv-connection-status'),badge=box.querySelector('.tv-connection-badge');
 // Connection settings are not model inputs, even while displayed in its form.
 box.addEventListener('input',e=>e.stopPropagation());
 box.addEventListener('change',e=>e.stopPropagation());
 const positionLabel=document.createElement('label');positionLabel.className='inline-check';
 const autoPositions=document.createElement('input');autoPositions.type='checkbox';
 positionLabel.append(autoPositions,document.createTextNode('Apply NY position filters automatically'));box.querySelector('.tv-connection-controls').append(positionLabel);
 box.querySelector('.tv-pine').href=pineURL;box.querySelector('input[readonly]').value=url.href.replace(/\/$/,'')+'/webhook';
 let active=false,busy=false,controller=null,timer=null,appliedMain='',appliedNY='',applying=false,sequence=0;
 try{keyInput.value=sessionStorage.getItem(KEY)||'';}catch{}
 function say(message,state){status.textContent=message;if(fillStatus)fillStatus.textContent=message;badge.textContent=state;box.dataset.state=state.toLowerCase();}
 function setBusy(value){if(sourceOnly){fillButton.disabled=value;connect.disabled=value;}}
 function mountPrivateNotes(){
  if(!sourceOnly)return true;
  let count=0;
  for(const [id,parent]of [['ny-util-autofill-status','util-direction-context'],['ny-close-autofill-status','ny-close-archive']]){
   const host=$(parent);if(!host)continue;
   let note=$(id);if(!note){note=document.createElement('p');note.id=id;note.className='compact-note ny-direction-autofill-status';note.setAttribute('role','status');const summary=host.querySelector('summary');if(summary)summary.after(note);else host.prepend(note);}
   if(!note.textContent||/08:30\s+Auto-fill/.test(note.textContent))note.textContent='Not updated by this personal feed: NY close counts and U/D utilization need manual review. Existing direction entries were kept.';
   count++;
  }
  const positionNote=$('ny-position-status');
  if(positionNote&&/Auto-fill\s*·?\s*08:30\s+below/i.test(positionNote.textContent))positionNote.textContent='Connect TradingView to fill completed 08:30 session positions. Quarter filters stay unchanged unless you choose Apply Exact / Wide or explicitly enable automatic position filters.';
  return count===2&&Boolean(positionNote);
 }
 let notesObserver=null,notesExpiry=null;
 if(sourceOnly&&!mountPrivateNotes()){notesObserver=new window.MutationObserver(()=>{if(mountPrivateNotes()){notesObserver.disconnect();clearTimeout(notesExpiry);}});notesObserver.observe(document.body,{childList:true,subtree:true});notesExpiry=setTimeout(()=>notesObserver.disconnect(),30000);}
 let bellContext,feedbackFade,feedbackHide;
 const highlightTimers=new Map();
 const feedbackPopup=document.createElement('div');feedbackPopup.id='personal-auto-fill-popup';feedbackPopup.className='auto-fill-popup';feedbackPopup.hidden=true;feedbackPopup.setAttribute('role','status');feedbackPopup.setAttribute('aria-live','polite');document.body.append(feedbackPopup);
 function prepareBell(){
  // Unlock the original bell during the button gesture, before the data request.
  try{const AudioContext=window.AudioContext||window.webkitAudioContext;if(!AudioContext)return;if(!bellContext||bellContext.state==='closed')bellContext=new AudioContext();if(bellContext.state==='suspended')bellContext.resume().catch(()=>{});}catch{}
 }
 function playBell(){
  if(!bellContext||bellContext.state!=='running')return;
  try{
   const start=bellContext.currentTime,output=bellContext.createGain();
   output.gain.setValueAtTime(0,start);output.gain.linearRampToValueAtTime(.035,start+.015);output.gain.exponentialRampToValueAtTime(.0001,start+1.95);output.gain.linearRampToValueAtTime(0,start+2);output.connect(bellContext.destination);
   const partials=[[880,1],[2376,.24],[3520,.08]];let remaining=partials.length;
   for(const [frequency,volume]of partials){const oscillator=bellContext.createOscillator(),gain=bellContext.createGain();oscillator.type='sine';oscillator.frequency.value=frequency;gain.gain.value=volume;oscillator.connect(gain);gain.connect(output);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();if(!--remaining)output.disconnect();};oscillator.start(start);oscillator.stop(start+2.02);}
  }catch{/* Audio never blocks a successful input fill. */}
 }
 function completeFill(updated){
  const targets=[...new Set(updated)];if(!targets.length)return;
  for(const input of targets){clearTimeout(highlightTimers.get(input));input.classList.remove('auto-fill-updated');}
  void targets[0].offsetWidth;
  for(const input of targets){input.classList.add('auto-fill-updated');highlightTimers.set(input,setTimeout(()=>{input.classList.remove('auto-fill-updated');highlightTimers.delete(input);},2050));}
  playBell();
  clearTimeout(feedbackFade);clearTimeout(feedbackHide);feedbackPopup.textContent=`Done! ${instrument.id} · ${targets.length} fields filled`;feedbackPopup.hidden=false;feedbackPopup.classList.remove('auto-fill-fade');
  feedbackFade=setTimeout(()=>feedbackPopup.classList.add('auto-fill-fade'),1300);feedbackHide=setTimeout(()=>{feedbackPopup.hidden=true;feedbackPopup.textContent='';},1500);
 }
 function resetApplied(){appliedMain='';appliedNY='';}
 function setFields(updates){const targets=[];for(const [id,v]of Object.entries(updates)){const el=$(id);if(el){el.value=typeof v==='number'?String(Number(v.toFixed(8))):String(v);targets.push(el);}}return targets;}
 function pause(message){active=false;sequence++;controller?.abort();clearTimeout(timer);connect.textContent='Resume';try{sessionStorage.removeItem(ENABLED);}catch{}say(message,'Paused');}
 function inputContext(){return [instrument.id,$('asof')?.value,$('trading-date')?.value,$('replay-toggle')?.checked,$('ny-date')?.value,follow.checked].join('|');}
 function apply(packet){
  mountPrivateNotes();
  if($('replay-toggle')?.checked){say('Replay is on. Live input updates are paused. Turn Replay off to resume.','Paused');return;}
  if(document.documentElement.dataset.startup!=='ready'||$('analyze-btn')?.disabled){say('Connected. Waiting for the research data to finish loading.','Waiting');return;}
  const clock=nyClock(),updated=[];
  applying=true;
  try{
   if(follow.checked){const cutoff=clock.minute>=300?'05:00':'03:00';if($('asof').value!==cutoff){$('asof').value=cutoff;resetApplied();}if($('trading-date').value!==clock.date){$('trading-date').value=clock.date;resetApplied();}if($('date-label'))$('date-label').textContent='Today · '+clock.date;}
   if($('trading-date').value!==clock.date){say('Select today’s New York date or enable Follow latest checkpoint.','Waiting');return;}
   const s=packet.snapshots.find(s=>s.cutoff===$('asof').value),ny=packet.snapshots.find(s=>s.cutoff==='08:30');
   if(s){const id=JSON.stringify(s)+'|'+$('ud-units')?.value;if(id!==appliedMain){updated.push(...setFields(mainInputPlan(s,$('ud-units')?.value)));form.requestSubmit();appliedMain=id;}}
   if(ny&&$('ny-price')&&$('ny-avr')&&$('ny-date')?.value===clock.date){const id=JSON.stringify(ny)+'|'+$('ny-basis')?.value+'|'+$('ny-position-mode')?.value+'|'+autoPositions.checked;if(id!==appliedNY){updated.push(...setFields(nyInputPlan(ny)));$('ny-avr').dispatchEvent(new Event('input',{bubbles:true}));const positions=sessionPositions(ny,$('ny-basis')?.value);if(positions){updated.push(...setFields(positions));for(const id of Object.keys(positions))$(id)?.dispatchEvent(new Event('input',{bubbles:true}));if(autoPositions.checked)$('ny-position-apply')?.click();const note=$('ny-position-status');if(note)note.textContent=autoPositions.checked?note.textContent+' · TradingView personal snapshot.':'TradingView positions filled. Quarter filters retained; click Apply Exact / Wide to use these positions.';}for(const id of ['ny-util-autofill-status','ny-close-autofill-status'])if($(id))$(id).textContent='Not updated by this personal feed: NY close counts and U/D utilization need manual review. Existing direction entries were kept.';$('ny-range-low').dispatchEvent(new Event('input',{bubbles:true}));$('ny-range-low').dispatchEvent(new Event('change',{bubbles:true}));appliedNY=id;}}
   const time=new Date(packet.observed_at).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hour12:false});
   const applied=[s?.cutoff,ny&&appliedNY?'08:30 NY':null].filter(Boolean).join(' / ');
   if(!s){const waiting=checkpointWaitState({packet,receivedAt:packet.observed_at},{market:instrument.id,cutoff:$('asof').value});say(waiting.message,waiting.state);}
   else say(`${instrument.id}1! · bar closed ${time} NY · ${applied?'applied '+applied:'waiting for the selected checkpoint'}. Five-minute updates; decision opens stay fixed.`,'Connected');
   completeFill(updated);
  }finally{applying=false;}
 }
 async function read(){
  clearTimeout(timer);if(!active||busy||document.hidden)return;
  const seq=sequence,context=inputContext();busy=true;setBusy(true);controller=new AbortController();const expiry=setTimeout(()=>controller.abort(),10000);
  try{
   const target=new URL('/api/snapshots',url);target.searchParams.set('market',instrument.id);
   const response=await fetch(target,{headers:{Authorization:'Bearer '+keyInput.value.trim()},credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});
   if(response.status===401)throw Error('The private read key is incorrect. Re-enter it and connect again.');
   if(!response.ok)throw Error('The TradingView bridge is unavailable. Your current inputs were kept.');
   const body=await response.json();if(!active||seq!==sequence||context!==inputContext())return;
   const packet=validatePersonalRead(body,{market:instrument.id});
   if(!packet){const cutoff=follow.checked?(nyClock().minute>=300?'05:00':'03:00'):$('asof')?.value,waiting=checkpointWaitState(body,{market:instrument.id,cutoff});say(waiting.message,waiting.state);return;}
   apply(packet);
  }catch(error){if(seq!==sequence||!active)return;const network=error?.name==='TypeError'&&/fetch|network|load/i.test(error.message||'');say(error.name==='AbortError'?'The TradingView bridge timed out. Retrying shortly.':network?'Cannot reach your private TradingView feed. Your existing inputs were kept. Check your connection and try Refresh.':error.message,'Unavailable');}
  finally{clearTimeout(expiry);busy=false;setBusy(false);if(active)timer=setTimeout(read,30000);}
 }
 function start(withSound=false){if(sourceOnly&&busy)return;const key=keyInput.value.trim();if(!/^[a-f0-9]{64}$/.test(key)){say('Enter the 64-character private read key from your connection file.','Off');return;}if(withSound)prepareBell();active=true;sequence++;resetApplied();connect.textContent='Refresh';try{sessionStorage.setItem(KEY,key);sessionStorage.setItem(ENABLED,'true');}catch{}say('Connecting to your private TradingView snapshots…','Waiting');void read();}
 fillButton?.addEventListener('click',()=>{if(busy)return;follow.checked=false;if(!/^[a-f0-9]{64}$/.test(keyInput.value.trim())){box.open=true;say('Enter your private TradingView read key in the connection settings, then choose Auto-fill · TradingView. Existing inputs have not been refreshed from your chart.','Off');keyInput.focus();return;}start(true);});
 connect.addEventListener('click',()=>start(true));
 keyInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();start(true);}});
 disconnect.addEventListener('click',()=>{active=false;sequence++;controller?.abort();clearTimeout(timer);keyInput.value='';connect.textContent='Connect';resetApplied();try{sessionStorage.removeItem(KEY);sessionStorage.removeItem(ENABLED);}catch{}say(sourceOnly?'Disconnected. Use manual inputs or connect TradingView.':'Disconnected. You can use manual inputs or delayed Auto-fill.','Off');});
 keyInput.addEventListener('input',()=>{if(active)pause('Read key changed. Connect again to use it.');});
 const managed=new Set(['price','avr','prior-high','prior-low','open1930','range-high','range-low','up','down','printed','location','range-position','behavior','ny-price','ny-avr','ny-range-high','ny-range-low','ny-printed','ny-position-asia','ny-position-london']);
 const manualEdit=e=>{if(active&&!applying&&e.isTrusted&&managed.has(e.target.id))pause('Paused after your manual edit. Resume to fill from TradingView again.');};
 document.addEventListener('input',manualEdit);document.addEventListener('change',manualEdit);
 document.addEventListener('click',e=>{if(active&&!applying&&e.isTrusted&&e.target.closest?.('#context-auto-fill,#ny-auto-fill,#reset-btn,#ny-clear,#local-review-apply,.checkpoint'))pause('Paused while you use another input source or reset the form. Resume to fill from TradingView.');},true);
 const contextFields=new Set(['asof','trading-date','ny-date','replay-toggle','ny-basis','ny-position-mode','ud-units']);
 document.addEventListener('change',e=>{if(!applying&&contextFields.has(e.target.id)){resetApplied();sequence++;if(active)void read();}});
 follow.addEventListener('change',()=>{resetApplied();sequence++;if(active)void read();});
 autoPositions.addEventListener('change',()=>{appliedNY='';sequence++;if(active)void read();});
 document.addEventListener('visibilitychange',()=>{if(active&&!document.hidden)void read();});
 window.addEventListener('pagehide',()=>{active=false;controller?.abort();clearTimeout(timer);notesObserver?.disconnect();clearTimeout(notesExpiry);clearTimeout(feedbackFade);clearTimeout(feedbackHide);for(const [input,timer]of highlightTimers){clearTimeout(timer);input.classList.remove('auto-fill-updated');}highlightTimers.clear();feedbackPopup.hidden=true;try{bellContext?.close().catch(()=>{});}catch{}});
 try{if(sessionStorage.getItem(ENABLED)==='true'&&keyInput.value)start();}catch{}
}
