// Current-session quarter selection only. Historical rows always retain one
// exact quarter; Wide broadens the requested set near internal boundaries.
const EPS=1e-8;
export function positionQuarters(position){
 if(!Number.isFinite(position))throw Error('Enter a closing-position percentage for both sessions.');
 if(position < -EPS)return {position,exact:['BELOW'],wide:['BELOW']};
 if(position > 1+EPS)return {position,exact:['ABOVE'],wide:['ABOVE']};
 const q=Math.min(4,Math.max(1,Math.floor(position*4+EPS)+1)),wide=new Set([q]);
 for(const boundary of [1,2,3])if(Math.abs(position-boundary/4)<=.05+EPS){wide.add(boundary);wide.add(boundary+1);}
 return {position,exact:['Q'+q],wide:[...wide].sort().map(x=>'Q'+x)};
}

export function nyPositionSelection({asia,london,basis='bbox',mode='wide'}){
 if(!['bbox','own'].includes(basis)||!['exact','wide'].includes(mode))throw Error('Choose Own or Prior and Exact or Wide.');
 if(basis==='own'&&[asia,london].some(p=>!Number.isFinite(p)||p < -EPS||p > 1+EPS))throw Error('Own-range closing positions must be between 0% and 100%.');
 return {basis,mode,asia:positionQuarters(asia)[mode],london:positionQuarters(london)[mode],
  method:(basis==='own'?'Own':'Prior')+' '+(mode==='wide'?'Wide':'Exact')};
}

// Never reads the 08:30 H/L/C or any later candle. Asia's last included candle
// opens 01:55 and London's 08:25. This helper requires an 08:30-known snapshot.
export function archivedNYPositions(day,timeline,basis='bbox',knownAt=510){
 if(!Number.isFinite(knownAt)||knownAt<510)throw Error('Both session closing positions are known only at 08:30 NY time.');
 if(!['bbox','own'].includes(basis))throw Error('Choose Own or Prior range.');
 const rows=Array.isArray(timeline)?timeline:timeline?.rows;
 const source=rows?.find(r=>r[0]===day?.index),start=timeline?.startMinute??-270,step=timeline?.stepMinutes??timeline?.step??5,scale=timeline?.priceScale??100;
 if(!source||step!==5||!(scale>0))throw Error('No complete Asia/London archive is available for this date.');
 const position=(from,to)=>{
  const a=(from-start)/step,b=(to-start)/step,bars=source[2];
  if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b*3>bars.length)throw Error('Session closing prices are incomplete for this date.');
  let high=-Infinity,low=Infinity,close=null;
  for(let i=a;i<b;i++){
   const [h,l,c]=bars.slice(i*3,i*3+3);
   if(![h,l,c].every(Number.isFinite)||h<l||c<l||c>h)throw Error('Session closing prices are incomplete for this date.');
   high=Math.max(high,h/scale);low=Math.min(low,l/scale);close=c/scale;
  }
  const bottom=basis==='own'?low:day.priorLow,width=basis==='own'?high-low:day.priorWidth;
  if(!Number.isFinite(bottom)||!(width>0))throw Error('The selected reference range is unavailable or has zero width.');
  return (close-bottom)/width;
 };
 return {asia:position(-270,120),london:position(180,510),basis};
}
