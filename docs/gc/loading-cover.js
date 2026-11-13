// Inlined immediately after the cover in index.html, before module loading starts.
(()=>{
 const root=document.documentElement,cover=document.getElementById('sessionpath-loading');
 const note=document.getElementById('loading-note'),retry=document.getElementById('loading-retry');
 const title=document.getElementById('loading-title'),typed=document.getElementById('loading-typed'),emblem=document.getElementById('loading-emblem');
 const transferKey='sessionpath-loading-transition';
 const markets={GC:{name:'Gold'}};
 const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches||root.classList.contains('motion-paused')||document.body.classList.contains('motion-paused');
 const typingDuration = 815;
 let began=performance.now(),generation=0,delay,finish,watchdog,navigating=false,typeTimer,audioContext,keyTap,bootChime;
 function enableTypingAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return false;
  try {
   audioContext ??= new AudioContext();
   if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {});
   return true;
  } catch {
   return false;
  }
 }

 function playKeyTap() {
  if (audioContext?.state !== 'running') return;
  try {
   if (!keyTap) {
    const rate = audioContext.sampleRate;
    keyTap = audioContext.createBuffer(1, Math.ceil(rate * .035), rate);
    const samples = keyTap.getChannelData(0);
    let body = 0;
    for (let i = 0; i < samples.length; i++) {
     const time = i / rate;
     const noise = Math.random() * 2 - 1;
     body += (noise - body) * .14;
     const press = Math.exp(-time / .0035);
     const release = time < .008 ? 0 : Math.exp(-((time - .008) / .0025)) * .42;
     samples[i] = (noise * .14 + body * .56) * (press + release) * Math.min(1, i / 6);
    }
   }
   const tap = audioContext.createBufferSource();
   tap.buffer = keyTap;
   tap.playbackRate.value = .92 + Math.random() * .16;
   tap.connect(audioContext.destination);
   tap.onended = () => tap.disconnect();
   tap.start();
  } catch {
   // Audio may be blocked by the browser. The transition can still finish.
  }
 }

 // Game Boy channel 1 startup pitches, with the Color model's four-frame spacing.
 // https://guydunton.com/articles/gameboy-first-sounds/
 const bootPitchGap = 4 * 70224 / 4194304;
 const bootEnvelopeStep = 3 / 64;

 function playBootChime(secondsUntilTitle) {
  try {
   if (!bootChime) {
    const rate = audioContext.sampleRate;
    bootChime = audioContext.createBuffer(1, Math.ceil(rate * (bootPitchGap + 15 * bootEnvelopeStep)), rate);
    const samples = bootChime.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
     const time = i / rate;
     const first = time < bootPitchGap;
     const age = first ? time : time - bootPitchGap;
     const frequency = 131072 / (2048 - (first ? 0x783 : 0x7c1));
     const phase = age * frequency % 1;
     const volume = Math.max(0, 15 - Math.floor(age / bootEnvelopeStep)) / 15;
     const attack = Math.min(1, age / .001);
     const blend = first ? Math.min(1, (bootPitchGap - time) / .001) : 1;
     samples[i] = (phase < .5 ? 1 : -1) * volume * attack * blend * .09;
    }
   }
   const chime = audioContext.createBufferSource();
   const delay = Math.max(0, secondsUntilTitle - bootPitchGap);
   chime.buffer = bootChime;
   chime.connect(audioContext.destination);
   return new Promise(resolve => {
    const finish = () => {
     chime.onended = null;
     clearTimeout(watchdog);
     chime.disconnect();
     resolve();
    };
    // If the browser interrupts playback, let the user get to their selected market.
    const watchdog = setTimeout(() => {
     try { chime.stop(); } catch {}
     finish();
    }, (delay + bootChime.duration) * 1000 + 250);
    chime.onended = finish;
    try {
     chime.start(audioContext.currentTime + delay);
    } catch {
     finish();
    }
   });
  } catch {
   return undefined;
  }
 }

 function present(market, elapsed = 0, sound = false) {
  clearTimeout(typeTimer);
  const info = markets[market];
  const text = info?.name || 'SessionPath center';
  title.setAttribute('aria-label', text);
  title.dataset.fullTitle = text;
  emblem.hidden = !info;
  if (info) emblem.dataset.market = market;

  if (reduced()) {
   typed.textContent = text;
   return Promise.resolve();
  }

  const playTyping = sound && enableTypingAudio();
  let shown = 0;
  let chimeFinished;
  function tick() {
   const elapsedNow = performance.now() - began;
   const count = Math.min(text.length, Math.floor(text.length * elapsedNow / typingDuration));
   typed.textContent = text.slice(0, count);
   if (playTyping && count > shown && text.slice(shown, count).trim()) {
    playKeyTap();
    if (!chimeFinished && audioContext.state === 'running') {
     chimeFinished = playBootChime(Math.max(0, typingDuration - elapsedNow) / 1000);
    }
   }
   shown = count;
   if (elapsedNow < typingDuration) typeTimer = setTimeout(tick, Math.min(16, typingDuration - elapsedNow));
  }
  tick();
  // Keep the outgoing cover visible until both typing and the final ding have finished.
  const keyTapTail = playTyping ? 40 : 0;
  return new Promise(resolve => {
   setTimeout(() => resolve(chimeFinished), Math.max(0, typingDuration - elapsed) + keyTapTail);
  });
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
  clear();clearTimeout(typeTimer);typed.textContent=title.dataset.fullTitle;generation++;root.dataset.loadingCover='error';cover.setAttribute('aria-busy','false');
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
   finish=setTimeout(()=>{if(run!==generation)return;cover.hidden=true;delete root.dataset.loadingCover;unlock();},quiet?0:900);
  })),quiet?0:Math.max(0,typingDuration-(performance.now()-began)));
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
