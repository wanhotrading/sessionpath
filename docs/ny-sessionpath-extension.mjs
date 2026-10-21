const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pc=x=>Number.isFinite(x)?`${(100*x).toFixed(1)}%`:'—';
const count=x=>Number.isFinite(x)?x.toLocaleString('en-US'):'—';
const rate=x=>x&&x.n>0&&Number.isFinite(x.p)?`${pc(x.p)} (${count(x.k)}/${count(x.n)})<small>95% ${pc(x.lo)}–${pc(x.hi)}</small>`:'—';
const empty=(id,columns,message='No eligible measurements for this selection.')=>{$(id).innerHTML=`<tr><td colspan="${columns}" class="empty empty-cell">${esc(message)}</td></tr>`;};
const rows=(id,values,columns,render)=>{if(!values?.length)return empty(id,columns);$(id).innerHTML=values.map(render).join('');};
const methods={nyOwnWide:'Own Wide · Mean',nyOwnExact:'Own Exact · Mean',nyPriorWide:'Prior Wide · Mean',nyPriorExact:'Prior Exact · Mean'};
const cohorts={ALL:'all eligible NY forecasts', '0430_U':'04:30 double break, second side U','0430_D':'04:30 double break, second side D',ORANGE03_U:'03–05 both orange boxes, second side U',ORANGE03_D:'03–05 both orange boxes, second side D',ORANGE05_U:'05–08:30 both orange boxes, second side U',ORANGE05_D:'05–08:30 both orange boxes, second side D'};
const q=new URLSearchParams(location.search);
if(q.get('instrument')==='NQ')$('market').value='NQ';
for(const id of ['method','minFit','cohort'])if(q.has(id)&&[...$(id).options].some(o=>o.value===q.get(id)))$(id).value=q.get(id);
let data;
function links(market){
  for(const[id,path]of[['home-link','./'],['tail-link','tail-event-ny.html'],['orange-link','orange-box-fill.html']])$(id).href=`${path}?instrument=${market}`;
  const next=new URLSearchParams({instrument:market,method:$('method').value,minFit:$('minFit').value,cohort:$('cohort').value});
  history.replaceState(null,'',`${location.pathname}?${next}${location.hash}`);
}
function render(){
  if(!data)return;
  const market=$('market').value,method=$('method').value,minFit=Number($('minFit').value),cohort=$('cohort').value;
  links(market);
  const g=data.groups.find(x=>x.market===market&&x.method===method&&x.minFit===minFit&&x.cohort===cohort);
  $('status').classList.remove('error');
  $('status').textContent=g?`${market} · ${methods[method]} · ${count(g.n)} eligible NY forecasts${g.from&&g.to?` · ${g.from} to ${g.to}`:''}.`:'No eligible group for this selection.';
  $('small-sample').textContent=!g||!g.n?'No eligible dates. This is unavailable, not a 0% probability. Try all eligible forecasts or the sparse sensitivity sample.':g.n<30?`Only ${g.n} eligible date${g.n===1?'':'s'}. This ${cohort.startsWith('ORANGE')?'orange-tail ':''}sample is too small for a reliable probability estimate; read the counts and intervals.`:cohort.startsWith('ORANGE')?'Orange-tail events are rare. Each conditional denominator can be smaller than the total shown above.':'';
  $('coverage-line').innerHTML=g?`<span>First NY break U <strong>${count(g.firstU)}</strong></span><span>First NY break D <strong>${count(g.firstD)}</strong></span><span>Never broke <strong>${count(g.noBreak)}</strong></span><span>Same-candle order unknown <strong>${count(g.ambiguous)}</strong></span><span>Condition: ${esc(cohorts[cohort])}</span>`:'';
  rows('unconditional',g?.levels,5,s=>`<tr><td>${s.multiple.toFixed(2)}×</td><td>${rate(s.up)}</td><td>${rate(s.down)}</td><td>${rate(s.either)}</td><td>${rate(s.both)}</td></tr>`);
  rows('first-break',g?.levels,4,s=>`<tr><td>${s.multiple.toFixed(2)}×</td><td>${rate(s.first?.all)}</td><td>${rate(s.first?.U)}</td><td>${rate(s.first?.D)}</td></tr>`);
  const pendingSide=$('pending-side').value;
  rows('pending-results',g?.levels,7,s=>{const p=s.afterConfirmation?.[pendingSide];return `<tr><td>${s.multiple.toFixed(2)}×</td><td>${rate(p?.alreadyBeforeConfirmation)}</td><td>${count(p?.noRemainingBars)}</td><td>${count(p?.pendingN)}</td><td>${rate(p?.pendingHit)}</td><td>${rate(p?.pendingMiss)}</td><td>${rate(p?.gapAtNextOpen)}</td></tr>`;});
  const multiple=Number($('annual-level').value);
  rows('annual-results',g?.byYear,7,s=>{const l=s.levels?.find(x=>Math.abs(x.multiple-multiple)<1e-8);return `<tr><td>${esc(s.year)}</td><td>${count(s.n)}</td><td>${rate(l?.up)}</td><td>${rate(l?.down)}</td><td>${rate(l?.either)}</td><td>${rate(l?.both)}</td><td>${rate(l?.first?.all)}</td></tr>`;});
  renderAudit(market);
}
function renderAudit(market){
  const defs=data.definitions;
  $('definitions').innerHTML=Array.isArray(defs)?`<ul>${defs.map(v=>`<li>${esc(typeof v==='string'?v:JSON.stringify(v))}</li>`).join('')}</ul>`:defs&&typeof defs==='object'?`<dl class="audit-dl">${Object.entries(defs).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(typeof v==='string'?v:JSON.stringify(v))}</dd>`).join('')}</dl>`:`<p>${esc(defs||'See the downloadable results for exact definitions.')}</p>`;
  const source=data.markets?.[market];
  const coverage=source?{market,sourceFrom:source.sourceFrom,sourceTo:source.sourceTo,sourceDates:source.sourceDates,savedNYForecasts:source.savedNYForecasts,scoredNYForecasts:source.scoredNYForecasts,excludedForecastRecords:source.exclusions?.length,tailAuditRecords:source.tailAudit?.length,tailCounts:source.tailCounts,maxMeanReconstructionError:source.maxMeanReconstructionError,forecastSHA256:source.forecastSHA256,ohlcSHA256:source.ohlcSHA256}:data.coverage;
  $('audit-coverage').innerHTML=coverage?`<pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(typeof coverage==='object'?JSON.stringify(coverage,null,2):coverage)}</pre>`:'<p>See the source downloads for recorded coverage.</p>';
}
$('filters').addEventListener('change',render);
$('filters').addEventListener('submit',e=>e.preventDefault());
$('pending-side').addEventListener('change',render);
$('annual-level').addEventListener('change',render);
$('reset').addEventListener('click',()=>{$('method').value='nyOwnWide';$('minFit').value='50';$('cohort').value='ALL';$('pending-side').value='all';$('annual-level').value='1.2';render();});
try{
  const response=await fetch('ny-sessionpath-extension-data.json');
  if(!response.ok)throw Error('The NY extension research could not be loaded. Please reload after the update finishes.');
  data=await response.json();if(!Array.isArray(data.groups))throw Error('The research file is incomplete. Please reload after the update finishes.');render();
}catch(e){$('status').textContent=e.message||'Could not load the research. Reload this page to retry.';$('status').classList.add('error');for(const[id,n]of[['unconditional',5],['first-break',4],['pending-results',7],['annual-results',7]])empty(id,n,'Research is unavailable. Reload this page to retry.');}
