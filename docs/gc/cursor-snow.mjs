// Lightweight, decorative particles. Never intercept chart or form interactions.
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const layer = document.createElement('div');
layer.className = 'cursor-snow-layer';
layer.setAttribute('aria-hidden', 'true');
document.body.append(layer);
const active = new Map();
const paused = () => reduced.matches || document.hidden ||
  document.documentElement.classList.contains('motion-paused') ||
  document.body.classList.contains('motion-paused');
const remove = el => { active.get(el)?.cancel(); active.delete(el); el.remove(); };
const clear = () => [...active.keys()].forEach(remove);
const shape = '<svg viewBox="-10 -10 20 20" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"><path d="M0-8V8M-6.93-4L6.93 4M-6.93 4L6.93-4M-2-6L0-4L2-6M-2 6L0 4L2 6M-6.2-1.3L-3.46-2L-4.2-4.7M6.2 1.3L3.46 2L4.2 4.7M-6.2 1.3L-3.46 2L-4.2 4.7M6.2-1.3L3.46-2L4.2-4.7"/></svg>';
function flake(x, y, burst = false, angle = 0) {
  if (active.size >= 384) remove(active.keys().next().value);
  const el = document.createElement('span');
  el.className = 'cursor-snow-flake';
  const size = burst ? 7 + Math.random()*5 : 6 + Math.random()*5;
  el.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size}px`;
  el.innerHTML = shape;
  layer.append(el);
  const reach = 24 + Math.random()*29;
  const dx = burst ? Math.cos(angle)*reach : (Math.random()-.5)*28;
  const dy = burst ? Math.sin(angle)*reach + 16 : 26 + Math.random()*24;
  const turn = (Math.random()-.5)*130;
  const animation = el.animate([
    {transform:'translate(-50%, -50%) scale(.65) rotate(0deg)',opacity:0},
    {opacity:burst?.8:.58,offset:.14},
    {transform:`translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.35) rotate(${turn}deg)`,opacity:0}
  ],{duration:burst?850:1000,easing:'cubic-bezier(.15,.5,.35,1)',fill:'both'});
  active.set(el, animation);
  animation.onfinish = () => remove(el);
}
let last = 0;
document.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse' || paused() || e.buttons) return;
  const now = performance.now();
  if (now-last < 65) return;
  last = now;
  for (let i=0;i<8;i++) flake(e.clientX+(Math.random()-.5)*36,e.clientY+(Math.random()-.5)*36);
},{passive:true});
document.addEventListener('click', e => {
  if (paused() || e.detail === 0) return;
  for (let i=0;i<80;i++) flake(e.clientX,e.clientY,true,i*Math.PI/40 + Math.random()*.05);
},{passive:true,capture:true});
const stopIfPaused = () => { if(paused()) clear(); };
new MutationObserver(stopIfPaused).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
new MutationObserver(stopIfPaused).observe(document.body,{attributes:true,attributeFilter:['class']});
reduced.addEventListener('change',stopIfPaused);
document.addEventListener('visibilitychange',stopIfPaused);
window.addEventListener('blur',clear);
