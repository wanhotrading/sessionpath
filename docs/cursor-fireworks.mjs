// Mini fireworks: a transparent canvas, local pointer coordinates, no network requests.
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const coarse = matchMedia('(pointer: coarse)');
const themes = [
  {name:'Rose gold', colors:['#ffb8d7','#f7a784','#ffe6cd']},
  {name:'Glacier blue', colors:['#79cdff','#9aeaf2','#e0f6ff']},
  {name:'Amethyst', colors:['#bca0ff','#e7b3ff','#eee1ff']},
  {name:'Emerald', colors:['#78e6bc','#b5efd0','#e5ffe8']},
  {name:'Champagne', colors:['#ffc76e','#ffe0a0','#fff3d2']},
  {name:'Ruby', colors:['#ff798f','#ffad9d','#ffd5df']}
];
const canvas = document.createElement('canvas');
canvas.className = 'cursor-fireworks-layer';
canvas.setAttribute('aria-hidden','true');
document.body.append(canvas);
const ctx = canvas.getContext('2d',{alpha:true});
const particles = [];
const paused = () => reduced.matches || document.hidden ||
  document.documentElement.classList.contains('motion-paused') ||
  document.body.classList.contains('motion-paused');
let width=0,height=0,dpr=1,frame=0,previous=0,lastMove=0,lastX=-999,lastY=-999;
let themeIndex=Math.floor(Math.random()*themes.length);
function clear(){
  if(frame)cancelAnimationFrame(frame);
  frame=0;previous=0;particles.length=0;
  ctx?.clearRect(0,0,width,height);
}
function resize(){
  width=innerWidth;height=innerHeight;dpr=Math.min(devicePixelRatio||1,1.5);
  canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
  ctx?.setTransform(dpr,0,0,dpr,0,0);
}
function emit(x,y,click=false){
  if(!ctx||paused())return;
  const theme=themes[themeIndex++%themes.length];
  const count=click?(coarse.matches?52:84):14;
  const limit=coarse.matches?240:420;
  // Consecutive bursts visit all six coherent colour families.
  for(let i=0;i<count;i++){
    const a=i/count*Math.PI*2+(Math.random()-.5)*.075;
    const speed=click?45+Math.random()*95:20+Math.random()*34;
    const life=click?1.05+Math.random()*.65:.6+Math.random()*.35;
    particles.push({x,y,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed-(click?17:7),
      age:0,life,gravity:click?76:45,drag:click?.8:1.25,
      color:theme.colors[i%theme.colors.length],size:click?.8+Math.random()*.6:.65,
      trail:[{x,y}],tail:click?16:9,twinkle:Math.random()*6.28});
  }
  if(particles.length>limit)particles.splice(0,particles.length-limit);
  if(!frame){previous=0;frame=requestAnimationFrame(tick);}
}
function tick(now){
  frame=0;
  if(paused()){clear();return;}
  const dt=previous?Math.min((now-previous)/1000,.035):1/60;previous=now;
  ctx.clearRect(0,0,width,height);
  ctx.globalCompositeOperation='lighter';ctx.lineCap='round';
  for(let i=particles.length-1;i>=0;i--){
    const p=particles[i];p.age+=dt;
    if(p.age>=p.life){particles.splice(i,1);continue;}
    const drag=Math.exp(-p.drag*dt);
    p.vx*=drag;p.vy=p.vy*drag+p.gravity*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;
    p.trail.push({x:p.x,y:p.y});if(p.trail.length>p.tail)p.trail.shift();
    const fade=Math.pow(1-p.age/p.life,.8),spark=.82+.18*Math.sin(p.age*18+p.twinkle);
    ctx.strokeStyle=p.color;ctx.shadowColor=p.color;ctx.shadowBlur=0;
    // Fading, gravity-curved segments echo the reference's willow trails.
    for(let j=1;j<p.trail.length;j++){
      const a=p.trail[j-1],b=p.trail[j];
      ctx.globalAlpha=fade*(j/p.trail.length)*.62;
      ctx.lineWidth=p.size*(.35+.65*j/p.trail.length);
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    }
    ctx.globalAlpha=fade*spark;ctx.fillStyle=p.color;ctx.shadowBlur=4;
    ctx.beginPath();ctx.arc(p.x,p.y,p.size*.7,0,Math.PI*2);ctx.fill();
  }
  ctx.shadowBlur=0;ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  if(particles.length)frame=requestAnimationFrame(tick);else{previous=0;ctx.clearRect(0,0,width,height);}
}
resize();
document.addEventListener('pointermove',e=>{
  if(e.pointerType!=='mouse'||e.buttons||paused())return;
  const now=performance.now();
  if(now-lastMove<145||Math.hypot(e.clientX-lastX,e.clientY-lastY)<9)return;
  lastMove=now;lastX=e.clientX;lastY=e.clientY;
  emit(e.clientX,e.clientY);
},{passive:true});
document.addEventListener('click',e=>{
  if(e.detail===0||paused())return;
  emit(e.clientX,e.clientY,true);
},{passive:true,capture:true});
const stopIfPaused=()=>{if(paused())clear();};
new MutationObserver(stopIfPaused).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
new MutationObserver(stopIfPaused).observe(document.body,{attributes:true,attributeFilter:['class']});
reduced.addEventListener('change',stopIfPaused);
document.addEventListener('visibilitychange',stopIfPaused);
window.addEventListener('blur',clear);
window.addEventListener('resize',resize,{passive:true});
