import { attachStudyDialog } from './study-dialog.mjs';
import { windows, time, currentNYStep, prepareScenario, curve, loadTimingArchive } from './core.mjs?v=conditional-20261119';
import { mountTimingCurve } from './interactive-curve.mjs?v=conditional-20261119';
import { nyClockParts } from '../ny-online-clock.mjs?v=automatic-bbox-20261118';

const maskName = ['No breach','Upper only','Lower only','Both edges'];
const patternName = ['none','upper','lower','both'];
const positionName = ['Inside BBOX','Above BBOX','Below BBOX'];
const positionPhrase = ['inside','above','below'];
const distanceName = ['≤10%','10–25%','>25%'];
const pct = p => Number.isFinite(p) ? (p*100).toFixed(1)+'%' : '—';
const money = new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const maskFor = {either:3,upper:1,lower:2,both:3};

export function liveScenario(context, edge) {
  const { window, price, lower, upper, position, openingSide, activeMask } = context;
  const up = upper-price, down = price-lower;
  const pendingDistance = edge==='upper' ? up : edge==='lower' ? down :
    edge==='both'&&activeMask===1 ? down : edge==='both'&&activeMask===2 ? up : Math.min(up,down);
  const width = upper-lower;
  const distance = pendingDistance<=.10*width+1e-8 ? 0 : pendingDistance<=.25*width+1e-8 ? 1 : 2;
  const paths = context.priorPaths || [];
  const confirmed = paths.map((path,index)=>path?.freshWindow!=null?index:null).filter(Number.isInteger);
  const trace = edge==='upper'?0:edge==='lower'?1:confirmed.length===1?confirmed[0]:null;
  const repeat = trace===null?null:paths[trace]?.freshWindow;
  const reached = edge==='both' ? activeMask===3 : Boolean(activeMask & maskFor[edge]);
  return {
    reached, distance,
    comparison: { mode:'bbox',window,edge,startPosition:String(openingSide),
      history:'custom',pattern:context.past.map(flag=>patternName[flag]||'any'),
      traceEdge:trace===1?'lower':'upper',priorPath:repeat==null?'any':'returned-repeat',repeatWindow:repeat },
    filters: { position:String(position),distance:String(distance),
      progress:edge==='both'&&context.activeComplete&&activeMask!==3?String(activeMask):'any' },
  };
}

