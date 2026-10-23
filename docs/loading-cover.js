// Inlined immediately after the cover in index.html, before module loading starts.
(()=>{
 const root=document.documentElement,cover=document.getElementById('sessionpath-loading');
 const note=document.getElementById('loading-note'),retry=document.getElementById('loading-retry');
 const title=document.getElementById('loading-title'),typed=document.getElementById('loading-typed'),coin=document.getElementById('loading-coin');
 const transferKey='sessionpath-loading-transition';
 const markets={CL:{name:'Crude oil',image:'assets/emblems/cl-acrylic-v1.webp'},NQ:{name:'Nasdaq 100',image:'assets/emblems/nq-acrylic-v1.webp'}};
 const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches||root.classList.contains('motion-paused')||document.body.classList.contains('motion-paused');
 let began=performance.now(),generation=0,delay,finish,watchdog,navigating=false,typeTimer,spin,audio;
 function cling(){
  try{
   const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;
   audio??=new Audio();void audio.resume().catch(()=>{});
   const t=audio.currentTime;
   [1760,2640,4224].forEach((frequency,i)=>{const o=audio.createOscillator(),g=audio.createGain();o.type='sine';o.frequency.setValueAtTime(frequency,t);o.frequency.exponentialRampToValueAtTime(frequency*.97,t+.65);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.11/(i+1),t+.008);g.gain.exponentialRampToValueAtTime(.0001,t+.75);o.connect(g);g.connect(audio.destination);o.start(t);o.stop(t+.8);});
  }catch{/* Sound must never block switching markets. */}
 }
 function present(market,elapsed=0,sound=false){
  clearTimeout(typeTimer);spin?.cancel();
  const info=markets[market],text=info?.name||'SessionPath center';
  title.setAttribute('aria-label',text);title.dataset.fullTitle=text;
  coin.hidden=!info;
  if(info){coin.src=info.image;coin.alt='';}
  const tick=()=>{const elapsedNow=performance.now()-began;typed.textContent=text.slice(0,Math.min(text.length,Math.floor(text.length*elapsedNow/815)));if(elapsedNow<815)typeTimer=setTimeout(tick,Math.min(16,815-elapsedNow));};
  if(reduced())typed.textContent=text;else tick();
  let coinDone=Promise.resolve();
  if(info&&!reduced()&&elapsed<600){
   const started=began;
   coinDone=Promise.race([coin.decode().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,1500))]).then(()=>{
    if(started!==began)return;
    spin=coin.animate([{transform:'rotateY(0deg)'},{transform:'rotateY(1080deg)'}],{duration:600,easing:'cubic-bezier(.15,.65,.25,1)',fill:'both'});
    return spin.finished.catch(()=>{});
   });
  }
  if(sound)cling();
  return Promise.all([coinDone,new Promise(resolve=>setTimeout(resolve,reduced()?0:Math.max(0,815-elapsed)))]);
 }
 const locked=new Map();
 function lock(){for(const el of document.body.children){if(el===cover||['SCRIPT','STYLE','NOSCRIPT'].includes(el.tagName))continue;if(!locked.has(el))locked.set(el,el.inert);el.inert=true;}}
 function unlock(){for(const [el,value] of locked)el.inert=value;locked.clear();}
 function clear(){clearTimeout(delay);clearTimeout(finish);clearTimeout(watchdog);}
 function show(market=null,elapsed=0,sound=false){
  clear();generation++;began=performance.now()-elapsed;cover.hidden=false;
  cover.style.removeProperty('opacity');root.dataset.loadingCover='loading';
  cover.setAttribute('aria-busy','true');note.hidden=true;retry.hidden=true;lock();const presentation=present(market,elapsed,sound);
  watchdog=setTimeout(()=>failure('Loading is taking longer than usual. You can retry.'),30000);
  return presentation;
 }
 function failure(message){
  if(cover.hidden)return;
  clear();generation++;root.dataset.loadingCover='error';cover.setAttribute('aria-busy','false');
  note.textContent=message;note.hidden=false;retry.hidden=false;lock();
 }
 function dismiss(){
  if(cover.hidden||navigating||root.dataset.loadingCover==='fading')return;
  clear();const run=++generation;
  const quiet=reduced();
  delay=setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
   if(run!==generation||navigating)return;
   // The ready panels have completed layout before they become visible behind the fade.
   root.dataset.loadingCover='fading';cover.setAttribute('aria-busy','false');
   finish=setTimeout(()=>{if(run!==generation)return;cover.hidden=true;delete root.dataset.loadingCover;unlock();},quiet?0:560);
  })),quiet?0:Math.max(0,815-(performance.now()-began)));
 }
 function state(){
  if(navigating)return;
  if(root.dataset.startup==='ready')dismiss();
  else if(root.dataset.startup==='failed')failure('SessionPath could not finish loading. Please retry.');
 }
 retry.addEventListener('click',()=>location.reload());
 document.addEventListener('sessionpath:instrument-change',event=>{
  const market=event.detail?.instrument;if(!markets[market])return;
  navigating=true;try{sessionStorage.setItem(transferKey,JSON.stringify({market,at:Date.now()}));}catch{}
  event.detail.finished=show(market,0,true);
 });
 document.addEventListener('DOMContentLoaded',()=>{lock();state();},{once:true});
 new MutationObserver(state).observe(root,{attributes:true,attributeFilter:['data-startup']});
 // A history-restored page must not retain the outgoing market's black cover.
 window.addEventListener('pageshow',event=>{if(event.persisted){navigating=false;show();state();}});
 let transfer=null;try{transfer=JSON.parse(sessionStorage.getItem(transferKey)||'null');sessionStorage.removeItem(transferKey);}catch{}
 const age=transfer?Date.now()-transfer.at:Infinity;
 if(transfer&&markets[transfer.market]&&age>=0&&age<15000&&new URL(location.href).searchParams.get('instrument')===transfer.market)show(transfer.market,age);
 else show();
 state();
})();
