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
  // Red and green encode the offsets used to sample the live backdrop.
  new Uint32Array(image.data.buffer).fill(0xff808080);
  const dx = width / canvas.width, dy = height / canvas.height;
  for (let y = 0; y < canvas.height; y++) {
    const py = (y + .5) * dy - height / 2;
    const qy = Math.abs(py) - (height / 2 - radius);
    for (let x = 0; x < canvas.width; x++) {
      const px = (x + .5) * dx - width / 2;
      const qx = Math.abs(px) - (width / 2 - radius);
      const nx = Math.max(0, qx), ny = Math.max(0, qy);
      const norm = Math.hypot(nx, ny);
      const depth = radius - norm - Math.min(Math.max(qx, qy), 0);
      if (depth < 0) continue;
      const t = Math.min(1, depth / rim);
      const bend = 123 * Math.sin(Math.PI * (t * .88 + .12)) * (1 - t) ** 1.15;
      const index = 4 * (y * canvas.width + x);
      image.data[index] = 128 - 65 * px / (width / 2) - Math.sign(px) * (norm ? nx / norm : Number(qx >= qy)) * bend;
      image.data[index + 1] = 128 - 65 * py / (height / 2) - Math.sign(py) * (norm ? ny / norm : Number(qy > qx)) * bend;
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


export function createBackdropLenses() {
  const states = new Map();
  const svg = svgNode('svg', {width:0, height:0, 'aria-hidden':'true', focusable:'false'});
  svg.style.cssText = 'position:absolute;pointer-events:none;overflow:hidden';
  const defs = svgNode('defs');
  svg.append(defs);
  document.body.append(svg);
  const supportsMaps = CSS.supports('backdrop-filter', 'url("#lens")') && /Chrom(?:e|ium)\//.test(navigator.userAgent);
  function measure(el, radius) {
    if (!supportsMaps) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    if (w < 2 || h < 2) return;
    const inner = el.classList.contains('sp-glass-tile');
    const key = [w, h, radius, inner].join('/');
    const state = states.get(el) || {el, map:null};
    if (state.map?.key === key) return;
    release(state);
    state.map = acquire(defs, key, w, h, radius, inner);
    states.set(el, state);
    el.style.setProperty('--sp-backdrop', 'url("#' + state.map.id + '")');
  }
  function remove(el) {
    const state = states.get(el);
    if (state) release(state);
    states.delete(el);
  }
  function dispose() {
    for (const el of states.keys()) remove(el);
    svg.remove();
  }
  return {measure, remove, dispose};
}
