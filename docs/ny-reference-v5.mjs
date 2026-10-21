import {tint,reveal} from './forecast-motion.mjs';
import {probabilityMarkup as raised} from './probability-finish.mjs';
import {flashCopyStatus} from './copy-feedback.mjs';
import {instrument} from './instrument.mjs';
import {deriveRows,bucket,mean,quantile,wilson,clockLabel} from './window-engine.mjs';
import {shapes} from './planner-v3.mjs';
import {makeForecastCode} from './indicator-v5.mjs';
import {mountNYContext,readNYPrinted,renderForecastContext,renderNYStrength} from './forecast-context.mjs';
import {nyPositionSelection,archivedNYPositions} from './ny-position-helper.mjs';

let positionHelper=null;
// Called by08:30 archive autofill after old NY filters have been cleared.
export function fillNYPositionHelper(day,timeline,knownAt=510){
 if(instrument.id!=='NQ'||!positionHelper)return false;
 return positionHelper.fill(day,timeline,knownAt);
}

// Session positions are built only from bars completed by their own cutoff.
export function sessionPosition(day,source,start,end,basis='bbox') {
 const bars=source[2],from=(start+270)/5,to=(end+270)/5;
 let high=-Infinity,low=Infinity;
 for(let i=from;i<to;i++) {
  const [h,l,c]=bars.slice(i*3,i*3+3);
  if(![h,l,c].every(Number.isFinite)||h<l||c<l||c>h)return null;
  high=Math.max(high,h/100);low=Math.min(low,l/100);
 }
 const close=bars[(to-1)*3+2]/100;
 const bottom=basis==='own'?low:day.priorLow,width=basis==='own'?high-low:day.priorWidth;
 return width>0&&Number.isFinite(bottom)?bucket((close-bottom)/width):null;
}

export function buildNYRows(days,timeline,end=960,basis='bbox') {
 if(![630,960].includes(end)||!['bbox','own'].includes(basis))throw Error('Invalid NY reference definition.');
 const dayMap=new Map(days.map(d=>[d.index,d]));
 return deriveRows(days,timeline,510,end).flatMap(row=>{
  const day=dayMap.get(row.dayIndex);
  // A common complete-session denominator keeps the NY shape and move charts comparable.
  if(!day.phaseComplete?.ASIA||!day.phaseComplete?.LONDON||!day.phaseComplete?.NY)return [];
  const asia=sessionPosition(day,row._source,-270,120,basis),london=sessionPosition(day,row._source,180,510,basis);
  const shape=shapes.find(([id])=>day.phaseTags.includes('NY:'+id))?.[0];
  return asia&&london&&shape?[{day,row,asia,london,shape}]:[];
 });
}

export function nySummary(rows,{asia=[],london=[],year='',asiaShape='',londonShape=''}={}) {
 const cohort=rows.filter(r=>(!year||String(r.day.year)===String(year))&&(!asia.length||asia.includes(r.asia))&&(!london.length||london.includes(r.london))&&(!asiaShape||r.day.phaseTags.includes('ASIA:'+asiaShape))&&(!londonShape||r.day.phaseTags.includes('LONDON:'+londonShape)));
 const n=cohort.length,up=mean(cohort.map(r=>r.row.nextHighAvr)),down=mean(cohort.map(r=>-r.row.nextLowAvr));
 const inside=cohort.filter(r=>r.row.nextHighAvr<=up+1e-9&&-r.row.nextLowAvr<=down+1e-9).length;
 const touchUp=cohort.filter(r=>r.row.nextHighAvr>=up-1e-9).length,touchDown=cohort.filter(r=>-r.row.nextLowAvr>=down-1e-9).length;
 const count=predicate=>cohort.filter(predicate).length;
 return {n,cohort,up,down,inside,extensionUp:mean(cohort.map(r=>r.row.extensionUpAvr)),extensionDown:mean(cohort.map(r=>r.row.extensionDownAvr)),coverage:n?inside/n:null,touchUp:n?touchUp/n:null,touchDown:n?touchDown/n:null,
  upMedian:quantile(cohort.map(r=>r.row.nextHighAvr),.5),downMedian:quantile(cohort.map(r=>-r.row.nextLowAvr),.5),
  highBreak:count(r=>r.row.extensionUpAvr>1e-9),lowBreak:count(r=>r.row.extensionDownAvr>1e-9),
  bins:shapes.map(([id,label])=>{const k=count(r=>r.shape===id);return {id,label,k,p:n?k/n:null,ci:wilson(k,n)};})};
}

