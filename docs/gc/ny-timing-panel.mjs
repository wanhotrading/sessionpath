import {instrument} from './instrument.mjs?v=ny-timing-20261102';
import {parseForecastCode} from './indicator-v5.mjs?v=ny-timing-20261102';
import {appendNYTimingMetadata,makeNYTimingToken} from './ny-timing-code.mjs';
import {clock,timingContext,timingFitEligibility,observationFromFields,projectedLevel,wilsonPercent} from './ny-timing-core.mjs';

const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pc=x=>Number.isFinite(x)?x.toFixed(1)+'%':'—';
const price=x=>Number.isFinite(x)?x.toFixed(2):'—';
const multiple=x=>Number.isFinite(x)?x.toFixed(2)+'×':'—';
const levels=[1.2,1.3,1.4,1.5,1.75,2];
const requiredIndicator={CL:'CL / MCL v7.1',NQ:'NQ / MNQ v1.5',ES:'ES / MES v1.1',GC:'GC / MGC v1.1'};
const reportURL=()=>new URL(['ES','GC'].includes(instrument.id)?'../research/ny-breakout-timing/':'research/ny-breakout-timing/',location.href).href;
let referenceRequest;
function loadReference(){
 return referenceRequest??=Promise.all([
  import('./ny-timing-reference.mjs?v=20261102'),
  fetch(new URL('./ny-timing-'+instrument.id+'.json?v=20261102',import.meta.url)).then(response=>{if(!response.ok)throw Error('Timing reference could not load. Close and reopen this section to retry.');return response.json();})
 ]).then(([core,payload])=>{if(payload.market!==instrument.id||payload.version!==1)throw Error('Timing reference does not match this market.');return {core,payload};}).catch(error=>{referenceRequest=null;throw error;});
}
function loadStyle(){
 if(document.getElementById('ny-timing-style'))return;
 const link=document.createElement('link');link.id='ny-timing-style';link.rel='stylesheet';link.href=new URL('./ny-timing.css?v=20261102',import.meta.url).href;document.head.append(link);
}
function interval(level){const ci=wilsonPercent(level?.hits,level?.n);return ci?'95% reference interval '+ci.map(pc).join('–'):'';}
function miniChart(context,side,reference,target){
 const values=[context.lower,context.upper,projectedLevel(context,side,target),projectedLevel(context,side,reference.medianMultiple),projectedLevel(context,side,reference.p75Multiple)].filter(Number.isFinite);
 if(!values.length)return '';
 const low=Math.min(...values),high=Math.max(...values),padding=(high-low||context.width)*.12;
 const y=value=>144-(value-(low-padding))/(high-low+2*padding)*120;
 const upperY=y(context.upper),lowerY=y(context.lower),targetPrice=projectedLevel(context,side,target);
 const lines=[['Median later extreme',reference.medianMultiple,'median'],['75th percentile',reference.p75Multiple,'p75'],[multiple(target)+' target',target,'target']].filter(([,m])=>Number.isFinite(m));
 return `<svg class="nytim-chart" viewBox="0 0 380 168" role="img" aria-label="Today's Mean box with historical median and seventy-fifth percentile later-extreme levels"><rect x="16" y="${upperY.toFixed(2)}" width="170" height="${Math.max(1,lowerY-upperY).toFixed(2)}" rx="4" class="nytim-box"/><line x1="16" x2="186" y1="${upperY.toFixed(2)}" y2="${upperY.toFixed(2)}" class="nytim-boundary"/><line x1="16" x2="186" y1="${lowerY.toFixed(2)}" y2="${lowerY.toFixed(2)}" class="nytim-boundary"/>${lines.map(([label,m,type],i)=>{const v=projectedLevel(context,side,m),lineY=y(v);return `<line x1="16" x2="186" y1="${lineY.toFixed(2)}" y2="${lineY.toFixed(2)}" class="nytim-line nytim-${type}"/><text x="198" y="${40+i*40}" class="nytim-chart-label">${esc(label)}</text><text x="198" y="${57+i*40}" class="nytim-chart-price nytim-${type}-text">${price(v)}</text>`;}).join('')}<text x="16" y="164" class="nytim-chart-label">Today's imported Mean U/D box</text></svg>`;
}
function referenceCard(label,reference,context,observation,target){
 if(!reference)return `<article class="nytim-card nytim-missing"><h4>${label}</h4><p>No observations in this group. No fallback percentage is substituted.</p></article>`;
 const level=reference.levels.find(x=>Math.abs(x.multiple-target)<1e-9),n=reference.n;
 const pending=level?.n>0;
 const sparse=n<20||pending&&level.n<20;
 const eod=[['inside','Inside Mean box'],['same','Outside · same side'],['opposite','Outside · opposite side']];
 return `<article class="nytim-card${sparse?' nytim-thin':''}"><div class="nytim-card-heading"><h4>${label}</h4><span class="nytim-count">${n} events${sparse?' · thin sample':''}</span></div><p class="nytim-metric-label">Later touch of ${multiple(target)} · if still untouched</p><strong class="nytim-probability">${pending?pc(level.pct):'—'}</strong><small class="nytim-denominator">${pending?level.hits+' / '+level.n+' eligible pending targets · '+interval(level):'No eligible pending targets in this group.'}</small>${sparse?'<p class="nytim-warning">Small historical group; the percentage is unstable.</p>':''}${reference.laterN>0?miniChart(context,observation.side,reference,target):'<p class="nytim-warning">No later candles remain at this confirmation time.</p>'}<div class="nytim-eod-heading">16:00 closing location</div><div class="nytim-eod-track" aria-hidden="true">${eod.map(([key])=>`<i class="nytim-eod-${key}" style="width:${100*reference.eod[key]/n}%"></i>`).join('')}</div><dl class="nytim-eod">${eod.map(([key,text])=>`<div><dt><i class="nytim-eod-${key}"></i>${text}</dt><dd>${pc(100*reference.eod[key]/n)} <small>${reference.eod[key]}/${n}</small></dd></div>`).join('')}</dl><small class="nytim-denominator">Later-extreme levels use ${reference.laterN} events with later candles; pending-target and EOD denominators differ.</small></article>`;
}

