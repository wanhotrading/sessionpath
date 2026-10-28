import {instrument,storageKey} from './instrument.mjs';
import {parseForecastCode} from './indicator-v5.mjs';
import {selectEndpointProbability,selectFirstBreachProbability,WINDOW_BOUNDS} from './research-probability-core.mjs';
import {classifyEndpoint,observeFirstBreach,makeResearchCode,parseResearchSnapshot,nyParts} from './research-followup-code.mjs';
import {flashCopyStatus} from './copy-feedback.mjs';

const $=id=>document.getElementById(id),esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pc=x=>Number.isFinite(x)?(100*x).toFixed(1)+'%':'—',clock=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
let request;
const dataset=()=>request??=fetch('data/es/research-probabilities-v1.json?v=es-staging').then(r=>{if(!r.ok)throw Error('Research probabilities could not load. Retry Calculate.');return r.json();}).catch(e=>{request=null;throw e;});
const date=()=>$('trading-date')?.value;
const number=id=>$(id)?.value.trim()===''?null:Number($(id)?.value);
const recordsKey=storageKey('sessionpath-research-forecasts-v1'),logsKey=storageKey('sessionpath-research-readings-v1');
const readJSON=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')||fallback;}catch{return fallback;}};
const writeJSON=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}};
export function recordResearchForecast(code){
 try{const b=parseForecastCode(code),p=nyParts(b.start),e=nyParts(b.end);if(![180,300,510].includes(p.minute)||e.date!==p.date)return;const records=readJSON(recordsKey,{});records[p.date+':'+p.minute]=code;const keys=Object.keys(records).sort();for(const k of keys.slice(0,Math.max(0,keys.length-45)))delete records[k];writeJSON(recordsKey,records);}catch{}
}
function metric(label,x,reason){
 if(!x?.available)return `<article class="research-stat" data-status="unavailable"><span>${label}</span><strong>${reason?.startsWith('Already reached')?'Already reached':'—'}</strong><small>${esc(reason||x?.reason||'No eligible history')}</small></article>`;
 const interval=x.rawInterval?.map(pc).join('–')||'Unavailable';
 return `<article class="research-stat"><span>${label}</span><strong>${pc(x.probability)}</strong><small>Smoothed historical estimate · ${esc(x.reliability.replaceAll('_',' '))}<br>Observed ${x.successes}/${x.n} (${pc(x.raw)})<br>Raw 95% reference interval ${interval}</small></article>`;
}
export function mountResearchFollowup(state){
 if($('research-followup'))return;
 const host=document.createElement('details');host.id='research-followup';host.className='research-followup';
 host.innerHTML=`<summary>Continuation & first breach</summary><p class="compact-note">${instrument.id} · Completed five-minute candles · New York time</p>
 <div class="research-tabs" role="group" aria-label="Research reading"><button id="research-tab-ep" type="button" class="quiet" aria-pressed="true">Next-window continuation</button><button id="research-tab-fb" type="button" class="quiet" aria-pressed="false">After the first breach</button></div>
 <div class="research-row"><label>Trading date <input id="research-date" type="date" readonly></label><span class="research-pill">Earlier dates only</span></div>
 <details class="session-note"><summary>Import the chart observation</summary><label>TradingView research snapshot<textarea id="research-snapshot" rows="2" spellcheck="false" placeholder="SEP1|${instrument.id}|… or SFB1|${instrument.id}|…"></textarea></label><button id="research-import" type="button" class="quiet">Read chart snapshot</button><p class="compact-note">Enable “Write research snapshots to Pine Logs” in the latest indicator, then copy its SEP1 or SFB1 line. The site does not monitor your chart automatically.</p></details>
 <div id="research-ep-form"><div class="research-fields"><label>Following window<select id="research-ep-window"><option value="05-0830">05:00 → 08:30</option><option value="0830-1600">08:30 → 16:00</option></select></label><label>Completed endpoint close<input id="research-ep-close" type="number" step="any" placeholder="Last candle close"></label></div>
 <div class="research-fields"><label>Frozen high since 19:30<input id="research-ep-high" type="number" step="any"></label><label>Frozen low since 19:30<input id="research-ep-low" type="number" step="any"></label></div>
 <details class="session-note"><summary>Previous Mean box</summary><label>Previous window’s forecast code<textarea id="research-ep-source" rows="2" spellcheck="false" placeholder="The 03:00 or 05:00 forecast code"></textarea></label><div class="research-fields"><label>Previous Mean U extreme<input id="research-ep-upper" type="number" step="any"></label><label>Previous Mean D extreme<input id="research-ep-lower" type="number" step="any"></label></div><button id="research-ep-decode" type="button" class="quiet">Read previous box code</button></details>
 <div class="research-copy-row"><button id="research-ep-fill" type="button" class="quiet">Use current range inputs</button></div><label class="research-check"><input id="research-ep-confirm" type="checkbox">The close and running high/low are frozen at 05:00 or 08:30, before the following candle opens.</label>
 <p class="research-scope">Uses the previous box’s final candle close, not the following window’s opening price. A strict new high or low can be just one tick; both sides may break.</p></div>
 <div id="research-fb-form" hidden><div class="research-fields"><label>Mean box window<select id="research-fb-window"><option value="03-05">03:00 → 05:00</option><option value="05-0830">05:00 → 08:30</option><option value="0830-1600">08:30 → 16:00</option></select></label><label>Breach candle completed at<input id="research-fb-time" type="time" step="300" value="03:30"></label></div>
 <details class="session-note"><summary>Imported Mean box</summary><label>That window’s forecast code<textarea id="research-fb-source" rows="2" spellcheck="false"></textarea></label><div class="research-fields"><label>Mean U extreme<input id="research-fb-upper" type="number" step="any"></label><label>Mean D extreme<input id="research-fb-lower" type="number" step="any"></label></div><button id="research-fb-decode" type="button" class="quiet">Read box code</button></details>
 <div class="research-fields"><label>Breach candle high<input id="research-fb-high" type="number" step="any"></label><label>Breach candle low<input id="research-fb-low" type="number" step="any"></label><label>Breach candle close<input id="research-fb-close" type="number" step="any"></label></div>
 <label class="research-check"><input id="research-fb-confirm" type="checkbox">This is the first strict high/low breach of either side in this window; the five-minute candle has finished.</label>
 <details class="session-note"><summary>Experimental closing-overshoot adjustment</summary><label class="research-check"><input id="research-fb-experimental" type="checkbox">Apply closing distance in 10% full-box-width bands to the 20-minute return estimate.</label><p class="compact-note">Research-only: this adjustment did not pass the full multiple-test screen. It is off by default.</p></details>
 <p class="research-scope">Later candles reach extension targets; later completed closes establish a return. Already-touched targets are marked separately. Fewer than four remaining candles cannot supply a full 20-minute return probability.</p></div>
 <div class="research-copy-row"><button id="research-calculate" type="button" class="primary">Calculate reading</button><button id="research-reset" type="button" class="quiet">Clear observation</button></div>
 <div id="research-error" class="research-error" role="alert"></div><div id="research-results" aria-live="polite"></div>
 <div class="research-transfer" id="research-transfer" hidden><label>TradingView research code<textarea id="research-code" rows="2" readonly spellcheck="false"></textarea></label><div class="research-copy-row"><button id="research-copy" type="button" class="quiet">Copy research code</button><button id="research-save" type="button" class="quiet">Save reading</button><button id="research-export" type="button" class="quiet">Export saved readings</button><span id="research-copy-status" role="status"></span></div><p id="research-destination" class="compact-note"></p><p id="research-log-status" class="research-log-status" role="status"></p></div>`;
 $('projection').insertBefore(host,$('indicator-section'));
 let mode='EP',revision=0,current=null;
 const invalidate=()=>{revision++;current=null;$('research-error').textContent='';$('research-results').replaceChildren();$('research-code').value='';$('research-transfer').hidden=true;};
 const syncDate=()=>{const changed=$('research-date').value!==date();$('research-date').value=date();if(changed){for(const x of host.querySelectorAll('input:not(#research-date),textarea')){if(x.type==='checkbox')x.checked=false;else if(x.type!=='time')x.value='';}invalidate();}};
 const setMode=kind=>{mode=kind;for(const k of ['ep','fb']){$('research-'+k+'-form').hidden=k!==kind.toLowerCase();$('research-tab-'+k).setAttribute('aria-pressed',String(k===kind.toLowerCase()));}invalidate();};
 const assign=(id,v)=>{$(id).value=v==null?'':String(v);};
 function useSaved(which){
  const w=$('research-'+which+'-window').value,bounds=WINDOW_BOUNDS[w],minute=which==='ep'?(bounds[0]===300?180:300):bounds[0],code=readJSON(recordsKey,{})[date()+':'+minute];
  if(!code)return false;assign('research-'+which+'-source',code);decode(which);return true;
 }
 function decode(which){
  const raw=$('research-'+which+'-source').value,b=parseForecastCode(raw),p=nyParts(b.start),e=nyParts(b.end),bounds=WINDOW_BOUNDS[$('research-'+which+'-window').value];
  const expected=which==='ep'?(bounds[0]===300?180:300):bounds[0],expectedEnd=which==='ep'?bounds[0]:bounds[1];
  if(p.date!==date()||p.minute!==expected||e.date!==date()||e.minute!==expectedEnd)throw Error('Use this trading date’s exact '+clock(expected)+' → '+clock(expectedEnd)+' Mean box code.');
  assign('research-'+which+'-upper',b.price+b.up);assign('research-'+which+'-lower',b.price-b.down);invalidate();
 }
 function useRange(){const ny=$('research-ep-window').value==='0830-1600';if(!ny&&state.query?.minute!==300)throw Error('Select the 05:00 plan before copying its frozen range.');for(const s of ['high','low'])assign('research-ep-'+s,$((ny?'ny-range-':'range-')+s)?.value);useSaved('ep');invalidate();}
 const guard=fn=>()=>{try{fn();}catch(e){$('research-error').textContent=e.message;}};
 $('research-tab-ep').onclick=()=>setMode('EP');$('research-tab-fb').onclick=()=>setMode('FB');
 for(const k of ['ep','fb']){$('research-'+k+'-decode').onclick=guard(()=>decode(k));$('research-'+k+'-window').onchange=guard(()=>{invalidate();for(const s of ['upper','lower','source','close','high','low'])if($('research-'+k+'-'+s))assign('research-'+k+'-'+s,'');$('research-'+k+'-confirm').checked=false;if(k==='fb')assign('research-fb-time',clock(WINDOW_BOUNDS[$('research-fb-window').value][0]+30));useSaved(k);});}
 $('research-ep-fill').onclick=guard(useRange);
 host.addEventListener('input',e=>{if(!e.target.readOnly)invalidate();});host.addEventListener('change',e=>{if(e.target.type==='checkbox')invalidate();});
 $('research-reset').onclick=()=>{for(const x of host.querySelectorAll('input:not(#research-date),textarea')){if(x.type==='checkbox')x.checked=false;else if(x.type!=='time')x.value='';}invalidate();};
 $('research-import').onclick=guard(()=>{
  const s=parseResearchSnapshot($('research-snapshot').value,instrument.id);if(s.date!==date())throw Error('The snapshot belongs to '+s.date+'. Select that Replay date first.');
  setMode(s.kind);
  if(s.kind==='EP'){$('research-ep-window').value=s.minute===300?'05-0830':'0830-1600';for(const k of ['close','high','low','upper','lower'])assign('research-ep-'+k,s[k]);$('research-ep-confirm').checked=true;}
  else{$('research-fb-window').value=s.window;assign('research-fb-time',clock(s.minute));for(const k of ['close','high','low','upper','lower'])assign('research-fb-'+k,s[k]);$('research-fb-confirm').checked=true;}
  $('research-error').textContent='Chart snapshot read. Calculate to obtain the historical estimate.';
 });
 $('research-calculate').onclick=async()=>{
  invalidate();const run=revision;syncDate();const d=date();$('research-calculate').disabled=true;$('research-error').textContent='Loading earlier research…';
  try{
   let spec,observation;
   if(mode==='EP'){
    if(!$('research-ep-confirm').checked)throw Error('Confirm the completed endpoint close and frozen range.');
    const window=$('research-ep-window').value,[startMinute,endMinute]=WINDOW_BOUNDS[window],upper=number('research-ep-high'),lower=number('research-ep-low'),close=number('research-ep-close');
    const category=classifyEndpoint(close,number('research-ep-upper'),number('research-ep-lower'));
    if(![upper,lower].every(Number.isFinite)||upper<=lower||close>upper+1e-8||close<lower-1e-8)throw Error('The completed close must lie within the frozen high/low since19:30.');
    spec={market:instrument.id,kind:'EP',date:d,startMinute,endMinute,upper,lower,side:'B',state:category,flags:0};observation={window,state:category};
   }else{
    if(!$('research-fb-confirm').checked)throw Error('Confirm this was the first completed breach candle.');
    const window=$('research-fb-window').value,raw=$('research-fb-time').value;if(!/^\d{2}:\d{2}$/.test(raw))throw Error('Enter a completed five-minute time.');
    const startMinute=Number(raw.slice(0,2))*60+Number(raw.slice(3)),upper=number('research-fb-upper'),lower=number('research-fb-lower'),high=number('research-fb-high'),low=number('research-fb-low'),close=number('research-fb-close');
    observation={window,completionMinute:startMinute,...observeFirstBreach({window,minute:startMinute,upper,lower,high,low,close}),experimentalStrength:$('research-fb-experimental').checked};
    spec={market:instrument.id,kind:'FB',date:d,startMinute,endMinute:WINDOW_BOUNDS[window][1],upper,lower,side:observation.side,state:observation.signalType,flags:(observation.alreadyReached.reach120?1:0)+(observation.alreadyReached.reach130?2:0)+(observation.experimentalStrength?4:0)};
   }
   const now=nyParts(Date.now());if(d>now.date||d===now.date&&spec.startMinute>Math.floor(now.minute/5)*5)throw Error('Wait until this New York five-minute candle has completed, or select an earlier Replay date.');
   const data=await dataset();if(run!==revision||d!==date())return;
   const result=mode==='EP'?selectEndpointProbability(data,{market:instrument.id,asOf:d,...observation}):selectFirstBreachProbability(data,{market:instrument.id,asOf:d,...observation});
   const title=mode==='EP'?(spec.state==='ABOVE_U'?'Previous box closed above U':spec.state==='BELOW_D'?'Previous box closed below D':'Previous box closed inside'):`${observation.side} · ${observation.signalType==='WICK_ONLY'?'Wick outside, closed inside':'Closed outside'} · ${clock(observation.completionMinute)}`;
   const items=mode==='EP'?metric('New running high',result.outcomes.hh)+metric('New running low',result.outcomes.ll)+metric('Both new extremes',result.outcomes.both)+metric('Neither new extreme',result.outcomes.neither):metric('Close back inside within20 minutes',result.outcomes.return20)+metric('Later reach1.20×',result.outcomes.reach120,observation.alreadyReached.reach120?'Already reached in the breach candle':null)+metric('Later reach1.30×',result.outcomes.reach130,observation.alreadyReached.reach130?'Already reached in the breach candle':null);
   const through=result.sample?.trainingThrough||result.sample?.through||Object.values(result.outcomes).map(x=>x.dates?.through).filter(Boolean).sort().at(-1);
   $('research-results').innerHTML=`<div class="research-state">${esc(title)}</div><p class="compact-note">${esc(d)} · ${clock(spec.startMinute)} → ${clock(spec.endMinute)} NY · Training through ${esc(through||'no earlier dates')}</p><div class="research-metrics">${items}</div><p class="research-scope">${mode==='EP'?'Endpoint classification is a useful historical summary. It did not show reliable extra improvement after running position and AVR controls; it does not resize your forecast box.':`Only CL03:00–05:00 1.30× and ES08:30–16:00 1.20× use the supported half-hour adjustment. Other results use the broader side/type baseline. ${observation.signalType==='CLOSE_OUTSIDE'?'Closing overshoot '+observation.strengthPercent.toFixed(1)+'% of full box width.':''}`}</p>${observation.experimentalStrength?'<p class="research-scope research-warning">Experimental closing-strength adjustment enabled.</p>':''}<details class="session-note"><summary>Evidence and scope</summary><p class="compact-note">Large percentages are historical event frequencies, not trade win rates. Displayed estimates blend sparse groups toward the broader history; observed counts and Wilson intervals describe the raw group. Current tags, shapes and custom NY filters do not refit these study references. The NY first-breach reference uses Own Wide Mean. These explored dates are not an untouched live test.</p><p class="compact-note">Forecast geometry comes from your imported box. Price can extend in both directions and reverse. A first-breach probability is frozen at its observation, not updated every minute.</p><a href="research-evidence.html#endpoint" target="_blank" rel="noopener">Endpoint study</a> · <a href="research-evidence.html#first-breach" target="_blank" rel="noopener">First-breach study</a></details>`;
   $('research-error').textContent='';
   const any=Object.values(result.outcomes).some(x=>x.available&&x.n>0);
   if(any&&through&&spec.endMinute>spec.startMinute&&!observation.experimentalStrength){const code=makeResearchCode({...spec,through,outcomes:result.outcomes});$('research-code').value=code;$('research-transfer').hidden=false;$('research-destination').textContent='Latest '+instrument.indicatorLabel+' → Research follow-up → '+(mode==='EP'?'Next-window continuation code':'First-breach follow-up code')+'. The indicator verifies this observation against its candles.';current={savedAt:new Date().toISOString(),...spec,observation,result,code};}
   if(observation.experimentalStrength)$('research-error').textContent='Experimental strength readings are view-only. Turn the adjustment off to export a chart-verified reference.';
  }catch(e){if(run===revision)$('research-error').textContent=e.message;}
  finally{$('research-calculate').disabled=false;}
 };
 $('research-copy').onclick=async()=>{const field=$('research-code');try{await navigator.clipboard.writeText(field.value);flashCopyStatus($('research-copy-status'),'Code copied!');}catch{field.focus();field.select();flashCopyStatus($('research-copy-status'),'Code selected. Press Ctrl+C.',0);}};
 $('research-save').onclick=()=>{if(!current)return;const list=readJSON(logsKey,[]);list.push(current);const ok=writeJSON(logsKey,list.slice(-1000));$('research-log-status').textContent=ok?'Reading saved on this browser. Export it before clearing browser data.':'Browser storage is unavailable; export the current reading instead.';};
 $('research-export').onclick=()=>{const saved=readJSON(logsKey,[]),payload={schemaVersion:1,market:instrument.id,exportedAt:new Date().toISOString(),readings:saved.length?saved:current?[current]:[]},url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='SessionPath-'+instrument.id+'-research-readings.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 for(const id of ['trading-date','replay-date','replay-toggle'])$(id)?.addEventListener('change',syncDate);
 document.addEventListener('sessionpath:forecast-export',e=>{if(e.detail?.code)recordResearchForecast(e.detail.code);});
 host.addEventListener('toggle',()=>{if(host.open){syncDate();if(mode==='EP'&&!$('research-ep-upper').value)try{useSaved('ep');}catch{}}});
 if($('forecast-code')?.value)recordResearchForecast($('forecast-code').value);if($('ny-code')?.value)recordResearchForecast($('ny-code').value);
 syncDate();if(location.hash==='#research-followup')host.open=true;
}
