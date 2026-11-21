const root = document.documentElement;
const shells = [
  '.session-board-window', '#sessions-section', '#research-followup', '.overnight-timing-panel',
  '#bbox-return-details', '.quick-comparison-toggle', '#workspace > .panel:not(#projection):not(#conditions):not(#session-board)',
  'dialog', '.sp-bbox-study .card'
].join(',');
const excluded = '#news-desk, #news-alert-toast, #sessionpath-assistant';
const tiles = [
  '.compact-path-card', '#clear-sequence', '.quick-comparison-toggle > span', '.session-board-containment',
  '.forecast-context', '.context-metric', '.research-stat', '.br-decay', '.ot-controls > *', '.readouts > div',
  '.prior-path-options', '.workflow-tool-card', '.quick-comparison-card', '.quick-comparison-detail',
  '.cot-bias', '.cot-participant', '.cot-history', '.cot-methodology', '.cot-metric'
].join(',');
const candidates = shells + ',' + tiles;
const study = document.body.matches('.sp-bbox-study');
const simple = matchMedia('(prefers-reduced-transparency: reduce), (forced-colors: active)');
const canvas = document.createElement('canvas');
canvas.className = 'sp-glass-optics';
canvas.setAttribute('aria-hidden','true');
document.body.prepend(canvas);
const ctx = canvas.getContext('2d');
const scene = document.createElement('canvas');
const background = scene.getContext('2d', {alpha:false, willReadFrequently:true});
const tracked = new Set(), visible = new Set(), sizes = new WeakMap(), rims = new WeakMap();
const animating = new Set();
let sourcePixels, output, pixels;
let texture, sourceURL, frame = 0, viewportWidth = 0, viewportHeight = 0, scale = 1;

