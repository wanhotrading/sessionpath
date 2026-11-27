import { animateForecastMeter } from '../forecast-meter-animation.mjs';
const positions=new WeakMap(),runs=new WeakMap();
const quiet=()=>matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.classList.contains('motion-paused')||document.body.classList.contains('motion-paused');
export function tint(el,value,baseline,label='Same-market, same-window earlier history',inverse=false){
 if(!el)return; el.removeAttribute('data-relative');
 el.removeAttribute('data-polarity');
 if(!Number.isFinite(value)||!Number.isFinite(baseline))return;
 el.dataset.relative=Math.abs(value-baseline)<1e-9?'equal':value<baseline?'below':'above';
 if(inverse)el.dataset.polarity='inverse';
 el.title=`${label}: ${baseline.toFixed(4)}. ${el.dataset.relative} baseline. ${inverse?'Lower no-expansion probability is orange (more expansion potential); higher is purple.':'Colours compare magnitude, not trade direction.'}`;
}
export function reveal(host,nodes,gap=250){
 if(!host)return;
 (runs.get(host)||[]).forEach(a=>a.cancel());runs.delete(host);
 host.querySelectorAll(':scope > .forecast-shine').forEach(x=>x.remove());
 if(quiet()||document.hidden||document.documentElement.dataset.startup==='loading')return;
 const bounds=host.getBoundingClientRect();
 if(bounds.bottom<=0||bounds.top>=innerHeight||bounds.right<=0||bounds.left>=innerWidth)return;
 const items=[...nodes].filter(Boolean),duration=150,step=gap;
 const animations=items.map((el,i)=>el.animate([{opacity:0,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{duration,delay:i*step,fill:'backwards',easing:'ease-out'}));
 host.classList.add('forecast-motion-surface');
 const shine=document.createElement('span');shine.className='forecast-shine';shine.setAttribute('aria-hidden','true');host.append(shine);
 const revealEnd=items.length?(items.length-1)*step+duration:0;
 // The soft ends are part of this small gradient. Only its transform and
 // opacity animate, including while the document is scrolling.
 Object.assign(shine.style, {
   background:'none', overflow:'hidden', opacity:'1', maskImage:'none', webkitMaskImage:'none'
 });
 const band = document.createElement('span');
 Object.assign(band.style, {
   position:'absolute', left:'0', top:'-30%', width:'54%', height:'160%',
   pointerEvents:'none', background:'radial-gradient(ellipse closest-side, rgba(255,252,241,.39), rgba(255,242,223,.14) 46%, transparent)'
 });
 shine.append(band);
 const a = band.animate([
   {opacity:0, transform:'translate3d(-138%,-10%,0) rotate(-32deg)', offset:0},
   {opacity:.62, transform:'translate3d(-116%,-9%,0) rotate(-32deg)', offset:400/4250, easing:'cubic-bezier(.55,0,1,.45)'},
   {opacity:.67, transform:'translate3d(67%,0,0) rotate(-32deg)', offset:.67},
   {opacity:0, transform:'translate3d(236%,12%,0) rotate(-32deg)', offset:1}
 ], {duration:4250, delay:revealEnd, iterations:1, fill:'backwards', easing:'linear'});
 runs.set(host,[...animations,a]);
 a.finished.then(()=>shine.remove(),()=>shine.remove());
}
export function moveMarker(host,percent){
 const marker=host.querySelector('.context-meter i');if(!marker||!Number.isFinite(percent))return;
 const target=Math.max(0,Math.min(100,percent)),from=positions.get(host)??50;
 marker.style.left=target+'%';positions.set(host,target);
 animateForecastMeter(marker, [{left:from+'%'},{left:target+'%'}]);
}
export function revealContext(host){
 const grid=host.closest('.forecast-context-grid,.ny-forecast-context-grid');
 const context=[...host.querySelectorAll('.context-metric,.context-target')];
 if(host.id==='forecast-context')reveal(grid,[...grid.querySelectorAll('#forecast .metric,#forecast .range-chart'),...context],250);
 else reveal(grid,[...grid.querySelectorAll('#ny-results .movement-grid>.metric'),...context],250);
}
