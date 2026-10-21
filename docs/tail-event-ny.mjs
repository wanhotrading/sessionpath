const $=id=>document.getElementById(id);
const clock=m=>Number.isFinite(m)?`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`:'—';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=(x,d=1)=>Number.isFinite(x)?x.toFixed(d):'—';
const pc=x=>Number.isFinite(x)?`${(100*x).toFixed(1)}%`:'—';
const signed=(x,suffix='%')=>Number.isFinite(x)?`${x>0?'+':''}${(100*x).toFixed(1)}${suffix}`:'—';
const ratio=x=>Number.isFinite(x)?`${x>0?'+':''}${x.toFixed(3)} R`:'—';
const count=x=>Number.isFinite(x)?x.toLocaleString('en-US'):'—';
const rate=x=>x&&Number.isFinite(x.n)&&x.n>0&&Number.isFinite(x.p)?`${pc(x.p)} (${count(x.k)}/${count(x.n)})<small>95% ${pc(x.lo)}–${pc(x.hi)}</small>`:'—';
const interval=(x,suffix='%')=>x&&Number.isFinite(x.mean)?`<span class="${x.mean>0?'positive':x.mean<0?'negative':''}">${signed(x.mean,suffix)}</span><small>${Number.isFinite(x.lo)&&Number.isFinite(x.hi)?`95% ${signed(x.lo,suffix)} to ${signed(x.hi,suffix)}`:'Interval unavailable · insufficient clusters'}</small>`:'—';
const empty=(id,columns,text='No eligible measurements for this selection.')=>{$(id).innerHTML=`<tr><td colspan="${columns}" class="empty empty-cell">${esc(text)}</td></tr>`;};
const rows=(id,values,columns,render)=>{if(!values?.length)return empty(id,columns);$(id).innerHTML=values.map(render).join('');};
const stateName={ALL:'All states',OUTSIDE:'Still outside',RECLAIMED:'Reclaimed edge',NEVER_BREACHED:'Never breached',BOUNDARY:'At boundary'};
const query=new URLSearchParams(location.search);
if(query.get('instrument')==='NQ')$('market').value='NQ';
let data,original;

function updateLinks(market){
  for(const[id,path]of[['home-link','./'],['double-link','double-break-0430.html'],['orange-link','orange-box-fill.html']])$(id).href=`${path}?instrument=${market}`;
}
function setQuery(){
  const q=new URLSearchParams();q.set('instrument',$('market').value);
  if($('event').value!=='0430 double break')q.set('event',$('event').value);
  if($('side').value!=='D')q.set('side',$('side').value);
  if($('min').value!=='50')q.set('min',$('min').value);
  if($('qualification').value!=='strict')q.set('qualification',$('qualification').value);
  if($('period').value!=='all')q.set('period',$('period').value);
  history.replaceState(null,'',`${location.pathname}?${q}${location.hash}`);
}
for(const id of ['event','side','min','qualification','period'])if(query.has(id)&&[...$(id).options].some(o=>o.value===query.get(id)))$(id).value=query.get(id);