export function mountNYTimingPanel(parent,{onExportChange=()=>{}}={}){
 const existing=parent.querySelector('#ny-timing');if(existing)return existing.nyTimingController;
 const host=document.createElement('details');host.id='ny-timing';host.className='session-note ny-timing';
 host.innerHTML=`<summary>After NY breakout · timing & extent</summary><div class="nytim-inner"><div class="nytim-heading"><div><h3>After the first NY breakout</h3><p class="compact-note">Historical reference · method-wide · ${esc(instrument.id)} · 08:30–16:00 NY</p></div><a class="quiet" href="${esc(reportURL())}" target="_blank" rel="noopener">Study ↗</a></div><p id="ny-timing-context" class="compact-note" role="status"></p><div class="nytim-export"><label class="inline-check"><input id="ny-timing-enable" type="checkbox" checked>Include timing reference in NY chart code</label><p class="compact-note">Chart uses its actual first confirmed breakout. The scenario below does not override chart prices or times. Requires ${esc(requiredIndicator[instrument.id])} or newer.</p></div><div class="nytim-controls"><label>First breached side<select id="ny-timing-side"><option value="U">U · upper boundary</option><option value="D">D · lower boundary</option></select></label><label>That candle’s completed close<select id="ny-timing-type"><option value="CLOSE_OUTSIDE">Outside on the breached side</option><option value="WICK_ONLY">Inside / on the Mean box</option></select></label><label>Completed at · NY<input id="ny-timing-time" type="time" value="09:00" min="08:35" max="16:00" step="300"></label><label>Closing overshoot · % of full box<input id="ny-timing-overshoot" type="number" min="0" step="any" value="10" inputmode="decimal"></label><label>Target multiple<select id="ny-timing-target">${levels.map(x=>`<option value="${x}"${x===1.5?' selected':''}>${multiple(x)}</option>`).join('')}</select></label><label>Earlier dates fitting each box<select id="ny-timing-fit"><option value="50">At least 50</option><option value="1">All positive fits · sensitivity</option></select></label></div><p id="ny-timing-observation" class="compact-note"></p><div id="ny-timing-result" aria-live="polite"></div><p class="nytim-footnote compact-note">Time and closing-strength groups are separate references, not combined filters. These exploratory groups did not establish a reliable forecasting improvement; the ordinary probabilities remain available.</p><details class="session-note nytim-definitions"><summary>How to read this</summary><p class="compact-note">Use the first strict wick breach of either Mean boundary, after its five-minute candle has finished. A candle breaching both sides has unknown order and no resolved-side reference. Closing overshoot measures the completed close beyond the breached boundary divided by the full Mean U+D width: 14% uses 10–&lt;20%; 27% uses 20–&lt;30%. Wick-only closes remain a separate group.</p><p class="compact-note">A ${multiple(1.5)} upper target is the lower extreme + 1.50 × full width; a lower target is the upper extreme − 1.50 × full width. Thus a $89–$91 box gives $92 upward or $88 downward. Pending percentages exclude targets touched through confirmation or at the next opening price. Later wick touches count through 16:00. EOD uses the 15:55 candle’s close. These references are fixed at first confirmation, not a live countdown.</p></details></div>`;
 const after=parent.querySelector('#ny-results');after?.after(host);if(!after)parent.append(host);
 const $=id=>host.querySelector('#'+id);
 let context={available:false,reason:'Enter the 08:30 price and AVR, then apply the Exact / Wide position helper.'},rawCode='',signature='',loaded=null,loading=false,error='',chartToken='';
 const baselineButton=document.createElement('button');baselineButton.id='ny-timing-baseline';baselineButton.type='button';baselineButton.className='quiet';baselineButton.textContent='Use Mean box code only';baselineButton.hidden=true;parent.querySelector('#ny-copy')?.after(baselineButton);
 const fitEligibility=()=>timingFitEligibility(context,Number($('ny-timing-fit').value));
 const settings=()=>({enabled:$('ny-timing-enable').checked&&fitEligibility().available,minFit:Number($('ny-timing-fit').value),target:Number($('ny-timing-target').value)});
 function prepareChartToken(){
  chartToken='';if(!settings().enabled||!loaded)return;
  try{chartToken=makeNYTimingToken({payload:loaded.payload,method:context.method,...settings()});}catch(e){error=e.message;}
 }
 function ensureData(){
  if(!fitEligibility().available||(!settings().enabled&&!host.open)||loaded||loading||error)return;
  loading=true;
  loadReference().then(value=>{loaded=value;error='';}).catch(e=>{error=e.message;}).finally(()=>{loading=false;prepareChartToken();render();onExportChange();});
 }
 function render(){
  $('ny-timing-context').textContent=context.available?context.methodLabel+' · '+context.date+' · Mean box '+price(context.lower)+'–'+price(context.upper):context.reason;
  $('ny-timing-enable').disabled=!fitEligibility().available;
  baselineButton.hidden=!(settings().enabled&&error&&!chartToken);
  $('ny-timing-overshoot').disabled=$('ny-timing-type').value==='WICK_ONLY';
  if(!host.open)return;
  const result=$('ny-timing-result');
  if(!context.available){result.innerHTML='<p class="nytim-empty">'+esc(context.reason)+'</p>';$('ny-timing-observation').textContent='';return;}
  if(!fitEligibility().available){result.innerHTML='<p class="nytim-empty">'+esc(fitEligibility().reason)+'</p>';$('ny-timing-observation').textContent='';return;}
  let observation;
  try{observation=observationFromFields({side:$('ny-timing-side').value,type:$('ny-timing-type').value,time:$('ny-timing-time').value,overshoot:$('ny-timing-overshoot').value});}
  catch(e){result.innerHTML='<p class="nytim-empty">'+esc(e.message)+'</p>';$('ny-timing-observation').textContent='';return;}
  const start=Math.floor(observation.signalCloseMinute/30)*30,bin=Math.floor((observation.closeOvershoot*10)+1e-10)*10;
  $('ny-timing-observation').textContent='First strict breach · '+observation.side+' · '+(observation.type==='WICK_ONLY'?'wick-only close':bin+'–<'+(bin+10)+'% closing overshoot')+' · '+(start===960?'16:00 terminal':clock(start)+'–'+clock(start+29)+' confirmation block')+'.';
  if(error){result.innerHTML='<p class="nytim-empty" role="alert">'+esc(error)+'</p>';return;}
  if(!loaded){result.innerHTML='<p class="nytim-empty">Loading this market’s historical timing reference…</p>';ensureData();return;}
  const selection=loaded.core.lookupNYTiming(loaded.payload,{...observation,market:instrument.id,method:context.method,minFit:settings().minFit});
  if(selection.reason&&!selection.timing&&!selection.strength){result.innerHTML='<p class="nytim-empty">'+esc(selection.reason)+'</p>';return;}
  const target=settings().target;
  result.innerHTML='<div class="nytim-cards">'+referenceCard('Time reference',selection.timing,context,observation,target)+referenceCard('Closing-strength reference',selection.strength,context,observation,target)+'</div>';
 }
 const controller={
  update({code='',method='Custom',date=''}={}){
   rawCode=code;let parsed=null;
   if(code){try{parsed=parseForecastCode(code);}catch{}}
   const next=timingContext(parsed,{date,method}),nextSignature=JSON.stringify([date,method,next.available?next.lower:null,next.available?next.upper:null]);
   if(signature&&nextSignature!==signature){$('ny-timing-time').value='09:00';$('ny-timing-side').value='U';$('ny-timing-type').value='CLOSE_OUTSIDE';$('ny-timing-overshoot').value='10';}
   signature=nextSignature;context=next;prepareChartToken();ensureData();render();
  },
  decorateCode(code=rawCode){
   if(!code)return '';
   const result=appendNYTimingMetadata(code,{...settings(),market:instrument.id,referenceToken:chartToken});
   parseForecastCode(result);return result;
  },
  get exportPending(){return settings().enabled&&loading;},
  get exportBlocked(){return settings().enabled&&!chartToken;},
  get exportStatus(){return !settings().enabled?'':chartToken?'Timing references included · '+requiredIndicator[instrument.id]+' or newer.':error?'Chart research unavailable. Choose “Use Mean box code only” to copy the existing forecast.':'Loading chart research…';}
 };
 host.nyTimingController=controller;
 baselineButton.addEventListener('click',()=>{$('ny-timing-enable').checked=false;chartToken='';render();onExportChange();});
 host.addEventListener('toggle',()=>{if(host.open){loadStyle();if(error){error='';loaded=null;}ensureData();render();}});
 host.addEventListener('input',event=>{event.stopPropagation();if(!['ny-timing-enable','ny-timing-fit','ny-timing-target'].includes(event.target.id))render();});
 host.addEventListener('change',event=>{event.stopPropagation();if(event.target.id==='ny-timing-enable'&&$('ny-timing-enable').checked&&error){error='';loaded=null;}prepareChartToken();ensureData();render();if(['ny-timing-enable','ny-timing-fit','ny-timing-target'].includes(event.target.id))onExportChange();});
 render();return controller;
}
