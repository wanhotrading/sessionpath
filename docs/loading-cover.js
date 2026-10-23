// Inlined immediately after the cover in index.html, before module loading starts.
(()=>{
 const root=document.documentElement,cover=document.getElementById('sessionpath-loading');
 const note=document.getElementById('loading-note'),retry=document.getElementById('loading-retry');
 let began=performance.now(),generation=0,delay,finish,watchdog,navigating=false;
 const locked=new Map();
 function lock(){for(const el of document.body.children){if(el===cover||['SCRIPT','STYLE','NOSCRIPT'].includes(el.tagName))continue;if(!locked.has(el))locked.set(el,el.inert);el.inert=true;}}
 function unlock(){for(const [el,value] of locked)el.inert=value;locked.clear();}
 function clear(){clearTimeout(delay);clearTimeout(finish);clearTimeout(watchdog);}
 function show(){
  clear();generation++;began=performance.now();cover.hidden=false;
  cover.style.removeProperty('opacity');root.dataset.loadingCover='loading';
  cover.setAttribute('aria-busy','true');note.hidden=true;retry.hidden=true;lock();
  watchdog=setTimeout(()=>failure('Loading is taking longer than usual. You can retry.'),30000);
 }
 function failure(message){
  if(cover.hidden)return;
  clear();generation++;root.dataset.loadingCover='error';cover.setAttribute('aria-busy','false');
  note.textContent=message;note.hidden=false;retry.hidden=false;lock();
 }
 function dismiss(){
  if(cover.hidden||navigating||root.dataset.loadingCover==='fading')return;
  clear();const run=++generation;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches||root.classList.contains('motion-paused')||document.body.classList.contains('motion-paused');
  delay=setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
   if(run!==generation||navigating)return;
   // The ready panels have completed layout before they become visible behind the fade.
   root.dataset.loadingCover='fading';cover.setAttribute('aria-busy','false');
   finish=setTimeout(()=>{if(run!==generation)return;cover.hidden=true;delete root.dataset.loadingCover;unlock();},reduced?0:560);
  })),reduced?0:Math.max(0,450-(performance.now()-began)));
 }
 function state(){
  if(navigating)return;
  if(root.dataset.startup==='ready')dismiss();
  else if(root.dataset.startup==='failed')failure('SessionPath could not finish loading. Please retry.');
 }
 retry.addEventListener('click',()=>location.reload());
 document.addEventListener('sessionpath:instrument-change',()=>{navigating=true;show();});
 document.addEventListener('DOMContentLoaded',()=>{lock();state();},{once:true});
 new MutationObserver(state).observe(root,{attributes:true,attributeFilter:['data-startup']});
 // A history-restored page must not retain the outgoing market's black cover.
 window.addEventListener('pageshow',event=>{if(event.persisted){navigating=false;show();state();}});
 show();state();
})();