const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pc=v=>Number.isFinite(v)?(v*100).toFixed(1)+'%':'—',fmt=v=>Number.isFinite(v)?v.toFixed(2):'—';
const positions=[['BELOW','Below'],['Q1','Q1 · 0–25%'],['Q2','Q2 · 25–50%'],['Q3','Q3 · 50–75%'],['Q4','Q4 · 75–100%'],['ABOVE','Above']];

export function mountNYReference(days,timeline) {
 const host=$('ny-reference');
 host.innerHTML=`<div class="section-heading"><div><div class="eyebrow">06 / NEW YORK</div><h2>New York outlook</h2></div><span class="pill">2022–2026 archive</span></div>
 <div class="ny-controls"><label>Position reference<select id="ny-basis"><option value="bbox">Prior NY BBOX · shared reference</option><option value="own">Each session’s own high–low range</option></select></label><label>From 08:30<select id="ny-end"><option value="960">Through 16:00 · full NY day</option><option value="630">Through 10:30 · includes pre-open</option></select></label><label>Research year<select id="ny-year"><option value="">All years</option>${[2022,2023,2024,2025,2026].map(y=>`<option>${y}</option>`).join('')}</select></label></div>
 <details class="session-note"><summary>Position reference</summary><p id="ny-basis-note" class="field-help"></p></details>
 ${instrument.id==='NQ'?`<details class="session-note" id="ny-position-helper"><summary>Exact / Wide position helper</summary><p class="field-help">Enter each session’s final closing position in the selected range above: 0% is its low, 100% its high. Own uses a different high–low range for Asia and London; Prior uses the same prior NY BBOX for both. Prior permits values below 0% or above 100%.</p><div class="ny-controls"><label>Quarter selection<select id="ny-position-mode"><option value="wide">Wide · include a neighbouring quarter within 5 percentage points</option><option value="exact">Exact · one closing quarter</option></select></label><label>Asia closing position · %<input id="ny-position-asia" type="number" step="any" placeholder="29.77"></label><label>London closing position · %<input id="ny-position-london" type="number" step="any" placeholder="55.96"></label></div><div class="button-row"><button type="button" class="quiet" id="ny-position-apply">Apply Exact / Wide</button><span id="ny-position-status" role="status">08:30 archive autofill can supply both completed-session positions.</span></div><p class="compact-note">Wide expands only today’s selected quarter set near 25%, 50% or 75%. It never broadens the historical labels. Both closes must be known; London finishes at 08:30.</p></details><p id="ny-method" class="compact-note" role="status"></p>`:''}
 <div class="ny-position-grid">${[['asia','Asia · 19:30–02:00'],['london','London · 03:00–08:30']].map(([id,title])=>`<fieldset><legend>${title} NY time</legend><p>Closing position</p><div class="ny-checks">${positions.map(([value,label])=>`<label class="inline-check"><input type="checkbox" id="ny-quarter-${id}-${value}" data-ny-session="${id}" value="${value}">${label}</label>`).join('')}</div><label>Completed shape<select id="ny-${id}-shape"><option value="">Any shape</option>${shapes.map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label></fieldset>`).join('')}</div>
 <div class="ny-controls ny-price-inputs"><label>08:30 open · optional<input id="ny-price" type="number" step="any" placeholder="Optional"></label><label>AVR · points<input id="ny-avr" type="number" min="0.01" step="any" placeholder="AVR"></label><input id="ny-date" type="hidden"><button id="ny-clear" class="quiet" type="button">Clear NY filters</button></div>
 <p class="compact-note">08:30 anchor · this panel uses its own filters.</p>
 <div id="ny-results" aria-live="polite"></div>
 <div class="forecast-transfer"><label>TradingView · NY code<textarea id="ny-code" readonly rows="2" placeholder="Enter 08:30 price and AVR to export for today."></textarea></label><div class="button-row"><button id="ny-copy" class="quiet" disabled>Copy NY forecast code</button><span id="ny-code-status" role="status"></span></div><p class="compact-note">Indicator ${instrument.indicatorLabel} → NY forecast code (08:30). Starts 08:30; ends at your chosen time.</p></div>
 `;
 mountNYContext(host);
 $('ny-date').value=new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'});
 const cache=new Map();
 let appliedPosition=null,archivedPosition=null;
 if(instrument.id==='NQ'){
  const applyPositions=()=>{
   const values=['ny-position-asia','ny-position-london'].map(id=>$(id).value.trim());
   if(values.some(x=>x===''))throw Error('Enter both session closing-position percentages.');
   const selection=nyPositionSelection({asia:Number(values[0])/100,london:Number(values[1])/100,basis:$('ny-basis').value,mode:$('ny-position-mode').value});
   for(const session of ['asia','london'])for(const input of host.querySelectorAll('[data-ny-session="'+session+'"]'))input.checked=selection[session].includes(input.value);
   appliedPosition=selection;
   $('ny-position-status').textContent=selection.method+' applied · Asia '+selection.asia.join(' / ')+' · London '+selection.london.join(' / ')+'.';
   return selection;
  };
  const fill=(day,source,knownAt)=>{
   try{
    const p=archivedNYPositions(day,source,$('ny-basis').value,knownAt);
    archivedPosition={day,source,knownAt};
    // Keep sufficient precision for exact-boundary quarter choices.
    $('ny-position-asia').value=String(100*p.asia);$('ny-position-london').value=String(100*p.london);
    applyPositions();render();return true;
   }catch(e){appliedPosition=null;archivedPosition=null;for(const id of ['ny-position-asia','ny-position-london'])$(id).value='';for(const input of host.querySelectorAll('[data-ny-session]'))input.checked=false;$('ny-position-status').textContent=e.message;render();return false;}
  };
  positionHelper={fill};
  $('ny-position-apply').addEventListener('click',()=>{try{applyPositions();render();}catch(e){appliedPosition=null;$('ny-position-status').textContent=e.message;render();}});
  for(const id of ['ny-position-asia','ny-position-london'])$(id).addEventListener('input',()=>{archivedPosition=null;appliedPosition=null;$('ny-position-status').textContent='Values changed. Apply Exact / Wide to update the quarter filters.';render();});
 }
 function read(){return {asia:[...host.querySelectorAll('[data-ny-session="asia"]:checked')].map(x=>x.value),london:[...host.querySelectorAll('[data-ny-session="london"]:checked')].map(x=>x.value),year:$('ny-year').value,asiaShape:$('ny-asia-shape').value,londonShape:$('ny-london-shape').value};}
 function render(){
  $('ny-date').value=$('trading-date')?.value||$('ny-date').value;
  if(instrument.id==='NQ'&&archivedPosition&&archivedPosition.day.date!==$('ny-date').value){
   archivedPosition=null;appliedPosition=null;
   for(const id of ['ny-position-asia','ny-position-london'])$(id).value='';
   for(const input of host.querySelectorAll('[data-ny-session]'))input.checked=false;
   $('ny-position-status').textContent='Trading date changed. Load its08:30 archive snapshot or enter new session closing positions.';
  }
  const basis=$('ny-basis').value,end=Number($('ny-end').value),key=basis+end;
  if(!cache.has(key))cache.set(key,buildNYRows(days,timeline,end,basis));
  const rows=cache.get(key).filter(r=>r.day.date<($('trading-date')?.value||$('ny-date').value)),filters=read(),s=nySummary(rows,filters),baseline=nySummary(rows,{year:filters.year});
  const rawAvr=$('ny-avr').value,rawPrice=$('ny-price').value,avr=rawAvr!==''?Number(rawAvr):null,price=rawPrice!==''?Number(rawPrice):null;
  renderForecastContext($('ny-forecast-context'),{date:$('ny-date').value,minute:510,endMinute:end,avr,printed:readNYPrinted(),year:$('ny-year').value});renderNYStrength();
  const validAvr=Number.isFinite(avr)&&avr>0,validPrice=Number.isFinite(price),scale=validAvr?avr:1,unit=validAvr?'pt':'× AVR';
  $('ny-basis-note').textContent=basis==='bbox'?'Both closing prices are located inside the SAME prior NY high–low BBOX. Q1 is its bottom quarter; Q4 its top quarter. Below/Above means outside that BBOX. This is not an AVR quartile.':'Asia’s close is ranked inside Asia’s own 19:30–02:00 high–low range; London’s close inside London’s own 03:00–08:30 range. Q1 is the bottom quarter, Q4 the top quarter. These are different ranges, not the overnight or AVR range.';
  for(const input of host.querySelectorAll('[data-ny-session]')){input.disabled=basis==='own'&&['ABOVE','BELOW'].includes(input.value);input.closest('label').classList.toggle('subtle',input.disabled);}
  if(instrument.id==='NQ'){
   const methodMatches=appliedPosition&&appliedPosition.basis===basis&&appliedPosition.mode===$('ny-position-mode').value&&['asia','london'].every(session=>JSON.stringify(filters[session])===JSON.stringify(appliedPosition[session]));
   $('ny-method').textContent=methodMatches?'NY method: '+appliedPosition.method+'. For orange-line reference percentages, select “'+appliedPosition.method+'” in the NQ indicator’s NY Q7 research reference. Additional year/shape filters are not included in that whole-study rate.':'NY method: custom quarter selection. Apply the helper for a named Own/Prior Exact/Wide reference. The indicator’s research reference must match your selected method.';
  }
  $('ny-code').value='';$('ny-copy').disabled=true;$('ny-code-status').textContent='';
  if(!s.n){$('ny-results').innerHTML='<div class="notice">No complete historical cases match these conditions. Clear a position or shape to broaden the sample.</div>';return;}
  const conditions=[filters.asia.length?'Asia '+filters.asia.join(' / '):'',filters.london.length?'London '+filters.london.join(' / '):'',filters.asiaShape?'Asia '+shapes.find(x=>x[0]===filters.asiaShape)[1]:'',filters.londonShape?'London '+shapes.find(x=>x[0]===filters.londonShape)[1]:''].filter(Boolean).join(' + ')||'No position or shape filters';
  const stat=(label,k)=>`<div class="probability-row"><div><span>${label}</span><b>${pc(k/s.n)}</b></div><div class="probability-track"><span style="width:${100*k/s.n}%"></span></div><small>${k} / ${s.n} · 95% interval ${wilson(k,s.n).map(pc).join('–')}</small></div>`;
  $('ny-results').innerHTML=`<p class="ny-cohort"><strong>${s.n.toLocaleString()} matched days</strong> / ${baseline.n.toLocaleString()} eligible in selected years · ${esc(conditions)}</p>${s.n<50?'<div class="notice">Fewer than 50 cases: this slice is thin. Compare the yearly counts and uncertainty intervals before treating its ranking as stable.</div>':''}${rawAvr!==''&&!validAvr?'<div class="notice">Enter a positive AVR to convert the movement into points.</div>':''}
   <div class="movement-grid"><article class="metric"><div class="metric-title">Average upside · 08:30–${clockLabel(end)}</div><div class="metric-value mint">+${fmt(s.up*scale)} <small>${unit}</small></div><div class="metric-sub">Median +${fmt(s.upMedian*scale)} ${unit}<br>${validAvr&&validPrice?`Upper level <b>${fmt(price+s.up*avr)}</b>`:'Add price and AVR to show a price level.'}</div></article><article class="metric"><div class="metric-title">Average downside · 08:30–${clockLabel(end)}</div><div class="metric-value red">−${fmt(s.down*scale)} <small>${unit}</small></div><div class="metric-sub">Median −${fmt(s.downMedian*scale)} ${unit}<br>${validAvr&&validPrice?`Lower level <b>${fmt(price-s.down*avr)}</b>`:'Distances from the 08:30 price.'}</div></article><article class="metric"><div class="metric-title">Stayed within the mean U/D box</div><div class="metric-value">${raised(pc(s.coverage))}</div><div class="metric-sub">${s.inside} / ${s.n} whole paths<br>Upper touch ${raised(pc(s.touchUp))} · lower touch ${raised(pc(s.touchDown))}</div></article></div>
   <details class="session-note"><summary>NY shapes and overnight boundary breaks</summary><div class="ny-chart-grid"><article class="session-card"><h3>NY shapes · 09:30–16:00</h3><p class="field-help">Colored bars: your cohort. Thin markers: the same-year baseline. Hover a row for its 95% interval.</p>${s.bins.map((b,i)=>`<div class="probability-row" title="${esc(b.label)}: ${b.k}/${s.n}. 95% Wilson interval ${b.ci.map(pc).join('–')}. Baseline ${pc(baseline.bins[i].p)}."><div><span>${esc(b.label)}</span><b>${pc(b.p)}</b></div><div class="probability-track"><span style="width:${100*b.p}%"></span><i style="left:${100*(baseline.bins[i].p||0)}%"></i></div><small>${b.k} / ${s.n} · baseline ${pc(baseline.bins[i].p)}</small></div>`).join('')}</article><article class="session-card"><h3>Breaks of the 08:30 overnight range</h3><p class="field-help">19:30–08:30 boundaries, then strict breaches during 08:30–${clockLabel(end)}. These two events can both occur.</p>${stat('Above the 08:30 high',s.highBreak)}${stat('Below the 08:30 low',s.lowBreak)}<p class="field-help">An average excursion is not a range ceiling. Containment and touch frequencies are measured on the same sample used to fit the box; they are not an independently validated probability or trade win rate.</p><p class="field-help">Mean distances are calculated as each day’s movement ÷ its own frozen AVR, then multiplied by your entered AVR. No directional trade or path order is implied by the two averages.</p></article></div>
   </details><details class="session-note"><summary>Annual stability and matching dates</summary><div class="table-wrap"><table><thead><tr><th>Year</th><th>n</th><th>Mean U · × AVR</th><th>Mean D · × AVR</th></tr></thead><tbody>${[2022,2023,2024,2025,2026].map(year=>{const y=nySummary(s.cohort,{year});return `<tr><td>${year}${year===2026?' (partial)':''}</td><td>${y.n}</td><td>${fmt(y.up)}</td><td>${fmt(y.down)}</td></tr>`;}).join('')}</tbody></table></div><p class="field-help">Eligible cases require complete overnight, Asia, London and NY observations. This may exclude more days than the main window estimate. All 2022–2026 data are discovery history, not an untouched forward test. Intervals describe sampling uncertainty and do not correct for searching many filters or serial dependence.</p><p class="ny-dates">${s.cohort.map(r=>esc(r.day.date)).join(' · ')}</p></details>`;

  ['up','down','coverage'].forEach((key,i)=>tint($('ny-results').querySelectorAll('.metric-value')[i],s[key],baseline[key],'Earlier NY history; U/D × AVR, containment 0–1'));
  reveal($('ny-results'),$('ny-results').querySelectorAll('.movement-grid>.metric'),230);
  if(validAvr&&validPrice&&/^\d{4}-\d{2}-\d{2}$/.test($('ny-date').value)) {
   try{$('ny-code').value=makeForecastCode({...s,upPoints:s.up*avr,downPoints:s.down*avr,extensionUpPoints:s.extensionUp*avr,extensionDownPoints:s.extensionDown*avr,upMaxPoints:Math.max(...s.cohort.map(r=>r.row.nextHighAvr))*avr,downMaxPoints:Math.max(...s.cohort.map(r=>-r.row.nextLowAvr))*avr,upMedianPoints:s.upMedian*avr,downMedianPoints:s.downMedian*avr,endMinute:end},{date:$('ny-date').value,minute:510,price,avr,rangeHigh:$('ny-range-high').value===''?null:Number($('ny-range-high').value),rangeLow:$('ny-range-low').value===''?null:Number($('ny-range-low').value)});$('ny-copy').disabled=false;}catch(e){$('ny-code-status').textContent=e.message;}
  }
 }
 host.addEventListener('change',e=>{
  if(e.target.id==='ny-basis'){
   for(const input of host.querySelectorAll('[data-ny-session]'))input.checked=false;
   appliedPosition=null;
   if(instrument.id==='NQ'){
    if(archivedPosition){positionHelper.fill(archivedPosition.day,archivedPosition.source,archivedPosition.knownAt);return;}
    for(const id of ['ny-position-asia','ny-position-london'])$(id).value='';
    $('ny-position-status').textContent='Reference changed. Enter positions measured against this range, then apply.';
   }
  }
  if(instrument.id==='NQ'&&e.target.id==='ny-position-mode'){
   appliedPosition=null;$('ny-position-status').textContent='Selection mode changed. Apply to update both quarter filters.';
  }
  if(instrument.id==='NQ'&&e.target.matches('[data-ny-session]')){appliedPosition=null;$('ny-position-status').textContent='Quarter filters were changed manually. Apply the helper to restore its named method.';}
  render();
 });
 for(const id of ['ny-price','ny-avr','ny-date','ny-range-high','ny-range-low','ny-printed'])$(id).addEventListener('input',render);
 $('ny-clear').addEventListener('click',()=>{for(const input of host.querySelectorAll('[data-ny-session]'))input.checked=false;for(const id of ['ny-year','ny-asia-shape','ny-london-shape','ny-strength-three','ny-strength-five'])$(id).value='';if(instrument.id==='NQ'){appliedPosition=null;archivedPosition=null;for(const id of ['ny-position-asia','ny-position-london'])$(id).value='';$('ny-position-status').textContent='Position filters cleared.';}render();});
 $('ny-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('ny-code').value);flashCopyStatus($('ny-code-status'),'Code copied!');}catch{$('ny-code').focus();$('ny-code').select();flashCopyStatus($('ny-code-status'),'Code selected. Press Ctrl+C.',0);}});
 for(const id of ['trading-date','replay-date','replay-toggle'])$(id)?.addEventListener('change',render);
 render();

}
