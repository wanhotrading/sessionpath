// The map describes the bevel only. The browser samples the actual backdrop
// when it composites each frame, including native scrolling and panel transforms.
const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-transparency: reduce), (forced-colors: active)');
const shells = [
  '.session-board-window', '#sessions-section', '#research-followup', '.overnight-timing-panel',
  '#bbox-return-details', '.quick-comparison-toggle', '#workspace > .panel:not(#projection):not(#conditions):not(#session-board)',
  'dialog', '.sp-bbox-study .card'
].join(',');
const tiles = [
  '.compact-path-card', '#clear-sequence', '.quick-comparison-toggle > span', '.session-board-containment',
  '.forecast-context', '.context-metric', '.research-stat', '.br-decay', '.ot-controls > *',
  '.readouts > div', '.prior-path-options', '.workflow-tool-card', '.quick-comparison-card',
  '.quick-comparison-detail', '.cot-bias', '.cot-participant', '.cot-history', '.cot-methodology', '.cot-metric'
].join(',');
const candidates = shells + ',' + tiles;
const excluded = '#news-desk, #news-alert-toast, #sessionpath-assistant';
const svgNS = 'http://www.w3.org/2000/svg';
const maps = new Map();
let serial = 0;

function svgNode(name, attributes = {}) {
  const node = document.createElementNS(svgNS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

function bevelMap(width, height, radius, rim) {
  const canvas = document.createElement('canvas');
  const density = Math.min(1, 420 / Math.max(width, height));
  canvas.width = Math.max(2, Math.round(width * density));
  canvas.height = Math.max(2, Math.round(height * density));
  const context = canvas.getContext('2d');
  const image = context.createImageData(canvas.width, canvas.height);
  // R and G encode horizontal and vertical offsets. Neutral glass leaves
  // the centre clear. Only the rounded perimeter bends the background.
  new Uint32Array(image.data.buffer).fill(0xff808080);
  const dx = width / canvas.width, dy = height / canvas.height;
  for (let y = 0; y < canvas.height; y++) {
    const py = (y + .5) * dy - height / 2;
    const qy = Math.abs(py) - (height / 2 - radius);
    const margin = Math.ceil((rim + radius + 1) / dx);
    for (let x = 0; x < canvas.width; x++) {
      if (height / 2 - Math.abs(py) > rim + radius && x === margin && canvas.width > 2 * margin) x = canvas.width - margin;
      const px = (x + .5) * dx - width / 2;
      const qx = Math.abs(px) - (width / 2 - radius);
      const nx = Math.max(0, qx), ny = Math.max(0, qy);
      const norm = Math.hypot(nx, ny);
      const depth = radius - norm - Math.min(Math.max(qx, qy), 0);
      if (depth < 0 || depth >= rim) continue;
      const t = depth / rim;
      const bend = 123 * Math.sin(Math.PI * (t * .88 + .12)) * (1 - t) ** 1.15;
      const index = 4 * (y * canvas.width + x);
      image.data[index] = 128 - Math.sign(px) * (norm ? nx / norm : Number(qx >= qy)) * bend;
      image.data[index + 1] = 128 - Math.sign(py) * (norm ? ny / norm : Number(qy > qx)) * bend;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

function acquire(defs, key, width, height, radius, inner) {
  let map = maps.get(key);
  if (!map) {
    const id = 'sp-live-rim-' + ++serial;
    const rim = Math.min(inner ? 11 : 24, width / 4, height / 4);
    const filter = svgNode('filter', {id, x:'0%', y:'0%', width:'100%', height:'100%', 'color-interpolation-filters':'sRGB'});
    // Chromium resolves percentage feImage dimensions against the zero-size
    // definitions SVG. Use the panel's CSS pixels for the map's destination.
    filter.append(svgNode('feImage', {href:bevelMap(width, height, radius, rim), x:0, y:0, width,
      height, preserveAspectRatio:'none', result:'bevel'}));
    filter.append(svgNode('feDisplacementMap', {in:'SourceGraphic', in2:'bevel', scale:rim * 2.5, xChannelSelector:'R', yChannelSelector:'G'}));
    defs.append(filter);
    map = {key, id, filter, users:0};
    maps.set(key, map);
  }
  map.users++;
  return map;
}

function release(state) {
  if (!state.map) return;
  state.el.style.removeProperty('--sp-backdrop');
  if (!--state.map.users) {
    state.map.filter.remove();
    maps.delete(state.map.key);
  }
  state.map = null;
}

function configureLenses() {
  const registry = new Map();
  const svg = svgNode('svg', {width:0, height:0, 'aria-hidden':'true', focusable:'false'});
  svg.style.cssText = 'position:absolute;pointer-events:none;overflow:hidden';
  const defs = svgNode('defs');
  svg.append(defs);
  document.body.append(svg);
  // Safari and Firefox support native backdrop blur. Enable URL refraction on
  // engines that also implement SVG reference filters on a CSS backdrop.
  const refracts = CSS.supports('backdrop-filter', 'url("#lens")') && /Chrom(?:e|ium)\//.test(navigator.userAgent);
  function update(state) {
    if (!state.visible || reduced.matches || !refracts) return;
    const {el, inner} = state;
    const w = el.offsetWidth, h = el.offsetHeight;
    if (w < 2 || h < 2) return;
    const radius = getComputedStyle(el).borderTopLeftRadius;
    const r = Math.round(Math.min(w / 2, h / 2, radius.endsWith('%') ? Math.min(w,h) * parseFloat(radius) / 100 : parseFloat(radius) || 0));
    const key = [w,h,r,inner].join('/');
    if (key === state.map?.key) return;
    release(state);
    state.map = acquire(defs, key, w, h, r, inner);
    el.style.setProperty('--sp-backdrop', 'url("#' + state.map.id + '")');
  }
  const sizes = new ResizeObserver(entries => {
    for (const entry of entries) { const state = registry.get(entry.target); if (state) update(state); }
  });
  const visible = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const state = registry.get(entry.target);
      if (!state) continue;
      state.visible = entry.isIntersecting;
      if (state.visible) update(state); else release(state);
    }
  }, {rootMargin:'160px'});
  function register(el) {
    if (registry.has(el) || el.closest(excluded)) return;
    const inner = !el.matches(shells);
    if (inner && !el.closest(shells)) return;
    const state = {el, inner, visible:false, map:null};
    registry.set(el, state);
    el.classList.add(inner ? 'sp-glass-tile' : 'sp-glass-host');
    visible.observe(el);
    sizes.observe(el);
  }
  function scan(node) {
    if (node.matches(candidates)) register(node);
    node.querySelectorAll(candidates).forEach(register);
  }
  scan(document.body);
  new MutationObserver(changes => {
    let removed = false;
    for (const change of changes) {
      if (change.target.namespaceURI === svgNS) continue;
      if (change.type === 'attributes' && change.target.matches(candidates)) register(change.target);
      for (const node of change.addedNodes) if (node.nodeType === 1 && node.namespaceURI !== svgNS) scan(node);
      if (change.removedNodes.length) removed = true;
    }
    if (removed) for (const [el, state] of registry) if (!el.isConnected || el.closest(excluded)) {
      visible.unobserve(el); sizes.unobserve(el); release(state); registry.delete(el);
      el.classList.remove('sp-glass-tile', 'sp-glass-host');
    }
  }).observe(document.body, {subtree:true, childList:true, attributes:true, attributeFilter:['class']});
  reduced.addEventListener('change', () => {
    for (const state of registry.values()) if (reduced.matches) release(state); else update(state);
  });
}

if (document.body.matches('.sp-bbox-study')) {
  let source = root, fallback = 1;
  try { source = parent.document.documentElement; } catch {}
  try { fallback = Number(localStorage.getItem('sessionpath-last-background')) + 1; } catch {}
  const wallpaper = () => {
    const choice = Number(source.dataset.background) || fallback;
    const index = Number.isInteger(choice) && choice >= 1 && choice <= 11 ? choice : 1;
    const url = new URL('./assets/backgrounds/snowy-sunset-v' + index + '.webp', import.meta.url);
    root.style.setProperty('--sp-study-wallpaper', 'url("' + url.href + '")');
  };
  wallpaper();
  new MutationObserver(wallpaper).observe(source, {attributes:true, attributeFilter:['data-background']});
}
if ('IntersectionObserver' in window && 'ResizeObserver' in window) configureLenses();
