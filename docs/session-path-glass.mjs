// One optical renderer per document. Each visible panel keeps a still image of its glass.
const root = document.documentElement;
const study = document.body.matches('.sp-bbox-study');
const simple = matchMedia('(prefers-reduced-transparency: reduce), (forced-colors: active)');
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const shells = [
  '.session-board-window', '#sessions-section', '#research-followup', '.overnight-timing-panel',
  '#bbox-return-details', '.quick-comparison-toggle', '#workspace > .panel:not(#projection):not(#conditions):not(#session-board)',
  'dialog', '#news-alert-toast', '#news-desk', '.sp-chat-panel', '.sp-chat-composer', '.sp-bbox-study .card'
].join(',');
const tiles = [
  '.compact-path-card', '#clear-sequence', '.quick-comparison-toggle > span',
  '.session-board-containment', '.forecast-context', '.context-metric', '.research-stat',
  '.br-decay', '.ot-controls > *', '.readouts > div', '.prior-path-options',
  '.workflow-tool-card', '.quick-comparison-card', '.quick-comparison-detail', '.cot-bias',
  '.cot-participant', '.cot-history', '.cot-methodology', '.cot-metric', '.news-source-card',
  '.news-headline', '.news-queue-card', '.news-desk-empty', '.news-desk-notice', '.sp-chat-message'
].join(',');
const records = new Map();
const dirty = new Set();
const buffer = document.createElement('canvas');
const silent = {bands: new Float32Array(6), level: 0};
const noPointer = {x: -10000, y: -10000};
let renderer, loading, imageURL, textureReady = false, frame = 0, scrollTimer;

function wallpaper() {
  let choice = Number(root.dataset.background);
  if (study && !choice) {
    try { choice = Number(window.parent.document.documentElement.dataset.background); } catch {}
    if (!choice) try { choice = Number(localStorage.getItem('sessionpath-last-background')) + 1; } catch {}
  }
  if (!Number.isInteger(choice) || choice < 1 || choice > 11) choice = 1;
  return new URL(`./assets/backgrounds/snowy-sunset-v${choice}.webp`, import.meta.url).href;
}

function refreshImage() {
  const url = wallpaper();
  if (study) root.style.setProperty('--sp-study-wallpaper', `url("${url}")`);
  if (!renderer || url === imageURL) return;
  imageURL = url;
  textureReady = false;
  const image = new Image();
  image.onload = () => {
    if (!renderer || imageURL !== url) return;
    renderer.setSource(image, image.naturalWidth, image.naturalHeight);
    textureReady = true;
    for (const state of records.values()) { state.key = ''; schedule(state); }
  };
  image.onerror = () => {
    if (url === imageURL) for (const state of records.values()) state.surface?.removeAttribute('data-painted');
  };
  image.src = url;
}

function enableRenderer() {
  if (!loading) loading = import('./vendor/liquid-glass/liquid-glass.js?v=all-panels-3').then(module => {
    renderer = module.createGlassRenderer(buffer);
    renderer.setDim(.08);
    refreshImage();
  }).catch(() => { /* Translucent CSS glass is available without WebGL. */ });
}

function schedule(state) {
  if (!state.visible || document.hidden || simple.matches) return;
  if (!renderer) enableRenderer();
  if (!textureReady) return;
  dirty.add(state);
  if (!frame) frame = requestAnimationFrame(paintNext);
}

function paintNext() {
  frame = 0;
  const state = dirty.values().next().value;
  if (!state) return;
  dirty.delete(state);
  if (textureReady && !document.hidden && !simple.matches && state.visible && state.host.isConnected) paint(state);
  if (dirty.size && !document.hidden && !simple.matches) frame = requestAnimationFrame(paintNext);
}

function glassShape(rect, origin, element, outer) {
  const halfWidth = rect.width / 2, halfHeight = rect.height / 2;
  const half = Math.min(halfWidth, halfHeight);
  const style = getComputedStyle(element);
  const corner = style.borderTopLeftRadius;
  const material = (key, fallback) => parseFloat(style.getPropertyValue('--glass-' + key)) || fallback;
  const radius = corner.endsWith('%') ? half * parseFloat(corner) / 50 : parseFloat(corner) || 0;
  const depth = Math.min(44, Math.max(half * .36, Math.min(half * .7, 14))) * material('depth', outer ? 1.07 : .73);
  return {x:rect.left-origin.left+halfWidth, y:rect.top-origin.top+halfHeight,
    halfWidth, halfHeight, radius: Math.min(radius,half), depth, rounding:Math.min(depth*.73,half*.9),
    dome:depth * .48 * material('dome', outer ? 1.1 : .85), ior:material('ior', outer ? 1.5 : 1.43),
    frost:material('frost', outer ? .16 : .28), chroma:material('chroma', .022),
    tint:[.09,.15,.24, outer ? .08 : .13], shadow:.65, pull:0, lens:[0,0,0,0], glow:0, press:0};
}

