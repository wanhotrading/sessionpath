import {windows,time,currentNYStep,currentNYSession,loadTimingArchive,prepareScenario,fromAnchor,curve} from './core.mjs?v=conditional-20261119';
import {mountTimingCurve} from './interactive-curve.mjs?v=conditional-20261119';
import {createOnlineClock} from '../ny-online-clock.mjs?v=automatic-bbox-20261118';

const $ = id=>document.getElementById(id);
const marketNames = ['CL','NQ','ES'];
const defaultPatterns = [[],['breach'],['any','breach'],['any','any','breach']];
const patternValues = [
  ['any','Any result'],['none','No breach'],['breach','Either edge breached'],
  ['upper','Upper only'],['lower','Lower only'],['both','Both edges'],
  ['upper-hit','Upper, including both'],['lower-hit','Lower, including both']
];
const bboxEdges = [['either','Either BBOX edge'],['upper','Upper BBOX edge'],['lower','Lower BBOX edge'],['both','Both BBOX edges']];
const eveningEdges = [['upper','Upper breakout high'],['lower','Lower breakout low']];
const preciseSignals = [
  ['any','Any evening candle'],['first','18:00–18:05 candle'],['later','Any 18:05–19:30 candle'],
  ...Array.from({length:17},(_,i)=>['bar-'+(i+2),time(i+1)+'–'+time(i+2)+' candle'])
];
const percent = p=>p==null?'—':(p*100).toFixed(1)+'%';
const count = n=>n.toLocaleString('en-US');
const counts = (k,n)=>count(k)+' / '+count(n);
const sample = (data,k=data.k)=>data.n ? counts(k,data.n)+' dates'+(data.n<30?' · small sample':'') : 'No matching dates';
const interval = d=>percent(d.lo)+'–'+percent(d.hi);
const graph = mountTimingCurve($('graph'),choose);
const clock = createOnlineClock();

const url = new URL(location.href);
const requested = url.searchParams.get('instrument');

let mode = 'bbox';
let windowIndex=3, pattern=[...defaultPatterns[3]], loadId=0;
let bboxEdge='either', eveningEdge='upper';
let scenario=null, data=null, points=[], chosen=null, reachedAt=null;
let clockSession=null, clockMessage='';

function fillOptions(select, options, selected) {
  select.replaceChildren(...options.map(([value,label])=>new Option(label,value)));
  select.value=selected;
}

function configureInputs() {
  const evening=mode==='evening';
  $('bbox-mode').setAttribute('aria-pressed',String(!evening));
  $('evening-mode').setAttribute('aria-pressed',String(evening));
  for (const id of ['window-label','bbox-fields','patterns']) $(id).hidden=evening;
  for (const id of ['anchor-label','evening-fields']) $(id).hidden=!evening;
  fillOptions($('edge'),evening?eveningEdges:bboxEdges,evening?eveningEdge:bboxEdge);
  $('history-label').hidden=windowIndex===0||evening;
  renderPatterns();
  renderPathOptions();
}

function renderPatterns() {
  const host=$('patterns');
  $('history-label').hidden=windowIndex===0||mode==='evening';
  const show=mode==='bbox'&&$('history').value==='custom'&&windowIndex>0;
  $('pattern-note').hidden=!show;
  if (!show) {
    host.replaceChildren();
    return;
  }
  host.replaceChildren(...windows.slice(0,windowIndex).map((win,i)=>{
    const label=document.createElement('label');
    label.textContent=win.label;
    const select=document.createElement('select');
    fillOptions(select,patternValues,pattern[i]??'any');
    select.addEventListener('change',()=>{
      pattern[i]=select.value;
      rebuild();
    });
    label.append(select);
    return label;
  }));
}

function renderPathOptions() {
  $('prior-path').hidden=mode==='evening'||windowIndex===0;
  if ($('prior-path').hidden) return;
  const repeat=$('prior-path-filter').value==='returned-repeat';
  $('repeat-window-label').hidden=!repeat;
  const select=$('repeat-window'), previous=select.value;
  const choices=[['any','Any prior window'], ...windows.slice(0,windowIndex).map((window,i)=>[String(i),window.label])];
  fillOptions(select,choices,choices.some(([value])=>value===previous)?previous:'any');
  $('path-cutoff').textContent='Trace from 18:00 through '+time(windows[windowIndex].start)+' NY. A return requires a five-minute close inside. A fresh breach requires a later wick beyond the same edge.';
}

