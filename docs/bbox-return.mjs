import {tint,reveal} from './forecast-motion.mjs';
import {probabilityMarkup as raised} from './probability-finish.mjs';
import {instrument,assetPath} from './instrument.mjs?v=bbox-three-20261023';
import {bboxReturnStats,returnClock as clock,checkpointMinute,makeBBoxReturnCode} from './bbox-return-core.mjs?v=three-states-20261023';
import {curveGeometry,liveMarkerGeometry} from './bbox-curve.mjs?v=live-time-20261023';
import {createOnlineClock} from './ny-online-clock.mjs?v=live-time-20261023';
import {flashCopyStatus} from './copy-feedback.mjs';
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pc=x=>raised(x===null?'—':(100*x).toFixed(1)+'%');
let curvePoints=[],curveEnd=null,curveCurrent=null;
let dataPromise,revision=0,live=false,trackingMinute=null,onlineClock,liveAttempt=0,returnRecorded=false,draft=null;
function rememberInputs(){draft=Object.fromEntries([...$('bbox-return').querySelectorAll('input[id],select[id]')].map(el=>[el.id,el.type==='checkbox'?el.checked:el.value]));}
function restoreDraft(){if(draft)for(const [id,value] of Object.entries(draft)){const el=$(id);if(el.type==='checkbox')el.checked=value;else el.value=value;}}
const groupName=g=>({0:'Opposite + inside SessionPath · combined',1:'Outside both · same direction',2:'Outside both · opposite directions',3:'Outside BBOX · inside SessionPath'}[g]);
const load=()=>dataPromise??=fetch(assetPath('bbox-return-v2.json')).then(r=>{if(!r.ok)throw Error('BBOX history could not be loaded. Try again.');return r.json();}).catch(e=>{dataPromise=null;throw e;});
const options=(from,to,step,selected)=>Array.from({length:(to-from)/step+1},(_,i)=>from+i*step).map(m=>`<option value="${m}" ${m===selected?'selected':''}>${clock(m)}</option>`).join('');
const detail=r=>r.n?`${r.k}/${r.n} dates · 95% interval ${pc(r.lo)}–${pc(r.hi)}`:'No eligible historical dates';
const observedMinute=()=>{const value=$('br-observed').value;if(!value)return null;return Math.floor((Number(value.slice(0,2))*60+Number(value.slice(3)))/5)*5;};
function decayGraph(points,end,current){
 curvePoints=points;curveEnd=end;curveCurrent=current;
 if(!points.length)return '';
 const g=curveGeometry(points,end,current),{x,y,at}=g;
 const delta=at&&Number.isFinite(points[0].p)?100*(at.p-points[0].p):null;
 return `<div class="br-decay" data-live="${live&&!!at}"><div class="br-chart-heading"><h3>Remaining chance of return by ${clock(end)}</h3><span class="br-tracking-state">${live?'Live tracking':current===end?'Window ended':'Observation view'}</span></div><p class="compact-note">Assuming no completed close has returned. The original observation stays fixed.</p><p class="br-current-reading">${at?`<b>${pc(at.p)} now</b>${delta!==null?`<span>${delta>0?'+':''}${delta.toFixed(1)} pp from ${clock(points[0].minute)}</span>`:''}<small>Through the ${clock(at.minute)} completed close</small>`:'No eligible historical cases at this time.'}</p><svg viewBox="0 0 640 265" role="img" aria-label="Remaining BBOX return probability by ${clock(end)}. Vertical scale zero to ${Math.round(g.axis.top*100)} percent. Exact five-minute values are in the table below.">${g.axis.ticks.map(p=>`<line x1="62" x2="616" y1="${y(p)}" y2="${y(p)}" class="br-grid"/><text x="49" y="${y(p)+5}" text-anchor="end">${Math.round(100*p)}%</text>`).join('')}${g.ticks.map(p=>`<text x="${x(p.minute)}" y="247" text-anchor="middle">${clock(p.minute)}</text>`).join('')}<path d="${g.path}" fill="none" stroke="#bda7ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${at?`<g class="br-now-marker"><title>${clock(at.minute)} completed close: ${(at.p*100).toFixed(1)}%. ${live?'Live tracking':'Observation view'}.</title><line x1="${x(at.minute)}" x2="${x(at.minute)}" y1="28" y2="216" class="br-now-guide"/><g transform="translate(${x(at.minute)} ${y(at.p)})"><circle class="br-now-halo" r="7"/><circle class="br-now-ring" r="4"/><circle class="br-now-dot" r="4"/></g></g>`:''}</svg><p class="br-curve-note">The live dot follows NY time. Its percentage holds until the next completed five-minute close; the smooth curve is a visual guide.</p><details><summary>Counts and uncertainty at each five-minute close</summary><div class="br-table-scroll"><table class="strength-table"><thead><tr><th>NY time</th><th>Remaining probability</th><th>Returned / still eligible</th><th>95% interval</th></tr></thead><tbody>${points.map(p=>`<tr><td>${clock(p.minute)}</td><td>${pc(p.p)}</td><td>${p.k}/${p.n}</td><td>${p.minute===end?"Window ended":pc(p.lo)+"–"+pc(p.hi)}</td></tr>`).join('')}</tbody></table></div></details></div>`;
}
function updateTrackingAppearance(){
 const chart=$('br-result')?.querySelector('.br-decay');if(!chart)return;
 chart.dataset.live=String(live&&curvePoints.some(p=>p.minute===curveCurrent&&Number.isFinite(p.p)));
 const label=chart.querySelector('.br-tracking-state');if(label)label.textContent=live?'Live tracking':curveCurrent===curveEnd?'Window ended':'Tracking paused';
}
function stopTracking(message){liveAttempt++;live=false;$('br-live-start').textContent='Start live tracking';$('br-live-note').textContent=message;updateTrackingAppearance();}
function updateClock(){
 const t=onlineClock.read();
 if(!live)return;
 if(!t.online)$('br-live-note').textContent=t.source==='server'?'Clock resync pending; tracking continues from the last online sync.':'Using your device clock in New York time until online sync succeeds.';
 if(t.date!==$('trading-date').value){stopTracking('Trading date differs from the current NY date. Live tracking stopped.');return;}
 const end=Number($('br-end').value),m=Math.min(t.completed,end);
 if(m!==trackingMinute){trackingMinute=m;$('br-now').value=String(m);rememberInputs();renderBBoxReturn({tick:true});}
 updateLiveMarker(t);
 if(t.completed>=end)stopTracking('Deadline reached. This observation is finished.');
}
function updateLiveMarker(t=onlineClock.read()){
 if(!live)return;
 const chart=$('br-result')?.querySelector('.br-decay');if(!chart)return;
 const marker=liveMarkerGeometry(curvePoints,curveEnd,t.completed,t.minute+Number(t.clock.slice(-2))/60);
 if(!marker)return;
 const guide=chart.querySelector('.br-now-guide'),dot=chart.querySelector('.br-now-marker>g');
 if(guide){guide.setAttribute('x1',marker.x);guide.setAttribute('x2',marker.x);}
 if(dot)dot.setAttribute('transform',`translate(${marker.x} ${marker.y})`);
 const reading=chart.querySelector('.br-current-reading small');
 if(reading)reading.textContent=`NY now ${t.clock} · probability through ${clock(marker.completed)} close`;
 const title=chart.querySelector('.br-now-marker title');
 if(title)title.textContent=`NY ${t.clock}: ${(marker.p*100).toFixed(1)}%, using the ${clock(marker.completed)} completed close.`;
}
export function mountBBoxReturn(){
 if($('bbox-return'))return;
 const host=document.createElement('section');host.id='bbox-return';host.className='bbox-return panel';
 host.innerHTML=`<div class="section-heading"><h2>BBOX return probability</h2><span class="pill">Mean reference · Q6</span></div>
 <p class="compact-note">Choose the direction, observation and deadline. A return means a later five-minute candle closes inside the prior NY BBOX.</p>
 <div class="bbox-return-controls"><label>1 · BBOX direction<select id="br-side"><option value="1">U · above BBOX high</option><option value="-1">D · below BBOX low</option></select></label><label>2 · Observation checkpoint<select id="br-anchor">${Array.from({length:11},(_,i)=>180+i*30).map(m=>`<option value="${m}" ${m===210?'selected':''}>${clock(m)}–${clock(m+29)}</option>`).join('')}</select></label><label>3 · Return by · NY time<select id="br-end">${options(240,510,5,300)}</select></label></div>
 <div class="bbox-return-controls br-context"><label>Observed condition<select id="br-group"><option value="1">Outside both · same direction</option><option value="2">Outside both · opposite directions</option><option value="3">Outside BBOX · inside SessionPath</option></select></label><label>Observed at · NY<input id="br-observed" type="time" min="03:00" max="08:29" step="60" aria-describedby="br-bucket-note"></label><label>Observation matching<select id="br-mode"><option value="block">Half-hour block · original study</option><option value="exact">Exact completed five-minute close</option></select></label></div>
 <p class="compact-note">Opposite directions: above BBOX but below the SessionPath lower edge, or below BBOX but above its upper edge. Being within the red/green box still counts as inside SessionPath.</p>
 <p id="br-bucket-note" class="compact-note" hidden></p>
 <label class="inline-check"><input id="br-survival" type="checkbox"> No completed close has returned since my observation</label><details class="session-note br-update"><summary>Manual remaining-time update</summary><label>Current completed-close time · NY<select id="br-now">${options(240,505,5,300)}</select></label></details>
 <div class="br-live-controls"><div class="button-row"><button type="button" id="br-live-start">Start live tracking</button><button type="button" id="br-returned">Price returned · stop</button></div><p id="br-live-note" class="compact-note" role="status">Confirm no return, then start live tracking. Leave observation time blank to use now. The dot follows NY time; probabilities update at completed five-minute closes. This does not read live prices.</p></div>
 <div id="br-result" aria-live="polite"><p class="compact-note">Loading BBOX history…</p></div>
 <div class="br-transfer"><label>TradingView · BBOX return code<textarea id="br-code" readonly rows="2" spellcheck="false" placeholder="A code appears when historical cases match."></textarea></label><div class="button-row"><button type="button" id="br-copy" class="primary" disabled>Copy BBOX return code</button><a href="${instrument.indicatorFile}" download="${instrument.indicatorDownload}" class="quiet">Indicator ${instrument.indicatorLabel}</a><span id="br-copy-status" role="status"></span></div></div>
 <p class="compact-note">All three conditions require the updated CL v6.9 or NQ v1.3 indicator. Download it above if your chart still uses an older version.</p><details class="session-note"><summary>Definitions and limits</summary><p>Half-hour mode uses the first qualifying completed close per date, side and condition in the block. Exact mode uses only the specified completed close; e.g. an observation at 03:31 uses the 03:30 close. Live mode uses exact matching to avoid including observations later than your signal. Each date counts once in a selected query.</p><p>Same-direction, opposite-direction and inside-SessionPath states are separate. Block comparisons may share dates when a state changes. Classification refers to the observation, not any earlier breach.</p><p>The 03:00–05:00 box qualifies closes through 05:00; later closes use the 05:00–08:30 box. At 05:00 the just-completed candle is 04:55–05:00. The first eligible observation is 03:05. Return requires a later five-minute close inside the entire BBOX, inclusive of edges; a wick alone is insufficient.</p><p>Only dates before the trading date and within the selected Archive year are counted. Other forecast tags, AVR inputs and nearest-case settings do not filter this study. Full forward coverage through 08:30 is required. ${instrument.id==='NQ'?'NQ reference boxes use earlier-date fits.':'CL uses retrospective reconstructed reference boxes.'} These are not a refit to your imported forecast code.</p><p>Live tracking synchronizes with New York time in the background, including daylight saving. Live tracking assumes no return until you stop it; it cannot observe your chart. Historical conditional frequencies and descriptive Wilson intervals are not a calibrated live forecast or trade win rate. <a href="bbox-direction-study.html">Read the direction follow-up and download counts</a>.</p></details>`;
 $('indicator-section').before(host);
 const syncTimes=()=>{const a=Number($('br-anchor').value),exact=$('br-mode').value==='exact',o=observedMinute(),start=exact&&o!==null?o:a+30,firstEnd=exact&&o!==null?o+5:a+30,oldEnd=Number($('br-end').value),oldNow=Number($('br-now').value);$('br-end').innerHTML=options(firstEnd,510,5,Math.max(firstEnd,oldEnd));$('br-now').innerHTML=start<=505?options(start,505,5,Math.max(start,Math.min(505,oldNow))):'<option>No later update before 08:30</option>';$('br-survival').disabled=start>505;if(start>505)$('br-survival').checked=false;};
 $('br-copy').onclick=async()=>{try{await navigator.clipboard.writeText($('br-code').value);flashCopyStatus($('br-copy-status'),'Copied.');}catch{$('br-code').select();flashCopyStatus($('br-copy-status'),'Select the code and copy it manually.',0);}};
 onlineClock=createOnlineClock();
 const syncClock=async()=>{try{await onlineClock.sync();updateClock();}catch{$('br-live-note').textContent='Online clock sync unavailable; tracking continues using the last available clock. Retrying in the background.';updateClock();}};
 $('br-live-start').onclick=async()=>{
  if(live){stopTracking('Live tracking paused at the last completed close.');return;}
  if($('analyze-btn').disabled){$('br-live-note').textContent='Wait for the main research archive to finish loading, then start tracking. Your new inputs are retained.';return;}
  if(!$('br-survival').checked){$('br-live-note').textContent='First confirm “No completed close has returned” above.';return;}
  const attempt=++liveAttempt;
  try{
   try{await onlineClock.sync();}catch{/* Keep the NY clock running; identify the fallback below. */}
   if(attempt!==liveAttempt)return;const t=onlineClock.read();
   if(t.date!==$('trading-date').value)throw Error('Select today’s NY trading date before live tracking. Replay remains available manually.');
   if(!$('br-observed').value)$('br-observed').value=clock(t.completed);
   const observation=observedMinute(),end=Number($('br-end').value);
   if(observation===null||observation<185||observation>505||observation>t.completed||end<=t.completed)throw Error('Use an observation from 03:05–08:25, no later than now, and a future deadline through 08:30.');
   $('br-mode').value='exact';$('br-anchor').value=Math.floor(observation/30)*30;
   syncTimes();returnRecorded=false;trackingMinute=t.completed;$('br-now').value=String(trackingMinute);live=true;rememberInputs();$('br-live-start').textContent='Pause live tracking';$('br-live-note').textContent='Tracking the original observation, assuming no return yet. Click “Price returned · stop” when a completed close returns.';renderBBoxReturn();updateClock();
  }catch(e){if(attempt===liveAttempt)$('br-live-note').textContent=e.message;}
 };
 $('br-returned').onclick=()=>{stopTracking('Return recorded by you. This remaining-chance scenario has ended. Start a new observation for a new event.');returnRecorded=true;trackingMinute=null;$('br-survival').checked=false;rememberInputs();$('br-code').value='';$('br-copy').disabled=true;$('br-result').innerHTML='<p class="notice">Returned · tracking stopped. The prior “still no return” estimate no longer applies.</p>';revision++;};
 setInterval(()=>{if(!document.hidden&&live)updateClock();},1000);
 setInterval(()=>{if(!document.hidden&&live)syncClock();},5*60000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&live){updateClock();syncClock();}});
 host.addEventListener('change',e=>{
  returnRecorded=false;
  // A new deadline or condition re-evaluates the same original observation without freezing the clock.
  if(live&&['br-side','br-group','br-end'].includes(e.target.id)){
   if(Number($('br-end').value)<=onlineClock.read().completed){stopTracking('Choose a future deadline to resume live tracking.');trackingMinute=null;$('br-code').value='';$('br-copy').disabled=true;rememberInputs();renderBBoxReturn();return;}
   rememberInputs();renderBBoxReturn({tick:true});updateClock();return;
  }
  stopTracking('Inputs updated. Review the observation and restart live tracking if needed.');trackingMinute=null;if(e.target.id==='br-observed'&&e.target.value){const m=checkpointMinute(e.target.value);if(m===null){revision++;$('br-code').value='';$('br-copy').disabled=true;$('br-copy-status').textContent='';$('br-result').innerHTML='<p class="notice">Choose an observation from 03:00 through 08:29 NY time.</p>';return;}$('br-anchor').value=m;syncTimes();}else if(e.target.id==='br-anchor'){ $('br-observed').value='';syncTimes();}else if(e.target.id==='br-mode')syncTimes();rememberInputs();renderBBoxReturn();});
 document.addEventListener('change',e=>{if(['trading-date','year','replay-date','replay-toggle'].includes(e.target.id)){returnRecorded=false;stopTracking('Date or archive changed. Review and restart tracking.');trackingMinute=null;queueMicrotask(renderBBoxReturn);}});
 $('scenario-form').addEventListener('submit',()=>queueMicrotask(renderBBoxReturn));
 renderBBoxReturn();
}
export async function renderBBoxReturn({tick=false}={}){
 const host=$('br-result');if(!host)return;
 if(!live&&!$('bbox-return-details')?.open)return;
 restoreDraft();
 const rev=++revision,date=$('trading-date').value,year=$('year').value;
 $('br-code').value='';$('br-copy').disabled=true;$('br-copy-status').textContent='';
 if(returnRecorded){host.innerHTML='<p class="notice">Returned · tracking stopped. Set a new observation and confirm no return to begin again.</p>';return;}
 if(!date){host.innerHTML='<p class="compact-note">Uses the trading date in Session inputs.</p>';return;}
 const anchor=Number($('br-anchor').value),end=Number($('br-end').value),side=Number($('br-side').value),group=Number($('br-group').value),now=trackingMinute??($('br-survival').checked?Number($('br-now').value):null),exact=$('br-mode').value==='exact',observation=exact?observedMinute():null;
 $('br-now').disabled=now===null||live;
 if(!tick)host.innerHTML='<p class="compact-note">Matching earlier dates…</p>';
 try{
  if(!['1','2','3'].includes($('br-group').value))throw Error('Choose one of the three observed conditions. The older combined condition has been removed.');
  if(exact&&observation===null)throw Error('Enter the NY observation time for exact-close matching.');
  const data=await load();if(rev!==revision)return;
  const q={date,year,anchor,now,end,side,group,observation},s=bboxReturnStats(data.days,q),r=s.remaining;
  if(now===null||now<end){$('br-code').value=makeBBoxReturnCode(q,s,exact?clock(observation):$('br-observed').value);$('br-copy').disabled=!$('br-code').value;}
  $('br-code').placeholder=now===end?'Window ended. Choose a new observation.':'No code until historical cases match.';
  const windowLabel=now===null?`After the observed close → ${clock(end)}`:`After ${clock(now)} → ${clock(end)}, with no earlier return`;
  const compare=(x,g)=>`<tr${g===group?' class="br-selected"':''}><td>${groupName(g)}${g===group?' · selected':''}</td><td>${pc(x.remaining.p)}<small>${detail(x.remaining)}</small></td></tr>`;
  const curves=s.curve.filter(x=>x.minute%30===0||x.minute===end);
  host.innerHTML=`<p class="compact-note">${esc(date)} · ${year?esc(year):'2022–2026'} archive · earlier dates only · BBOX ${side===1?'U':'D'} · ${groupName(group)} · ${exact?`exact ${clock(observation)} close`:`block ${clock(anchor)}–${clock(anchor+29)}`}</p>
   <div class="br-hero"><div><span>${now===end?'Deadline reached · no remaining time':windowLabel}</span><strong>${pc(r.p)}</strong><b>Return before ${clock(end)}</b><small>${now===end?'Window ended. This is not a new forecast.':detail(r)}</small></div><div class="br-denominator"><span>${now===null?'Eligible dates':'Still awaiting a first return'}</span><strong>${r.n}</strong><small>${now===null?'One observation per date in this selected condition':`${s.alreadyReturned} of ${s.original.n} original cases already returned by ${clock(now)} and are excluded`}</small></div></div>
   ${r.n<30?'<p class="notice">'+(r.n?'Small sample: fewer than 30 dates. Treat this percentage cautiously.':'No eligible dates. No substitute group or invented probability is shown.')+'</p>':''}
   ${now!==null?`<p class="compact-note">Original chance by ${clock(end)}, before knowing whether a return had happened: <b>${pc(s.original.p)}</b> (${s.original.k}/${s.original.n}). The large figure above conditions on <b>no return by ${clock(now)}</b>.</p>`:''}
   ${decayGraph(s.decay,end,now??(exact?observation:anchor+30))}
   <div class="br-comparisons"><details class="session-note"><summary>Compare the three direction states</summary><table class="strength-table"><thead><tr><th>Outside state at observation</th><th>Return by ${clock(end)}</th></tr></thead><tbody>${[1,2,3].map(g=>compare(g===group?s:bboxReturnStats(data.days,{...q,group:g}),g)).join('')}</tbody></table></details><details><summary>Original cumulative return-by-deadline view</summary><div class="br-bars">${curves.map(x=>`<div><span>${clock(x.minute)}</span><i><em style="width:${100*(x.p||0)}%"></em></i><b>${pc(x.p)}</b></div>`).join('')}</div><p class="compact-note">Cumulative chances from the same ${r.n} eligible dates. These overlapping percentages must not be added.</p></details></div>
   <details class="session-note"><summary>Check consistency by year</summary><table class="strength-table"><thead><tr><th>Year</th><th>Returned / eligible</th><th>95% interval</th></tr></thead><tbody>${s.byYear.filter(x=>x.n).map(x=>`<tr><td>${x.year}</td><td>${pc(x.p)} · ${x.k}/${x.n}</td><td>${pc(x.lo)}–${pc(x.hi)}</td></tr>`).join('')}</tbody></table></details>
   <p class="compact-note">Historical reference frequency, not a trade win rate. Source coverage: ${data.coverage.start}–${data.coverage.end}. <a href="bbox-direction-study.html">Direction follow-up · CL & NQ counts</a>.</p>`;
  const baseline=bboxReturnStats(data.days,{...q,group:null});
  tint(host.querySelector('.br-hero>div>strong'),r.p,baseline.remaining.p,'Same side, checkpoint, deadline and no-return filter; either outside condition, once per date');
  host.querySelectorAll('.br-bars>div>b').forEach((el,i)=>tint(el,curves[i].p,baseline.curve.find(x=>x.minute===curves[i].minute)?.p,'Same checkpoint and deadline; either outside condition'));
  if(live)updateLiveMarker();
  if(!tick)reveal(host,[...host.querySelectorAll('.br-hero>div'),host.querySelector('.br-decay')],250);
 }catch(e){if(rev===revision)host.innerHTML=`<p class="notice" role="alert">${esc(e.message)}</p>`;}
}