export function mountLiveTimingPanel(host, {market, now=Date.now, replay=()=>false, loadArchive=loadTimingArchive}={}) {
  if (!['CL','NQ','ES'].includes(market)) return;
  host.classList.add('overnight-timing-panel');
  host.setAttribute('aria-label','Overnight breach timing');
  host.innerHTML = `
    <div class="ot-heading">
      <div><h2>Overnight breach timing</h2><p data-ot="window">${market}</p></div>
      <a class="quiet" data-ot="study">Explore study</a>
    </div>
    <p class="ot-status" data-ot="status" role="status">Waiting for the 03:00 NY TradingView checkpoint.</p>
    <div data-ot="body" hidden>
      <div class="ot-controls">
        <label>Target<select data-ot="edge">
          <option value="either">Either BBOX edge</option><option value="upper">Upper edge</option>
          <option value="lower">Lower edge</option><option value="both">Both edges</option>
        </select></label>
        <div><span>Observed price</span><strong data-ot="price"></strong><small data-ot="position"></small></div>
        <div><span data-ot="estimate-label">Chance still remaining</span><strong class="ot-estimate" data-ot="estimate"></strong><small data-ot="sample"></small></div>
      </div>
      <ul class="ot-context" data-ot="past" aria-label="Previous window results"></ul>
      <p class="ot-path" data-ot="path"></p>
      <svg data-ot="curve"></svg>
      <div class="ot-graph-foot"><output data-ot="time"></output><button class="quiet" type="button" data-ot="reset" hidden>Back to live</button></div>
      <p class="ot-note" data-ot="condition"></p>
    </div>`;
  const $ = name=>host.querySelector('[data-ot="'+name+'"]');
  const study = new URL('./',import.meta.url);
  study.searchParams.set('instrument',market);
  $('study').href = study.href;
  attachStudyDialog($('study'));
  const graph = mountTimingCurve($('curve'), step=>{
    if (selected===step) return;
    follow = step===latest.step;
    selected = step;
    showPoint();
  });
  let packet, latest, data, loading, selection, points, key, selected, activeWindow, follow=true, loadFailed=false;

  function choosePoint() {
    if (follow || selected==null || selected<windows[latest.window].start || selected>windows[latest.window].end) selected=latest.step;
  }

  function showPoint() {
    const point=points[selected-windows[latest.window].start];
    const atLive = selected===latest.step;
    const reached = atLive&&selection.reached;
    const pendingKnown = !atLive || latest.activeComplete;
    $('estimate-label').textContent = atLive?'Chance still remaining':'Historical chance at this time';
    $('estimate').textContent = reached?'Reached':!pendingKnown?'—':pct(point?.p);
    $('sample').textContent = reached?'Target already breached':!pendingKnown?'Wick coverage incomplete':
      point?.n ? `${point.k}/${point.n} dates${point.n<30?' · small sample':''}` : 'No matching dates';
    $('time').textContent = time(selected)+' NY'+(atLive?' · latest observation':' · explored observation');
    $('reset').hidden = follow;
    graph.moveMarker(selected);
  }

  function render() {
    if (host.hidden) return;
    const clock = now();
    const stepNow = currentNYStep(nyClockParts(clock));
    if (replay() || stepNow===null || stepNow<108 || !packet || clock-Date.parse(packet.observed_at)>480000) {
      $('body').hidden = true;
      const window = stepNow===null ? null : windows.find(win=>stepNow>=win.start&&stepNow<win.end);
      $('window').textContent = market+(window?' · '+window.label+' NY':'');
      $('status').textContent = replay()?'Switch back to today for live overnight timing.' :
        stepNow===null?'The regular overnight session is closed.' :
        stepNow<108?'Live BBOX context begins with the 03:00 NY TradingView checkpoint.' :
        'Waiting for a fresh TradingView checkpoint.';
      return;
    }
    latest = packet.overnight_timing;
    if (!latest || latest.version!==1 || ![2,3].includes(latest.window)) {
      $('body').hidden = true;
      $('status').textContent = 'Waiting for verified overnight context from TradingView.';
      return;
    }
    const {window,step,price,position,openingSide,past} = latest;
    const label = windows[window].label;
    $('window').textContent = market+' · '+label+' NY';
    if (!Number.isFinite(price) || !Number.isInteger(position) || !Number.isInteger(openingSide)) {
      $('body').hidden = true;
      $('status').textContent = 'Waiting for the verified '+time(windows[window].start)+' NY decision open.';
      return;
    }
    if (!data) {
      $('status').textContent = loadFailed?'The study could not load. Open the study to retry.':'Loading historical observations…';
      if (!loading && !loadFailed) {
        loading=loadArchive(market).then(result=>{ data=result; }).catch(()=>{loadFailed=true;}).finally(()=>{
          loading=null;
          render();
        });
      }
      return;
    }
    $('body').hidden = false;
    $('status').textContent = step===174?'Window ended at 08:30 NY.':
      'Auto-filled · '+time(step)+' NY '+(step===windows[window].start?'decision open':'confirmed five-minute close');
    $('price').textContent = money.format(price);
    $('position').textContent = positionName[position];
    $('past').replaceChildren(...past.map((value,index)=>{
      const item = host.ownerDocument.createElement('li');
      item.textContent = windows[index].label+' · '+(maskName[value]||'Unverified');
      return item;
    }));
    const trace = latest.observedPaths.flatMap((path,index)=>{
      const side = index===0?'Upper':'Lower';
      if (path.freshWindow!=null) return [side+' return inside, then fresh wick in '+windows[path.freshWindow].label];
      return path.returnConfirmed?[side+' return inside confirmed']:[];
    });
    $('path').textContent = trace.length ? trace.join(' · ') : 'No return or fresh wick confirmed from the available bars.';
    selection = liveScenario(latest,$('edge').value);
    $('condition').textContent = `Matched on price ${positionPhrase[position]} the BBOX and distance ${distanceName[selection.distance]} of its width.`+
      (selection.comparison.priorPath!=='any'?' Verified prior fresh wick applied.':'')+
      ' Drag or click to explore with these same filters. Dashes indicate fewer than 30 dates.';
    if (activeWindow!==window) { activeWindow=window; follow=true; }
    choosePoint();
    const next = JSON.stringify([selection.comparison,selection.filters]);
    if (key!==next) {
      key=next;
      points=curve(prepareScenario(data,selection.comparison),selection.filters);
      graph.draw(points,selected);
    }
    showPoint();
  }

  function receive(next) {
    if (next?.market!==market) return;
    if (next.observed_at!==packet?.observed_at) loadFailed=false;
    packet=next;
    render();
  }
  $('edge').addEventListener('change',render);
  $('reset').addEventListener('click',()=>{follow=true;render();});
  document.getElementById('replay-toggle')?.addEventListener('change',render);
  document.addEventListener('sessionpath:verified-checkpoints',event=>receive(event.detail));
  const timer = setInterval(()=>{
    const epoch=now();
    if (!packet || replay() || currentNYStep(nyClockParts(epoch))<108 || epoch-Date.parse(packet.observed_at)>480000) render();
  },15_000);
  window.addEventListener('pagehide',event=>{if(!event.persisted)clearInterval(timer);});
  render();
  return {receive, refresh:render};
}