function settings() {
  const repeat=$('repeat-window').value;
  return {mode,window:windowIndex,startPosition:$('start-position').value,history:$('history').value,
    pattern,anchor:$('anchor').value,edge:$('edge').value,eveningOpen:$('evening-open').value,signalBar:$('signal-bar').value,
    traceEdge:$('trace-edge').value,priorPath:$('prior-path-filter').value,repeatWindow:repeat&&repeat!=='any'?Number(repeat):null};
}

function refreshURL(market) {
  const current=new URL(location.href);
  current.searchParams.set('instrument',market);
  history.replaceState(null,'',current);
  const back = new URL('../',location.href);
  back.searchParams.set('instrument',market);
  $('back').href=back.href;
}

async function changeMarket() {
  const market=$('market').value, token=++loadId;
  data=null;
  scenario=null;
  $('result-body').hidden=true;
  $('error').hidden=false;
  $('retry').hidden=true;
  $('error').textContent='Loading '+market+' study…';
  refreshURL(market);
  try {
    const loaded=await loadTimingArchive(market);
    if(token!==loadId) return;
    data=loaded;
    $('error').hidden=true;
    $('result-body').hidden=false;
    rebuild();
  } catch(error) {
    if(token!==loadId) return;
    $('error').textContent=error.name==='TimeoutError'?'Loading timed out. Try again.':error.message;
    $('retry').hidden=false;
  }
}

function drawConditionedCurve() {
  points=curve(scenario,{
    distance:$('distance').value,
    progress:$('progress-label').hidden?'any':$('progress').value,
    position:$('current-position-label').hidden?'any':$('current-position').value,
  });
  graph.draw(points,chosen);
}

function rebuild() {
  if (!data) return;
  const opts=settings();
  scenario=prepareScenario(data,opts);
  const previous=chosen;
  reachedAt=null;
  $('reached').checked=false;
  $('progress-label').hidden=!(mode==='bbox'&&opts.edge==='both');
  $('current-position-label').hidden=mode!=='bbox';
  const target=opts.edge==='lower'?'low':'high';
  const direction=opts.edge==='lower'?'Below':'Above';
  const level=opts.anchor==='first'?'first breach candle':'18:00–19:30';
  const pathApplied=mode==='bbox'&&opts.window>0&&opts.priorPath!=='any';
  const pathLabel=pathApplied?' · '+(opts.traceEdge==='upper'?'Upper':'Lower')+' edge · '+$('prior-path-filter').selectedOptions[0].textContent+
    (opts.priorPath==='returned-repeat'&&opts.repeatWindow!==null?' in '+windows[opts.repeatWindow].label:''):'';
  const desc=mode==='evening' ? direction+' '+level+' '+target+' by 08:30 NY' :
    windows[opts.window].label+' NY · '+$('edge').selectedOptions[0].textContent;
  $('scenario-caption').textContent=data.market+' · '+desc+pathLabel;
  const initial=mode==='evening'?108:scenario.start;
  chosen=previous!=null&&previous>=scenario.start&&previous<=scenario.end?previous:initial;
  drawConditionedCurve();
  if($('follow').checked) refreshClock(true);
  else display(chosen);
}

function display(step,clockNotice='') {
  if(!scenario) return;
  chosen=step;
  $('point-time').textContent=time(step)+' NY';
  const point=points[step-scenario.start];
  const reached=reachedAt!==null&&reachedAt<=step;
  $('reached').checked=reached;
  $('reached').disabled=Boolean(clockNotice&&step===scenario.start);
  const end=time(scenario.end);
  $('headline-label').textContent='Breach still possible by '+end+' NY';
  $('headline').textContent=reached?'Reached':percent(point.p);
  $('sample').textContent=reached ? 'Target marked reached at '+time(reachedAt)+' NY' :
    sample(point)+(point.n?' · 95% '+interval(point):'');
  const reference = fromAnchor(scenario);
  if(mode==='evening') {
    const held=point.n-point.k;
    $('reference-label').textContent='Evening level still holds through 08:30';
    $('reference-value').textContent=reached?'Exceeded':percent(point.p==null?null:held/point.n);
    $('reference-sample').textContent=reached?'Original level already breached':sample(point,held);
  } else {
    $('reference-label').textContent='At '+time(scenario.start)+' NY';
    $('reference-value').textContent=percent(reference.p);
    $('reference-sample').textContent=sample(reference);
  }
  let message=clockNotice;
  if(reached) message='The future estimate is complete for this target. The curve remains available for historical comparison.';
  else if (!message&&!point.n) {
    const inherited=mode==='bbox'&&scenario.paths.length&&scenario.paths.every(path=>path.hit===scenario.start);
    message=inherited?'The selected edge was already breached at the target window’s open.':
      scenario.paths.length?'No matching nights still had this target pending.':'No historical nights match these inputs.';
  }
  else if (!message&&step===scenario.end) message='Window ended at '+end+' NY.';
  $('observed-state').hidden=!message;
  $('observed-state').textContent=message;
  $('graph').classList.toggle('dimmed',reached);
  graph.moveMarker(step);
  const condition=mode==='bbox' ?
    ('Estimates assume the selected target was still pending from '+time(scenario.start)+' to the observation time. '+($('edge').value==='both' ?
      'The target stays pending until both edges have been breached by a wick.' :
      'A wick beyond the target counts even if price moved back inside.')) :
    'Estimates assume the evening level was still unbroken through the observation time.';
  const clockText=condition+' Drag or click to inspect a five-minute observation. Dashed segments have fewer than 30 cases.';
  const firstCandle=mode==='evening'&&$('anchor').value==='first';
  const anySignal=['any','later'].includes($('signal-bar').value);
  $('curve-note').textContent=firstCandle
    ? clockText+' From the first breach candle, '+percent(reference.n?(reference.n-reference.k)/reference.n:null)+
      ' held through 08:30 ('+counts(reference.n-reference.k,reference.n)+').'+
      (anySignal?' Before 19:30, new signal dates enter as their candles close.':'')
    : clockText;

}

