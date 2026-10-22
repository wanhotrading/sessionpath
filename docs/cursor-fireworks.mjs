// Bounded mini fireworks: no network, idle loop, per-spark blur or trail allocations.
const reduced=matchMedia('(prefers-reduced-motion: reduce)'),coarse=matchMedia('(pointer: coarse)');
const KEY='sessionpath-fireworks-enabled-v1';
const themes=[['#ffb8d7','#f7a784','#ffe6cd'],['#79cdff','#9aeaf2','#e0f6ff'],['#bca0ff','#e7b3ff','#eee1ff'],['#78e6bc','#b5efd0','#e5ffe8'],['#ffc76e','#ffe0a0','#fff3d2'],['#ff798f','#ffad9d','#ffd5df']];
let enabled=true;try{enabled=localStorage.getItem(KEY)!=='off';}catch{}
const canvas=document.createElement('canvas');canvas.className='cursor-fireworks-layer';canvas.setAttribute('aria-hidden','true');document.body.append(canvas);
const ctx=canvas.getContext('2d',{alpha:true});
const button=document.createElement('button');button.id='fireworks-toggle';button.type='button';button.className='quiet fireworks-toggle';
(document.querySelector('.top-actions')||document.body).append(button);
const particles=[];
let width=0,height=0,frame=0,previous=0,lastMove=-Infinity,lastBurst=-Infinity,lastX=-999,lastY=-999,scrollUntil=0;
let themeIndex=Math.floor(Math.random()*themes.length),budget=coarse.matches?64:120,slowFrames=0;
const paused=()=>!enabled||!ctx||reduced.matches||document.hidden||document.documentElement.classList.contains('motion-paused')||document.body.classList.contains('motion-paused');
function clear(){if(frame)cancelAnimationFrame(frame);frame=0;previous=0;particles.length=0;ctx?.clearRect(0,0,width,height);}
function sync(){
 button.textContent=`🎆 ${enabled?'On':'Off'}`;button.setAttribute('aria-label',enabled?'Turn fireworks off':'Turn fireworks on');button.setAttribute('aria-pressed',String(enabled));
 button.title=`Fireworks ${enabled?'on':'off'}${reduced.matches?' · reduced motion active':''}`;canvas.hidden=paused();if(paused())clear();
}
button.addEventListener('click',()=>{enabled=!enabled;try{localStorage.setItem(KEY,enabled?'on':'off');}catch{}sync();});
function resize(){
 clear();width=innerWidth;height=innerHeight;
 // Decorative sparks need no high-DPI backing store; cap large-monitor pixel cost.
 const scale=Math.min(1,Math.sqrt(2100000/(width*height)));
 canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);ctx?.setTransform(scale,0,0,scale,0,0);
}
function emit(x,y,click=false){
 if(paused()||performance.now()<scrollUntil)return;
 const colors=themes[themeIndex++%themes.length],count=click?(coarse.matches?28:42):6;
 const n=Math.min(count,Math.max(0,budget-particles.length));
 for(let i=0;i<n;i++){
  const angle=i/n*Math.PI*2+(Math.random()-.5)*.08,speed=click?40+Math.random()*85:18+Math.random()*28;
  const trail=new Float32Array(12);for(let j=0;j<12;j+=2){trail[j]=x;trail[j+1]=y;}
  particles.push({x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed-(click?17:7),age:0,life:click?1+Math.random()*.4:.5+Math.random()*.25,gravity:click?70:40,drag:click?.8:1.2,color:colors[i%3],size:click?1:.75,trail,head:0});
 }
 if(particles.length&&!frame){previous=0;frame=requestAnimationFrame(tick);}
}
function tick(now){
 frame=0;if(paused()){clear();return;}
 const elapsed=previous?now-previous:1000/30;
 // At most 30 rendered frames/sec, independent of high-refresh displays.
 if(elapsed<1000/30-1){frame=requestAnimationFrame(tick);return;}
 if(previous&&elapsed>55&&++slowFrames>=8){budget=coarse.matches?40:72;slowFrames=0;}
 const dt=Math.min(elapsed/1000,.1);previous=now;ctx.clearRect(0,0,width,height);ctx.lineCap='round';
 let alive=0;
 for(let i=0;i<particles.length;i++){
  const p=particles[i];p.age+=dt;if(p.age>=p.life)continue;particles[alive++]=p;
  const drag=Math.exp(-p.drag*dt);p.vx*=drag;p.vy=p.vy*drag+p.gravity*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;
  p.head=(p.head+2)%12;p.trail[p.head]=p.x;p.trail[p.head+1]=p.y;
  const fade=Math.pow(1-p.age/p.life,.8);ctx.strokeStyle=p.color;ctx.lineWidth=p.size;ctx.globalAlpha=fade*.58;ctx.beginPath();
  for(let j=1;j<=6;j++){const k=(p.head+j*2)%12;if(j===1)ctx.moveTo(p.trail[k],p.trail[k+1]);else ctx.lineTo(p.trail[k],p.trail[k+1]);}
  ctx.stroke();ctx.globalAlpha=fade;ctx.fillStyle=p.color;ctx.fillRect(p.x-1,p.y-1,2,2);
 }
 particles.length=alive;ctx.globalAlpha=1;
 if(alive)frame=requestAnimationFrame(tick);else{previous=0;ctx.clearRect(0,0,width,height);}
}
resize();sync();
document.addEventListener('pointermove',e=>{
 if(e.pointerType!=='mouse'||e.buttons||paused())return;
 const now=performance.now();if(now-lastMove<220||Math.hypot(e.clientX-lastX,e.clientY-lastY)<14)return;
 lastMove=now;lastX=e.clientX;lastY=e.clientY;emit(e.clientX,e.clientY);
},{passive:true});
document.addEventListener('click',e=>{
 if(e.detail===0||e.target.closest?.('#fireworks-toggle')||paused())return;
 const now=performance.now();if(now-lastBurst<180)return;lastBurst=now;emit(e.clientX,e.clientY,true);
},{passive:true,capture:true});
document.addEventListener('scroll',()=>{scrollUntil=performance.now()+180;if(frame||particles.length)clear();},{passive:true,capture:true});
new MutationObserver(sync).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['class']});
reduced.addEventListener('change',sync);document.addEventListener('visibilitychange',sync);
window.addEventListener('blur',clear);window.addEventListener('resize',resize,{passive:true});
window.addEventListener('storage',e=>{if(e.key===KEY){enabled=e.newValue!=='off';sync();}});