// Decode and scale the wallpaper once per image or viewport size. During a
// scroll only the slim bevels sample this cache at their current coordinates.
function cacheScene() {
  if (!texture || !ctx || !background || simple.matches) return;
  viewportWidth = root.clientWidth;
  viewportHeight = window.innerHeight;
  if (!viewportWidth || !viewportHeight) return;
  scale = Math.min(1, 680 / viewportWidth, 620 / viewportHeight);
  const w = Math.max(1, Math.round(viewportWidth * scale)), h = Math.max(1, Math.round(viewportHeight * scale));
  canvas.width = scene.width = w;
  canvas.height = scene.height = h;
  const cover = Math.max(w / texture.naturalWidth, h / texture.naturalHeight);
  const iw = texture.naturalWidth * cover, ih = texture.naturalHeight * cover;
  background.drawImage(texture, (w-iw)/2, (h-ih)/2, iw, ih);
  const tint = background.createLinearGradient(0,0,0,h);
  tint.addColorStop(0,study?'#111c33ad':'rgba(8,16,34,.43)');
  if (!study) tint.addColorStop(.42,'rgba(8,18,36,.15)');
  tint.addColorStop(1,study?'#0d1935a8':'rgba(7,16,34,.24)');
  background.fillStyle = tint;
  background.fillRect(0,0,w,h);
  sourcePixels = new Uint32Array(background.getImageData(0,0,w,h).data.buffer);
  output = ctx.createImageData(w,h);
  pixels = new Uint32Array(output.data.buffer);
  schedule();
}
function schedule() {
  if (!frame && !document.hidden && !simple.matches && texture && ctx) frame = requestAnimationFrame(draw);
}
// A bevel template contains only its perimeter pixels and their sampling offsets.
// Build it on resize. Scrolling just changes the origin of those same samples.
function bevel(panel, width, height, radius) {
  const previous = rims.get(panel);
  if (previous && previous.width === width && previous.height === height && previous.radius === radius) return previous.points;
  const inner = panel.classList.contains('sp-glass-tile');
  const rim = Math.min(Math.max(2, Math.round((inner ? 7 : 17) * scale)), width / 5, height / 5);
  const corner = Math.min(radius, width / 2, height / 2);
  const points = [];
  for (let y = 0; y < height; y++) {
    const py = y + .5 - height / 2;
    const qy = Math.abs(py) - height / 2 + corner;
    const end = Math.ceil(corner + rim + 1);
    for (let x = 0; x < width; x++) {
      if (height / 2 - Math.abs(py) > end && x === end && width > end * 2) x = width - end;
      const px = x + .5 - width / 2;
      const qx = Math.abs(px) - width / 2 + corner;
      const nx = Math.max(0, qx), ny = Math.max(0, qy), n = Math.hypot(nx, ny);
      const depth = corner - n - Math.min(Math.max(qx, qy), 0);
      if (depth < 0 || depth >= rim) continue;
      const strength = 1 - depth / rim, bend = rim * .9 * strength;
      const sx = Math.round(-Math.sign(px) * (n ? nx / n : Number(qx >= qy)) * bend);
      const sy = Math.round(-Math.sign(py) * (n ? ny / n : Number(qy > qx)) * bend);
      points.push(x, y, sx, sy, Math.round((inner ? 140 : 210) * strength));
    }
  }
  const data = Int32Array.from(points);
  rims.set(panel, {width, height, radius, points:data});
  return data;
}
function draw() {
  frame = 0;
  if (!sourcePixels || !texture || document.hidden || simple.matches) return;
  if (root.clientWidth !== viewportWidth || innerHeight !== viewportHeight) { cacheScene(); return; }
  const w = canvas.width, h = canvas.height;
  pixels.fill(0);
  for (const panel of visible) {
    if (!panel.isConnected) continue;
    const rect = panel.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.bottom <= 0 || rect.top >= viewportHeight || rect.right <= 0 || rect.left >= viewportWidth) continue;
    const left = Math.round(rect.left * scale), top = Math.round(rect.top * scale);
    const dialog = panel.closest('dialog');
    const clip = dialog && dialog !== panel ? dialog.getBoundingClientRect() : null;
    const minX = clip ? Math.max(0, Math.ceil(clip.left * scale)) : 0;
    const minY = clip ? Math.max(0, Math.ceil(clip.top * scale)) : 0;
    const maxX = clip ? Math.min(w, Math.floor(clip.right * scale)) : w;
    const maxY = clip ? Math.min(h, Math.floor(clip.bottom * scale)) : h;
    const size = sizes.get(panel);
    if (!size?.width || !size.height) continue;
    const points = bevel(panel, Math.round(size.width * scale), Math.round(size.height * scale), Math.round(size.radius * scale));
    // A dialog can scale during its opening animation. Reuse its layout-size
    // template throughout the animation instead of building one per frame.
    const zoomX = Math.abs(rect.width - size.width) > 1 ? rect.width / size.width : 1;
    const zoomY = Math.abs(rect.height - size.height) > 1 ? rect.height / size.height : 1;
    for (let i = 0; i < points.length; i += 5) {
      const x = left + Math.round(points[i] * zoomX), y = top + Math.round(points[i + 1] * zoomY);
      if (x < minX || x >= maxX || y < minY || y >= maxY) continue;
      const sx = Math.min(w - 1, Math.max(0, x + points[i + 2]));
      const sy = Math.min(h - 1, Math.max(0, y + points[i + 3]));
      pixels[y * w + x] = (sourcePixels[sy * w + sx] & 0x00ffffff) | (points[i + 4] << 24);
    }
  }
  ctx.putImageData(output, 0, 0);
  if (animating.size) schedule();
}
function measure(panel) {
  const width = panel.offsetWidth, height = panel.offsetHeight;
  const value = getComputedStyle(panel).borderTopLeftRadius;
  const radius = value.endsWith('%') ? Math.min(width,height) * parseFloat(value)/100 : parseFloat(value) || 0;
  sizes.set(panel, {width, height, radius});
}
const geometry = new ResizeObserver(entries=>{
  for (const {target} of entries) if (visible.has(target)) measure(target);
  schedule();
});
const visibility = new IntersectionObserver(entries=>{
  for (const {target,isIntersecting} of entries) {
    if (isIntersecting) { visible.add(target); measure(target); }
    else { visible.delete(target); animating.delete(target); }
  }
  schedule();
});
function register(panel) {
  if (tracked.has(panel) || panel.closest(excluded)) return;
  const outer = panel.matches(shells);
  if (!outer && !panel.parentElement?.closest(shells)) return;
  tracked.add(panel);
  panel.classList.add(outer ? 'sp-glass-host' : 'sp-glass-tile');
  geometry.observe(panel);
  visibility.observe(panel);
}
document.querySelectorAll(candidates).forEach(register);
new MutationObserver(changes=>{
  let removed=false;
  for (const change of changes) {
    if (change.type==='attributes') { if (change.target.matches(candidates)) register(change.target); continue; }
    for (const node of change.addedNodes) if (node.nodeType===1 && node.namespaceURI===document.body.namespaceURI) {
      if (node.matches(candidates)) register(node);
      node.querySelectorAll(candidates).forEach(register);
    }
    if (change.removedNodes.length && !removed) removed=Array.from(change.removedNodes).some(n=>n.nodeType===1);
  }
  if (removed) for (const panel of tracked) if (!panel.isConnected) {
    geometry.unobserve(panel); visibility.unobserve(panel); tracked.delete(panel); visible.delete(panel); animating.delete(panel);
    schedule();
  }
}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
let wallpaperRoot = root;
if (study) try { wallpaperRoot=parent.document.documentElement; } catch {}
function refreshWallpaper() {
  let index=Number(wallpaperRoot.dataset.background);
  if (!index && study) try { index=Number(localStorage.getItem('sessionpath-last-background'))+1; } catch {}
  if (!Number.isInteger(index) || index<1 || index>11) index=1;
  const url=new URL('./assets/backgrounds/snowy-sunset-v'+index+'.webp',import.meta.url).href;
  if (study) root.style.setProperty('--sp-study-wallpaper','url("'+url+'")');
  if (simple.matches || !ctx || !background || url===sourceURL) return;
  sourceURL=url;
  texture=null;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const image=new Image();
  image.onload=()=>{ if (sourceURL===url) {texture=image; cacheScene();} };
  image.src=url;
}
new MutationObserver(refreshWallpaper).observe(wallpaperRoot,{attributes:true,attributeFilter:['data-background']});
refreshWallpaper();
window.addEventListener('scroll',schedule,{passive:true,capture:true});
window.addEventListener('resize',cacheScene,{passive:true});
window.visualViewport?.addEventListener('scroll',schedule,{passive:true});
window.addEventListener('pageshow',schedule);
document.addEventListener('visibilitychange',schedule);
// Follow a moving panel throughout its entrance or exit. Decorative looping
// animations elsewhere (such as the news ticker) never start a rendering loop.
function trackMotion(event) {
  const panel = event.target;
  if (!tracked.has(panel)) return;
  const moving = panel.getAnimations().some(animation =>
    animation.effect?.getTiming().iterations !== Infinity &&
    animation.playState === 'running' &&
    animation.effect.getKeyframes().some(key => key.transform || key.translate || key.scale));
  if (moving && visible.has(panel)) animating.add(panel);
  else animating.delete(panel);
  schedule();
}
for (const event of ['transitionrun','transitionend','transitioncancel','animationstart','animationend','animationcancel']) {
  document.addEventListener(event,trackMotion);
}
simple.addEventListener('change',()=>{
  if (simple.matches) {
    cancelAnimationFrame(frame); frame=0;
    texture=null; sourceURL=null; sourcePixels=null; pixels=null; output=null;
    canvas.width=scene.width=1;
  }
  else refreshWallpaper();
});