function render(){
  if(!data)return;
  const market=$('market').value,event=$('event').value,side=$('side').value,isOrange=event.startsWith('Orange');
  const min=isOrange?Number($('min').value):0,qualification=isOrange?$('qualification').value:'strict',period=$('period').value;
  $('min').disabled=!isOrange;$('qualification').disabled=!isOrange;
  $('minimum-label').style.opacity=isOrange?'1':'.55';$('qualification-label').style.opacity=isOrange?'1':'.55';
  updateLinks(market);setQuery();
  const g=data.groups?.find(x=>x.market===market&&x.event===event&&x.side===side&&x.min===min&&x.qualification===qualification&&x.period===period);
  const status=$('status');status.classList.remove('error');
  status.textContent=g?`${market} · ${event==='0430 double break'?'04:30 double break':event==='Orange three'?'03:00–05:00 orange boxes':'05:00–08:30 orange boxes'} · second side ${side} · ${count(g.days)} event dates${g.from&&g.to?` · ${g.from} to ${g.to}`:''}.`:'No eligible event group for this selection. Try all years or the broader orange sample.';
  $('selection-note').textContent=`${isOrange?`Orange targets ${qualification==='strict'?'strictly exceeded':'touched'} on both sides; at least ${min} earlier forecast match${min===1?'':'es'}. `:''}Each result shows its own usable sample. ${g?.days&&g.days<30?'Small sample: these estimates are exploratory. ':''}All times are New York time.`;
  renderHypotheses(g);
  rows('results',g?.outcomes,9,s=>`<tr><td>${clock(s.checkpoint)}–${clock(s.end)}</td><td>${count(s.n)}</td><td>${rate(s.newExtreme)}</td><td>${rate(s.oppositeExtreme)}</td><td>${rate(s.finalContinues)}</td><td>${rate(s.midpointTouch)}</td><td>${rate(s.oppositeEdgeTouch)}</td><td>${signed(s.meanForward)} / ${signed(s.medianForward)}</td><td>${pc(s.meanFavorable)} / ${pc(s.meanAdverse)}</td></tr>`);
  const states=g?.states||[],conditional=g?.conditional||[];
  const stateRows=states.length?states:conditional;
  rows('states',stateRows,11,s=>{const c=conditional.find(x=>x.checkpoint===s.checkpoint&&x.state===s.state)||{};return `<tr><td>${clock(s.checkpoint)}</td><td>${esc(stateName[s.state]||s.state)}</td><td>${count(s.n)} / ${count(c.n)}</td><td>${rate(s.openFollows0830)}</td><td>${rate(s.closeAcrossEdge)}</td><td>${rate(s.returnAfterBreach)}</td><td>${rate(c.newExtreme)}</td><td>${rate(c.finalContinues)}</td><td>${rate(c.midpointTouch)}</td><td>${rate(c.oppositeEdgeTouch)}</td><td>${signed(c.meanForward)}</td></tr>`;});
  rows('matched',g?.matched,7,s=>`<tr><td>${clock(s.checkpoint)}–${clock(s.end)}</td><td>${count(s.n)}</td><td>${count(s.controlDates)}</td><td>${signed(s.meanEventReturn)} / ${signed(s.meanControlReturn)}</td><td>${interval(s.returnDifference)}</td><td>${pc(s.eventExtreme)} / ${pc(s.controlExtreme)}</td><td>${interval(s.extremeDifference,' pp')}</td></tr>`);
  rows('timing',g?.timing,5,s=>`<tr><td>${esc(s.horizon)}</td><td>${clock(s.earlier)} → ${clock(s.later)}</td><td>${count(s.n)}</td><td>${interval(s.difference)}</td><td>${signed(s.medianDifference)}</td></tr>`);
  const cost=$('cost').value;
  $('r-heading').textContent=cost==='gross'?'Mean gross R bounds':`Mean R bounds · less ${cost} ticks`;
  rows('brackets',g?.brackets,11,s=>`<tr><td>${clock(s.checkpoint)}</td><td><span class="${s.orientation==='follow'?'positive':'negative'}">${s.orientation==='follow'?'Follow':'Fade'}</span></td><td>${pc(s.level)} of width</td><td>${count(s.n)}</td><td>${count(s.target)}</td><td>${count(s.stop)}</td><td>${count(s.ambiguous)}</td><td>${count(s.timeout)}</td><td>${pc(s.targetLower)}–${pc(s.targetUpper)}</td><td>${ratio(cost==='gross'?s.grossRLower:s[`net${cost}TicksLower`])} to ${ratio(cost==='gross'?s.grossRUpper:s[`net${cost}TicksUpper`])}</td><td>${num(s.meanRiskPoints,market==='NQ'?2:3)}</td></tr>`);
  rows('chronology',g?.chronology,5,s=>`<tr><td>${esc(s.year)}</td><td>${count(s.n)}</td><td>${rate(s.newExtreme)}</td><td>${rate(s.finalContinues)}</td><td>${signed(s.meanForward)}</td></tr>`);
  const controls=g?.controls||original?.summaries?.filter(s=>s.market===market&&s.event==='No double break control'&&s.side===side)||[];
  rows('control',controls,4,s=>`<tr><td>${clock(s.checkpoint)}–${clock(s.end)}</td><td>${count(s.n)}</td><td>${rate(s.newExtreme)}</td><td>${rate(s.finalContinues)}</td></tr>`);
  renderAudit();
}
function renderHypotheses(g){
  const outcomes=g?.outcomes||[],first=outcomes.find(s=>s.checkpoint===570&&s.end===960),later=outcomes.find(s=>s.checkpoint===630&&s.end===960);
  const cards=[['Continues into the 16:00 close',first?.finalContinues,'Entry reference: 09:30 open'],['Another extreme after 10:30',later?.newExtreme,'Beyond the extreme known at 10:30'],['Revisits the overnight midpoint',first?.midpointTouch,'During 09:30–16:00 · target ahead at entry'],['Reaches the opposite overnight edge',first?.oppositeEdgeTouch,'During 09:30–16:00 · target ahead at entry']];
  $('hypotheses').innerHTML=cards.map(([label,x,note])=>`<div class="card"><div class="metric-label">${esc(label)}</div><strong>${pc(x?.p)}</strong><small>${x?.n>0?`${count(x.k)}/${count(x.n)} · 95% ${pc(x.lo)}–${pc(x.hi)}`:'No eligible sample'}</small><small>${esc(note)}</small></div>`).join('');
  $('hypothesis-note').textContent=g?'The same day can satisfy more than one outcome. A rate above 50% alone does not establish an advantage; compare the matched-control results and remaining favourable/adverse movement.':'Choose a group with eligible measurements to read the hypotheses.';
}
function renderAudit(){
  const coverage=data.coverage;
  $('method').innerHTML=`<p>Source history: 2022–2026. Expanded tests use the valid coverage required for each window. Missing observations are excluded, never filled as zero.</p>${coverage?`<details><summary>Coverage audit</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(typeof coverage==='object'?JSON.stringify(coverage,null,2):coverage)}</pre></details>`:''}`;
  const defs=data.definitions;
  $('definitions').innerHTML=Array.isArray(defs)?`<ul>${defs.map(x=>`<li>${esc(typeof x==='string'?x:JSON.stringify(x))}</li>`).join('')}</ul>`:defs&&typeof defs==='object'?`<dl>${Object.entries(defs).map(([k,v])=>`<dt><b>${esc(k)}</b></dt><dd>${esc(typeof v==='string'?v:JSON.stringify(v))}</dd>`).join('')}</dl>`:`<p>${esc(defs||'See the downloadable audit for exact definitions.')}</p>`;
}
$('filters').addEventListener('change',render);
$('cost').addEventListener('change',render);
$('filters').addEventListener('submit',e=>e.preventDefault());
$('reset').addEventListener('click',()=>{$('event').value='0430 double break';$('side').value='D';$('min').value='50';$('qualification').value='strict';$('period').value='all';$('cost').value='gross';render();});
try{
  const results=await Promise.allSettled([fetch('tail-event-ny-expanded.json').then(async r=>{if(!r.ok)throw Error('Expanded research is unavailable. Please reload after the update finishes.');return r.json();}),fetch('tail-event-ny-data.json').then(r=>r.ok?r.json():null)]);
  if(results[0].status==='rejected')throw results[0].reason;
  data=results[0].value;if(!Array.isArray(data.groups))throw Error('The expanded research file is incomplete. Please reload after the update finishes.');
  original=results[1].status==='fulfilled'?results[1].value:null;render();
}catch(e){$('status').textContent=e.message||'Could not load the research. Please reload.';$('status').classList.add('error');for(const[id,n]of[['results',9],['states',11],['matched',7],['control',4],['timing',5],['brackets',11],['chronology',5]])empty(id,n,'Research could not be loaded. Reload this page to retry.');renderHypotheses(null);}