function refreshClock(force=false) {
  const now=clock.read();
  $('ny-clock').textContent=now.clock+' '+now.zone;
  if(!$('follow').checked||!scenario) return;
  const session=currentNYSession(now);
  if (session!==clockSession) {
    clockSession=session;
    reachedAt=null;
    force=true;
  }
  const step=currentNYStep(now);
  const point=step===null ? scenario.start : Math.max(scenario.start,Math.min(step,scenario.end));
  const message=step===null ? 'The regular overnight session is closed. Showing the opening reference.' :
    step<scenario.start ? 'This window starts at '+time(scenario.start)+' NY. Showing the opening reference.' :
    step>scenario.end ? 'Window ended at '+time(scenario.end)+' NY.' : '';
  if(force||point!==chosen||message!==clockMessage) display(point,message);
  clockMessage=message;
}

function choose(step) {
  $('follow').checked=false;
  display(Math.max(scenario.start,Math.min(step,scenario.end)));
}

function setMode(next) {
  if(mode===next) return;
  mode=next;
  chosen=null;
  configureInputs();
  rebuild();
}

$('market').value=marketNames.includes(requested)?requested:'CL';
$('market').addEventListener('change',changeMarket);
$('retry').addEventListener('click',changeMarket);
$('bbox-mode').addEventListener('click',()=>setMode('bbox'));
$('evening-mode').addEventListener('click',()=>setMode('evening'));
$('window').addEventListener('change',()=>{
  windowIndex=Number($('window').value);
  pattern=[...defaultPatterns[windowIndex]];
  chosen=null;
  renderPatterns();
  renderPathOptions();
  rebuild();
});
$('history').addEventListener('change',()=>{
  renderPatterns();
  rebuild();
});
$('edge').addEventListener('change',()=>{
  if(mode==='evening') eveningEdge=$('edge').value;
  else {
    bboxEdge=$('edge').value;
    if($('prior-path-filter').value==='any'&&['upper','lower'].includes(bboxEdge)) $('trace-edge').value=bboxEdge;
  }
  rebuild();
});
$('prior-path-filter').addEventListener('change',()=>{
  renderPathOptions();
  rebuild();
});
for (const id of ['trace-edge','repeat-window']) $(id).addEventListener('change',rebuild);
for (const id of ['start-position','anchor','evening-open','signal-bar']) $(id).addEventListener('change',rebuild);
for (const id of ['distance','progress','current-position']) $(id).addEventListener('change',()=>{if(scenario){drawConditionedCurve();display(chosen);}});
$('reached').addEventListener('change',()=>{
  reachedAt=$('reached').checked?chosen:null;
  display(chosen);
});
$('follow').addEventListener('change',()=>{
  if(!$('follow').checked) display(chosen);
  refreshClock(true);
  if($('follow').checked) clock.sync().then(()=>refreshClock(true)).catch(()=>{});
});
fillOptions($('signal-bar'),preciseSignals,'any');
configureInputs();
refreshClock();
setInterval(refreshClock,1000);
setInterval(()=>{if($('follow').checked&&!document.hidden) clock.sync().then(()=>refreshClock(true)).catch(()=>{});},300000);
changeMarket();