function paint(state) {
  const {host} = state;
  if (!state.surface || state.surface.parentNode !== host) {
    const surface = document.createElement('sessionpath-glass');
    surface.className = 'sp-liquid-surface';
    surface.setAttribute('aria-hidden','true');
    state.canvas = document.createElement('canvas');
    surface.append(state.canvas);
    host.append(surface);
    state.surface = surface;
    state.key = '';
  }
  const {surface, canvas} = state;
  if (host.scrollTop || host.scrollLeft || surface.style.translate)
    surface.style.translate = `${host.scrollLeft}px ${host.scrollTop}px`;
  const rect = surface.getBoundingClientRect();
  const w = Math.round(rect.width), h = Math.round(rect.height);
  if (w < 2 || h < 2) return;
  const shapes = [glassShape(rect, rect, host, true)];
  for (const tile of host.querySelectorAll(tiles)) {
    if (shapes.length >= renderer.maxPanes) break;
    if (tile.closest(shells) !== host) continue;
    const r = tile.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom <= Math.max(rect.top,0) || r.top >= Math.min(rect.bottom,innerHeight)) continue;
    shapes.push(glassShape(r, rect, tile, false));
  }
  const key = [imageURL, Math.round(rect.left), Math.round(rect.top), w, h, innerWidth, innerHeight,
    ...shapes.flatMap(s => [s.x,s.y,s.halfWidth,s.halfHeight,s.radius].map(Math.round))].join('/');
  if (key === state.key) return;
  // Spend pixels on readable DOM text. Limit the decorative bitmap on tall/mobile panels.
  const resolution = Math.min(1, Math.sqrt(640000 / (w*h)), 1800 / Math.max(w,h));
  renderer.resize(w,h,resolution);
  renderer.drawScene(0,rect);
  renderer.drawGlass(shapes,{x:w*.18, y:-h*.25},noPointer,silent);
  const ctx = canvas.getContext('2d', {alpha:false});
  if (!ctx) return;
  if (canvas.width !== buffer.width) canvas.width = buffer.width;
  if (canvas.height !== buffer.height) canvas.height = buffer.height;
  ctx.drawImage(buffer,0,0);
  surface.dataset.painted = '';
  state.key = key;
}

function release(state) {
  dirty.delete(state);
  state.surface?.remove();
  state.canvas = null;
  state.surface = null;
  state.key = '';
}

function setup() {
  const resize = new ResizeObserver(() => { for (const state of records.values()) schedule(state); });
  const visibility = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const state = records.get(entry.target);
      if (!state) continue;
      state.visible = entry.isIntersecting && entry.intersectionRect.height > 0 && entry.intersectionRect.width > 0;
      if (state.visible) schedule(state);
      else release(state);
    }
  });
  function register(host) {
    if (records.has(host)) return;
    const state = {host, visible:false, key:''};
    records.set(host,state);
    if (getComputedStyle(host).position === 'static') host.classList.add('sp-glass-static');
    host.classList.add('sp-glass-host');
    if (host.matches('#news-desk, #news-alert-toast')) attachNewsLight(host);
    visibility.observe(host);
    resize.observe(host);
  }
  function discover(el) {
    if (el.matches(shells)) register(el);
    el.querySelectorAll(shells).forEach(register);
  }
  discover(document.body);
  new MutationObserver(recordsChanged => {
    let removed = false;
    for (const m of recordsChanged) {
      if (m.type === 'attributes' && m.target.matches(shells)) register(m.target);
      for (const node of m.addedNodes) if (node.nodeType === 1 && node.localName !== 'sessionpath-glass') discover(node);
      for (const node of m.removedNodes) if (node.nodeType === 1) removed = true;
      const state = records.get(m.target.closest?.(shells));
      if (state && (m.type === 'attributes' || [...m.addedNodes,...m.removedNodes].some(node =>
        node.nodeType === 1 && (node.localName !== 'sessionpath-glass' || state.surface === node && node.parentNode !== state.host)))) schedule(state);
    }
    if (removed) for (const [host, state] of records) if (!host.isConnected) {
      visibility.unobserve(host); resize.unobserve(host); release(state); records.delete(host);
    }
  }).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','open','hidden','data-state']});
  const updateVisible = () => { for (const state of records.values()) schedule(state); };
  window.addEventListener('resize',updateVisible,{passive:true});
  // A swipe or scroll performs one final layout pass once the view settles.
  window.addEventListener('scroll',() => { clearTimeout(scrollTimer);scrollTimer=setTimeout(updateVisible,85); },{capture:true,passive:true});
  document.addEventListener('visibilitychange',updateVisible);
  for (const event of ['animationend','transitionend','toggle']) document.addEventListener(event,updateVisible,true);
  simple.addEventListener('change',() => {
    if (simple.matches) for (const state of records.values()) release(state);
    else updateVisible();
  });
  new MutationObserver(refreshImage).observe(root,{attributes:true,attributeFilter:['data-background']});
  refreshImage();
}

// The only moving highlight belongs to news. Moving across forecasts never repaints a lens.
let litNews;
function clearLight() {
  litNews?.removeAttribute('data-news-light');
  litNews = null;
}
function attachNewsLight(host) {
  host.addEventListener('pointermove', event => {
    if (simple.matches || calm.matches || event.pointerType === 'touch') return;
    if (litNews !== host) clearLight();
    const rect = host.getBoundingClientRect();
    host.style.setProperty('--sp-news-x', (event.clientX-rect.left)+'px');
    host.style.setProperty('--sp-news-y', (event.clientY-rect.top)+'px');
    host.dataset.newsLight = '';
    litNews = host;
  }, {passive:true});
  host.addEventListener('pointerleave', clearLight, {passive:true});
  host.addEventListener('close', clearLight);
}
window.addEventListener('blur',clearLight);
calm.addEventListener('change',clearLight);
simple.addEventListener('change',clearLight);
buffer.addEventListener('webglcontextlost',event=>{
  event.preventDefault();
  renderer = null; textureReady = false;
  for (const state of records.values()) release(state);
});
buffer.addEventListener('webglcontextrestored',()=>{
  loading = null; imageURL = null;
  if (!simple.matches) enableRenderer();
});
if ('IntersectionObserver' in window && 'ResizeObserver' in window) {
  if (study || root.dataset.startup === 'ready') setup();
  else {
    const ready = new MutationObserver(()=>{if(root.dataset.startup==='ready'){ready.disconnect();setup();}});
    ready.observe(root,{attributes:true,attributeFilter:['data-startup']});
  }
}
