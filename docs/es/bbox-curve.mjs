// Display geometry only. Historical five-minute probabilities stay untouched.
export function probabilityAxis(points) {
 const values=points.map(p=>p.p).filter(Number.isFinite),peak=values.length?Math.max(...values):0;
 const step=peak<=.25?.05:peak<=.65?.1:.2;
 const top=Math.min(1,Math.max(peak>.15&&peak<=.25?.3:.1,Math.ceil((peak*1.15-1e-10)/step)*step));
 const ticks=[];for(let p=0;p<top-1e-8;p+=step)ticks.push(+p.toFixed(6));ticks.push(+top.toFixed(6));
 return {top,ticks};
}

// Monotone cubic Hermite segments keep the curve within adjacent observations.
export function smoothSegments(points) {
 const groups=[];let group=[];
 for(const p of points){if(!Number.isFinite(p.p)){if(group.length)groups.push(group);group=[];}else group.push(p);}
 if(group.length)groups.push(group);
 return groups.map(g=>{
  if(g.length===1)return {start:g[0],segments:[]};
  const slopes=g.slice(1).map((p,i)=>(p.p-g[i].p)/(p.minute-g[i].minute));
  const tangents=g.map((_,i)=>i===0?slopes[0]:i===g.length-1?slopes.at(-1):slopes[i-1]*slopes[i]<=0?0:2/(1/slopes[i-1]+1/slopes[i]));
  const segments=g.slice(1).map((b,i)=>{
   const a=g[i],h=b.minute-a.minute,d=slopes[i];let m0=tangents[i],m1=tangents[i+1];
   if(d===0)m0=m1=0;
   else {const norm=Math.hypot(m0/d,m1/d);if(norm>3){m0*=3/norm;m1*=3/norm;}}
   return {a,b,c1:{minute:a.minute+h/3,p:a.p+m0*h/3},c2:{minute:b.minute-h/3,p:b.p-m1*h/3}};
  });
  return {start:g[0],segments};
 });
}

export function curveGeometry(points,end,current) {
 const axis=probabilityAxis(points),start=points[0]?.minute??end,span=Math.max(5,end-start);
 const x=m=>62+554*(m-start)/span,y=p=>216-188*p/axis.top,fmt=n=>n.toFixed(2);
 const path=smoothSegments(points).map(g=>`M ${fmt(x(g.start.minute))} ${fmt(y(g.start.p))}`+g.segments.map(s=>` C ${fmt(x(s.c1.minute))} ${fmt(y(s.c1.p))}, ${fmt(x(s.c2.minute))} ${fmt(y(s.c2.p))}, ${fmt(x(s.b.minute))} ${fmt(y(s.b.p))}`).join('')).join(' ');
 const every=span<=30?10:span<=120?30:60;
 const candidates=points.filter(p=>p.minute===start||p.minute===end||p.minute%every===0);
 const ticks=candidates.filter((p,i)=>i===0||p.minute===end||x(p.minute)-x(candidates[i-1].minute)>=55).filter(p=>p.minute===start||p.minute===end||x(end)-x(p.minute)>=55);
 const at=points.find(p=>p.minute===current&&Number.isFinite(p.p));
 return {axis,path,x,y,ticks,at,start,end};
}

// Time moves continuously; the empirical percentage is held until the next completed close.
export function liveMarkerGeometry(points,end,completed,minute){
 const g=curveGeometry(points,end,Math.min(completed,end));
 if(!g.at)return null;
 const current=Math.max(g.start,Math.min(end,minute));
 return {x:g.x(current),y:g.y(g.at.p),minute:current,completed:g.at.minute,p:g.at.p};
}
