const positions=new WeakMap(),runs=new WeakMap();
const quiet=()=>matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.classList.contains('motion-paused')||document.body.classList.contains('motion-paused');
export function tint(el,value,baseline,label='Same-market, same-window earlier history'){
 if(!el)return; el.removeAttribute('data-relative');
 if(!Number.isFinite(value)||!Number.isFinite(baseline))return;
 el.dataset.relative=Math.abs(value-baseline)<1e-9?'equal':value<baseline?'below':'above';
 el.title=`${label}: ${baseline.toFixed(4)}. ${el.dataset.relative} baseline. Colours compare magnitude, not trade direction.`;
}
export function reveal(host,nodes,gap=250){
 if(!host)return;
 (runs.get(host)||[]).forEach(a=>a.cancel());runs.delete(host);
 host.querySelectorAll(':scope > .forecast-shine').forEach(x=>x.remove());
 if(quiet())return;
 const items=[...nodes].filter(Boolean),duration=150,step=gap;
 const animations=items.map((el,i)=>el.animate([{opacity:0,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{duration,delay:i*step,fill:'backwards',easing:'ease-out'}));
 host.classList.add('forecast-motion-surface');
 const shine=document.createElement('span');shine.className='forecast-shine';shine.setAttribute('aria-hidden','true');host.append(shine);
 const revealEnd=items.length?(items.length-1)*step+duration:0;
 const a=shine.animate([
  {opacity:0,backgroundPosition:'140% 140%',offset:0},
  {opacity:.45,backgroundPosition:'136% 136%',offset:400/4250,easing:'cubic-bezier(.55,0,1,.45)'},
  {opacity:0,backgroundPosition:'-40% -40%',offset:1}
 ],{duration:4250,delay:revealEnd,iterations:1,fill:'backwards',easing:'linear'});
 runs.set(host,[...animations,a]);
 a.onfinish=()=>shine.remove();
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
 else reveal(host,context,250);
}
