import {probabilityMarkup as raised} from './probability-finish.mjs';
import {instrument,assetPath} from './instrument.mjs';
import {bboxReturnStats,returnClock as clock,checkpointMinute,makeBBoxReturnCode} from './bbox-return-core.mjs';
import {flashCopyStatus} from './copy-feedback.mjs';
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pc=x=>raised(x===null?'—':(100*x).toFixed(1)+'%');
let dataPromise,revision=0;
const load=()=>dataPromise??=fetch(assetPath('bbox-return-data.json')).then(r=>{if(!r.ok)throw Error('BBOX history could not be loaded. Try again.');return r.json();}).catch(e=>{dataPromise=null;throw e;});
const options=(from,to,step,selected)=>Array.from({length:(to-from)/step+1},(_,i)=>from+i*step).map(m=>`<option value="${m}" ${m===selected?'selected':''}>${clock(m)}</option>`).join('');
const detail=r=>r.n?`${r.k}/${r.n} dates · 95% interval ${pc(r.lo)}–${pc(r.hi)}`:'No eligible historical dates';
export function mountBBoxReturn(){
 if($('bbox-return'))return;
 const host=document.createElement('section');host.id='bbox-return';host.className='bbox-return panel';
 host.innerHTML=`<div class="section-heading"><h2>BBOX return probability</h2><span class="pill">Mean reference · Q6</span></div>
 <p class="compact-note">Choose the direction, half-hour observation block and deadline. A return means a later five-minute candle closes inside the prior NY BBOX.</p>
 <div class="bbox-return-controls"><label>1 · BBOX direction<select id="br-side"><option value="1">U · above BBOX high</option><option value="-1">D · below BBOX low</option></select></label><label>2 · Observation checkpoint<select id="br-anchor">${Array.from({length:11},(_,i)=>180+i*30).map(m=>`<option value="${m}" ${m===210?'selected':''}>${clock(m)}–${clock(m+29)}</option>`).join('')}</select></label><label>3 · Return by · NY time<select id="br-end">${options(240,510,5,300)}</select></label></div>
 <div class="bbox-return-controls br-context"><label>Observed condition<select id="br-group"><option value="1">Outside BBOX + SessionPath</option><option value="0">Outside BBOX only</option></select></label><label>Observed at · optional<input id="br-observed" type="time" min="03:00" max="08:29" step="60" aria-describedby="br-bucket-note"></label></div>
 <p id="br-bucket-note" class="compact-note" hidden></p>
 <details class="session-note br-update"><summary>Still no return? Update the probability</summary><p class="compact-note">If price has not returned yet, show its chance of returning from now until your deadline.</p><label class="inline-check"><input id="br-survival" type="checkbox"> No completed close has returned since my observation</label><label>Current completed-close time · NY<select id="br-now">${options(240,505,5,300)}</select></label></details>
 <div id="br-result" aria-live="polite"><p class="compact-note">Loading BBOX history…</p></div>
 <div class="br-transfer"><label>TradingView · BBOX return code<textarea id="br-code" readonly rows="2" spellcheck="false" placeholder="A code appears when historical cases match."></textarea></label><div class="button-row"><button type="button" id="br-copy" class="primary" disabled>Copy BBOX return code</button><a href="${instrument.indicatorFile}" download="${instrument.indicatorDownload}" class="quiet">Indicator ${instrument.indicatorLabel}</a><span id="br-copy-status" role="status"></span></div></div>
 <details class="session-note"><summary>Definitions and limits</summary><p>Checkpoints are half-hour blocks of <b>observation times</b>, not exact first-break timestamps. For each date, direction and condition, use the first qualifying completed close in the selected block. An outside state may have begun earlier. Returns count only after that observation; earlier returns are ignored. Each date counts once per selected condition.</p><p>“Both” means the close is also outside the same-side <b>Mean</b> SessionPath boundary. “BBOX only” means it is outside BBOX but not beyond that SessionPath boundary. They are separate observed states; a date can appear in both comparison groups if its state changes within the block.</p><p>The 03:00–05:00 box qualifies closes through 05:00; later closes use the 05:00–08:30 box. At 05:00 the just-completed candle is 04:55–05:00. A 03:00 observation is unavailable for the new 03:00 box; that block starts with the 03:05 close. A wick alone does not qualify or count as a return.</p><p>The session trading date and Archive year filter apply; only earlier dates are counted. Other forecast tags, AVR inputs and nearest-case settings do not filter this study. Full coverage through 08:30 is required for every deadline, keeping the denominator comparable.</p><p>${instrument.id==='NQ'?'NQ reference boxes were fitted using only dates earlier than each historical observation. Sparse early fits remain included.':'These use retrospective reconstructed research boxes.'} They are not a refit to your imported forecast code. Time buckets mix different observation minutes and distances outside BBOX. Intervals are descriptive Wilson intervals; repeated dates across queries and market dependence limit interpretation. No calibrated live probability, causal advantage or trade win rate has been established.</p></details>`;
 $('indicator-section').before(host);
 const syncTimes=()=>{const a=Number($('br-anchor').value),oldEnd=Number($('br-end').value),oldNow=Number($('br-now').value);$('br-end').innerHTML=options(a+30,510,5,Math.max(a+30,oldEnd));$('br-now').innerHTML=options(a+30,505,5,Math.max(a+30,Math.min(505,oldNow)));$('br-survival').disabled=a===480;if(a===480){$('br-survival').checked=false;$('br-now').innerHTML='<option>No later window before 08:30</option>';}};
 $('br-copy').onclick=async()=>{try{await navigator.clipboard.writeText($('br-code').value);flashCopyStatus($('br-copy-status'),'Copied.');}catch{$('br-code').select();flashCopyStatus($('br-copy-status'),'Select the code and copy it manually.',0);}};
 host.addEventListener('change',e=>{if(e.target.id==='br-observed'&&e.target.value){const m=checkpointMinute(e.target.value);if(m===null){revision++;$('br-code').value='';$('br-copy').disabled=true;$('br-copy-status').textContent='';$('br-result').innerHTML='<p class="notice">Choose an observation from 03:00 through 08:29 NY time.</p>';return;}$('br-anchor').value=m;syncTimes();}else if(e.target.id==='br-anchor'){ $('br-observed').value='';syncTimes();}renderBBoxReturn();});
 document.addEventListener('change',e=>{if(['trading-date','year','replay-date','replay-toggle'].includes(e.target.id))queueMicrotask(renderBBoxReturn);});
 $('scenario-form').addEventListener('submit',()=>queueMicrotask(renderBBoxReturn));
 renderBBoxReturn();
}
export async function renderBBoxReturn(){
 const host=$('br-result');if(!host)return;
 const rev=++revision,date=$('trading-date').value,year=$('year').value;
 $('br-code').value='';$('br-copy').disabled=true;$('br-copy-status').textContent='';
 if(!date){host.innerHTML='<p class="compact-note">Uses the trading date in Session inputs.</p>';return;}
 const anchor=Number($('br-anchor').value),end=Number($('br-end').value),side=Number($('br-side').value),group=Number($('br-group').value),now=$('br-survival').checked?Number($('br-now').value):null;
 $('br-now').disabled=now===null;
 host.innerHTML='<p class="compact-note">Matching earlier dates…</p>';
 try{
  const data=await load();if(rev!==revision)return;
  const q={date,year,anchor,now,end,side,group},s=bboxReturnStats(data.days,q),other=bboxReturnStats(data.days,{...q,group:1-group}),r=s.remaining;
  $('br-code').value=makeBBoxReturnCode(q,s,$('br-observed').value);$('br-copy').disabled=!r.n;
  const windowLabel=now===null?`After the observed close → ${clock(end)}`:`After ${clock(now)} → ${clock(end)}, with no earlier return`;
  const compare=(x,g)=>`<tr${g===group?' class="br-selected"':''}><td>${g?'BBOX + SessionPath':'BBOX only'}${g===group?' · selected':''}</td><td>${pc(x.remaining.p)}<small>${detail(x.remaining)}</small></td></tr>`;
  const curves=s.curve.filter(x=>x.minute%30===0||x.minute===end);
  host.innerHTML=`<p class="compact-note">${esc(date)} · ${year?esc(year):'2022–2026'} archive · earlier dates only · ${side===1?'U':'D'} observed in ${clock(anchor)}–${clock(anchor+29)}</p>
   <div class="br-hero"><div><span>${windowLabel}</span><strong>${pc(r.p)}</strong><b>Closed back inside BBOX</b><small>${detail(r)}</small></div><div class="br-denominator"><span>${now===null?'Eligible dates':'Still awaiting a first return'}</span><strong>${r.n}</strong><small>${now===null?'One observation per date in this selected condition':`${s.alreadyReturned} of ${s.original.n} original cases already returned by ${clock(now)} and are excluded`}</small></div></div>
   ${r.n<30?'<p class="notice">'+(r.n?'Small sample: fewer than 30 dates. Treat this percentage cautiously.':'No eligible dates. No substitute group or invented probability is shown.')+'</p>':''}
   ${now!==null?`<p class="compact-note">Original chance by ${clock(end)}, before knowing whether a return had happened: <b>${pc(s.original.p)}</b> (${s.original.k}/${s.original.n}). The large figure above conditions on <b>no return by ${clock(now)}</b>.</p>`:''}
   <div class="br-comparisons"><details class="session-note"><summary>Compare outside conditions</summary><table class="strength-table"><thead><tr><th>Outside state at observation</th><th>Return by ${clock(end)}</th></tr></thead><tbody>${compare(group===1?s:other,1)}${compare(group===0?s:other,0)}</tbody></table></details><div><h3>Return by each deadline</h3><div class="br-bars">${curves.map(x=>`<div><span>${clock(x.minute)}</span><i><em style="width:${100*(x.p||0)}%"></em></i><b>${pc(x.p)}</b></div>`).join('')}</div><p class="compact-note">Cumulative chances from the same ${r.n} eligible dates. These overlapping percentages must not be added.</p></div></div>
   <details class="session-note"><summary>Check consistency by year</summary><table class="strength-table"><thead><tr><th>Year</th><th>Returned / eligible</th><th>95% interval</th></tr></thead><tbody>${s.byYear.filter(x=>x.n).map(x=>`<tr><td>${x.year}</td><td>${pc(x.p)} · ${x.k}/${x.n}</td><td>${pc(x.lo)}–${pc(x.hi)}</td></tr>`).join('')}</tbody></table></details>
   <p class="compact-note">Historical reference frequency, not a trade win rate. Source coverage: ${data.coverage.start}–${data.coverage.end}. <a href="${instrument.id==='NQ'?'#comparison':'seven-studies#s6'}">${instrument.id==='NQ'?'Read NQ model checks':'Read the Q6 research'}</a>.</p>`;
 }catch(e){if(rev===revision)host.innerHTML=`<p class="notice" role="alert">${esc(e.message)}</p>`;}
}
