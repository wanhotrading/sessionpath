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
canvas.className = 'sp-optics-scene';
canvas.setAttribute('aria-hidden','true');
document.body.prepend(canvas);
const tracked = new Set(), visible = new Set(), animated = new Set(), radii = new WeakMap();
const gl = canvas.getContext('webgl', {alpha:true,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false});
let fallbackLenses;
let program, mesh, wallpaper, viewUniform, photo, requestedURL, frame=0;
let viewWidth=0, viewHeight=0, vertices=new Float32Array(12*6*32);
const vertex = `
attribute vec2 corner;
attribute vec4 box;
attribute vec2 material;
attribute vec4 clipBox;
uniform vec2 viewport;
varying vec2 pos;
varying vec2 local;
varying vec2 halfSize;
varying vec2 lens;
varying vec4 limits;
void main() {
  pos=box.xy+corner*box.zw;
  halfSize=box.zw*.5; local=(corner-.5)*box.zw;
  lens=material; limits=clipBox;
  gl_Position=vec4(pos/viewport*vec2(2.,-2.)+vec2(-1.,1.),0.,1.);
}`;
const fragment = `
precision highp float;
uniform sampler2D scene;
uniform vec2 viewport;
varying vec2 pos;
varying vec2 local;
varying vec2 halfSize;
varying vec2 lens;
varying vec4 limits;
void main() {
  if(pos.x<limits.x || pos.y<limits.y || pos.x>limits.z || pos.y>limits.w) discard;
  float radius=min(lens.x,min(halfSize.x,halfSize.y));
  vec2 q=abs(local)-halfSize+radius;
  vec2 arc=max(q,0.);
  float len=length(arc);
  float depth=radius-len-min(max(q.x,q.y),0.);
  if(depth<0.) discard;
  vec2 normal=sign(local)*(len>.01 ? arc/max(len,.01) : (q.x>q.y?vec2(1.,0.):vec2(0.,1.)));
  float rim=min(mix(30.,14.,lens.y),min(halfSize.x,halfSize.y)*.55);
  float bevel=1.-smoothstep(0.,max(1.,rim),depth);
  vec2 bend=local*mix(-.12,-.075,lens.y)-normal*(rim*1.45*bevel);
  vec2 uv=(pos+bend)/viewport;
  vec3 col=texture2D(scene,uv).rgb;
  if (bevel <= 0.) { gl_FragColor=vec4(col,1.); return; }
  col.b=texture2D(scene,uv+normal*(1.45*bevel)/viewport).b;
  float light=dot(normal,vec2(-.63,-.77));
  col+=vec3(.09,.12,.16)*max(0.,light)*bevel;
  col*=1.-.13*max(0.,-light)*bevel;
  gl_FragColor=vec4(col,1.);
}`;
function shader(type, source) {
  const result=gl.createShader(type);gl.shaderSource(result,source);gl.compileShader(result);
  if (!gl.getShaderParameter(result,gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(result));
  return result;
}
function initialize() {
  program=gl.createProgram();
  const vs=shader(gl.VERTEX_SHADER,vertex), fs=shader(gl.FRAGMENT_SHADER,fragment);
  gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
  gl.deleteShader(vs);gl.deleteShader(fs);
  if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  mesh=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,mesh);
  for (const [name,size,offset] of [['corner',2,0],['box',4,2],['material',2,6],['clipBox',4,8]]) {
    const location=gl.getAttribLocation(program,name);
    gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,48,offset*4);
  }
  viewUniform=gl.getUniformLocation(program,'viewport');
  wallpaper=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,wallpaper);
  for (const [key,value] of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],
    [gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D,key,value);
  gl.clearColor(0,0,0,0);
}
// Change only the optical layer's resolution when sustained scrolling exceeds
// the frame budget. Text, layout, wallpaper and the calibrated lens geometry
// stay at their original resolution. A pause starts a fresh timing sample.
const widths = [420, 600, 880, 1200];
let quality = 2, lastDraw = 0, totalInterval = 0, samples = 0;
function sizeBuffer() {
  const factor = Math.min(1, widths[quality] / viewWidth, 900 / viewHeight);
  canvas.width = Math.max(1, Math.round(viewWidth * factor));
  canvas.height = Math.max(1, Math.round(viewHeight * factor));
  gl.viewport(0, 0, canvas.width, canvas.height);
}
function trackCadence(now) {
  const interval = now - lastDraw;
  lastDraw = now;
  if (interval > 80 || interval < 5) { samples = 0; totalInterval = 0; return; }
  totalInterval += interval;
  if (++samples < 24) return;
  const average = totalInterval / samples;
  samples = 0;
  totalInterval = 0;
  const next = average > 23 ? Math.max(0, quality - 1) : average < 18 ? Math.min(widths.length - 1, quality + 1) : quality;
  if (next !== quality) { quality = next; sizeBuffer(); }
}
function cachePhoto() {
  if (!photo || !program || simple.matches || gl.isContextLost()) return;
  viewWidth=root.clientWidth;viewHeight=innerHeight;
  if (!viewWidth || !viewHeight) return;
  sizeBuffer();
  const scene=document.createElement('canvas');
  scene.width=Math.min(viewWidth,1440);scene.height=Math.max(1,Math.round(scene.width*viewHeight/viewWidth));
  const ctx=scene.getContext('2d');
  const cover=Math.max(scene.width/photo.naturalWidth,scene.height/photo.naturalHeight);
  const w=photo.naturalWidth*cover,h=photo.naturalHeight*cover;
  ctx.drawImage(photo,(scene.width-w)/2,(scene.height-h)/2,w,h);
  const shade=ctx.createLinearGradient(0,0,0,scene.height);
  shade.addColorStop(0,study?'#111c33ad':'rgba(8,16,34,.43)');
  if (!study) shade.addColorStop(.42,'rgba(8,18,36,.15)');
  shade.addColorStop(1,study?'#0d1935a8':'rgba(7,16,34,.24)');
  ctx.fillStyle=shade;ctx.fillRect(0,0,scene.width,scene.height);
  gl.viewport(0,0,canvas.width,canvas.height);
  gl.bindTexture(gl.TEXTURE_2D,wallpaper);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,scene);
  schedule();
}
function schedule() {
  if (!frame && photo && program && !simple.matches && !document.hidden) frame=requestAnimationFrame(draw);
}
const corners=[[0,0],[1,0],[0,1],[0,1],[1,0],[1,1]];
function draw(now) {
  frame=0;
  if (!photo || simple.matches || gl.isContextLost()) return;
  if (viewWidth!==root.clientWidth || viewHeight!==innerHeight) {cachePhoto();return;}
  trackCadence(now);
  if (vertices.length<visible.size*72) vertices=new Float32Array(visible.size*144);
  let count=0;
  // Paint shells first so each nested lens keeps its own curvature.
  for (const inner of [false,true]) for (const el of visible) {
    if (el.classList.contains('sp-glass-tile')!==inner || !el.isConnected) continue;
    const b=el.getBoundingClientRect();
    if (!b.width || !b.height || b.bottom<0 || b.top>viewHeight || b.right<0 || b.left>viewWidth) continue;
    const parent=el.closest('dialog'), clip=parent&&parent!==el?parent.getBoundingClientRect():null;
    for (const [x,y] of corners) {
      vertices.set([x,y,b.left,b.top,b.width,b.height,radii.get(el)||0,+inner,
        clip?.left||0,clip?.top||0,clip?.right??viewWidth,clip?.bottom??viewHeight],count);
      count+=12;
    }
  }
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform2f(viewUniform,viewWidth,viewHeight);
  gl.bufferData(gl.ARRAY_BUFFER,vertices.subarray(0,count),gl.DYNAMIC_DRAW);
  if(count) gl.drawArrays(gl.TRIANGLES,0,count/12);
  if(animated.size) schedule();
}
function measure(el) {
  const r=getComputedStyle(el).borderTopLeftRadius;
  const radius = r.endsWith('%') ? Math.min(el.offsetWidth, el.offsetHeight) * parseFloat(r) / 100 : parseFloat(r) || 0;
  radii.set(el, radius);
  if (!simple.matches) fallbackLenses?.measure(el, radius);
}
const resizer=new ResizeObserver(entries=>{
  for(const {target} of entries) if(visible.has(target)) measure(target);
  schedule();
});
const observer=new IntersectionObserver(entries=>{
  for(const {target,isIntersecting} of entries) {
    if(isIntersecting){visible.add(target);measure(target);}else{visible.delete(target);animated.delete(target);fallbackLenses?.remove(target);}
  }
  schedule();
});
function register(el) {
  if(tracked.has(el)||el.closest(excluded)) return;
  const outer=el.matches(shells);
  if(!outer&&!el.parentElement?.closest(shells)) return;
  el.classList.add(outer?'sp-glass-host':'sp-glass-tile');
  tracked.add(el);observer.observe(el);resizer.observe(el);
}
document.querySelectorAll(candidates).forEach(register);
new MutationObserver(changes=>{
  let removed=false;
  for(const m of changes) {
    if(m.type==='attributes'){if(m.target.matches(candidates))register(m.target);continue;}
    for(const n of m.addedNodes) if(n.nodeType===1&&n.namespaceURI===document.body.namespaceURI) {
      if(n.matches(candidates))register(n);
      n.querySelectorAll(candidates).forEach(register);
    }
    if(!removed)removed=Array.from(m.removedNodes).some(n=>n.nodeType===1);
  }
  if(removed)for(const el of tracked)if(!el.isConnected) {
    fallbackLenses?.remove(el);tracked.delete(el);visible.delete(el);animated.delete(el);observer.unobserve(el);resizer.unobserve(el);schedule();
  }
}).observe(document.body,{attributes:true,attributeFilter:['class'],childList:true,subtree:true});
let wallRoot=root;
if(study)try{wallRoot=parent.document.documentElement;}catch{}
function refresh() {
  let n=Number(wallRoot.dataset.background);
  if(!n&&study)try{n=Number(localStorage.getItem('sessionpath-last-background'))+1;}catch{}
  if(!Number.isInteger(n)||n<1||n>11)n=1;
  const url=new URL('./assets/backgrounds/snowy-sunset-v'+n+'.webp',import.meta.url).href;
  if(study)root.style.setProperty('--sp-study-wallpaper','url("'+url+'")');
  if(url===requestedURL||simple.matches||!program)return;
  requestedURL=url;
  const img=new Image();img.onload=()=>{if(requestedURL===url){photo=img;cachePhoto();}};img.src=url;
}
function motion(event) {
  const el=event.target;
  if(!tracked.has(el))return;
  const active=el.getAnimations().some(a=>a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity&&a.effect.getKeyframes().some(k=>k.transform||k.scale||k.translate));
  if(active&&visible.has(el))animated.add(el);else animated.delete(el);
  schedule();
}
for(const event of ['transitionrun','transitionend','transitioncancel','animationstart','animationend','animationcancel'])document.addEventListener(event,motion);
async function fallback() {
  program = null;
  canvas.hidden = true;
  root.classList.add('sp-optics-fallback');
  const {createBackdropLenses} = await import('./session-glass-fallback.mjs');
  if (!root.classList.contains('sp-optics-fallback') || fallbackLenses) return;
  fallbackLenses = createBackdropLenses();
  visible.forEach(measure);
}
function activate() {
  try {
    initialize();
    root.classList.remove('sp-optics-fallback');
    fallbackLenses?.dispose();
    fallbackLenses = null;
    canvas.hidden = false;
    refresh();
    cachePhoto();
  } catch {
    fallback();
  }
}
if (gl) activate(); else fallback();
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  cancelAnimationFrame(frame);
  frame = 0;
  fallback();
});
canvas.addEventListener('webglcontextrestored', activate);
new MutationObserver(refresh).observe(wallRoot,{attributes:true,attributeFilter:['data-background']});
refresh();
window.addEventListener('scroll',schedule,{capture:true,passive:true});window.addEventListener('resize',cachePhoto,{passive:true});
window.addEventListener('pageshow',schedule);document.addEventListener('visibilitychange',schedule);
simple.addEventListener('change',()=>{if(simple.matches){cancelAnimationFrame(frame);frame=0;}else{refresh();cachePhoto();visible.forEach(measure);}});
