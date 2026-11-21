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
 // Rasterize the gradient once. The compositor moves the band under the
 // original feathered mask while the panel and its text stay stationary.
 const band = document.createElement('span');
 const gradient = getComputedStyle(shine).backgroundImage;
 Object.assign(shine.style, {background:'none', overflow:'hidden', opacity:'1'});
 Object.assign(band.style, {
   position:'absolute', inset:'-12% auto auto 0', width:'100%', height:'125%',
   backgroundImage:gradient, pointerEvents:'none'
 });
 shine.append(band);
 const a = band.animate([
   {opacity:0, transform:'translate3d(-100%,-12%,0)', offset:0},
   {opacity:.45, transform:'translate3d(-92%,-11%,0)', offset:400/4250, easing:'cubic-bezier(.55,0,1,.45)'},
   {opacity:0, transform:'translate3d(105%,12%,0)', offset:1}
 ], {duration:4250, delay:revealEnd, iterations:1, fill:'backwards', easing:'linear'});
 runs.set(host,[...animations,a]);
 let resumeTimer;
 const pauseDuringScroll = () => {
   if (a.playState === 'finished' || a.playState === 'idle') return;
   if (a.playState !== 'paused') {
     a.pause();
     shine.style.visibility = 'hidden';
   }
   clearTimeout(resumeTimer);
   resumeTimer = setTimeout(() => {
     shine.style.removeProperty('visibility');
     a.play();
   }, 140);
 };
 window.addEventListener('scroll', pauseDuringScroll, {passive:true, capture:true});
 const cleanup = () => {
   window.removeEventListener('scroll', pauseDuringScroll, true);
   clearTimeout(resumeTimer);
   shine.remove();
 };
 a.finished.then(cleanup, cleanup);
}
export function moveMarker(host,percent){
 const marker=host.querySelector('.context-meter i');if(!marker||!Number.isFinite(percent))return;
 const target=Math.max(0,Math.min(100,percent)),from=positions.get(host)??50;
 marker.style.left=target+'%';positions.set(host,target);
 if(!quiet())marker.animate([{left:from+'%'},{left:target+'%'}],{duration:780,easing:'cubic-bezier(.22,.7,.2,1)'});
}
export function revealContext(host){
 const grid=host.closest('.forecast-context-grid,.ny-forecast-context-grid');
 const context=[...host.querySelectorAll('.context-metric,.context-target')];
 if(host.id==='forecast-context')reveal(grid,[...grid.querySelectorAll('#forecast .metric,#forecast .range-chart'),...context],250);
 else reveal(grid,[...grid.querySelectorAll('#ny-results .movement-grid>.metric'),...context],250);
}
