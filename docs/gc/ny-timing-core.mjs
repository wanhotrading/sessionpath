export const methodIds=Object.freeze({'Own Exact':'nyOwnExact','Own Wide':'nyOwnWide','Prior Exact':'nyPriorExact','Prior Wide':'nyPriorWide'});
export function clock(minute){return String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');}
export function minuteOf(value){
 if(!/^\d\d:\d\d$/.test(String(value)))return null;
 const [h,m]=value.split(':').map(Number);
 if(h>23||m>59)return null;
 return h*60+m;
}
export function nyDateMinute(timestamp){
 if(!Number.isFinite(timestamp))return null;
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(timestamp)).map(p=>[p.type,p.value]));
 return {date:parts.year+'-'+parts.month+'-'+parts.day,minute:Number(parts.hour)*60+Number(parts.minute)};
}
export function timingContext(box,{date,method}={}){
 if(!box)return {available:false,reason:'Enter the 08:30 price and AVR, then apply the Exact / Wide position helper.'};
 const start=nyDateMinute(box.start),end=nyDateMinute(box.end);
 if(!start||!end||start.date!==date||end.date!==date||start.minute!==510||end.minute!==960)return {available:false,reason:'Use this trading date’s full 08:30–16:00 NY Mean box.'};
 if(!Object.hasOwn(methodIds,method)||box.nyResearchMethod!==method)return {available:false,reason:'Apply a named Own / Prior Exact / Wide method. Custom boxes retain their forecast without an unrelated timing reference.'};
 const upper=box.price+box.up,lower=box.price-box.down;
 if(![upper,lower].every(Number.isFinite)||!(upper>lower))return {available:false,reason:'A positive Mean box width is required.'};
 return {available:true,method:methodIds[method],methodLabel:method,date,upper,lower,width:upper-lower,forecastN:Number.isInteger(box.n)?box.n:null};
}
export function timingFitEligibility(context,minFit){
 if(!context?.available)return {available:false,reason:context?.reason||'A named NY Mean box is required.'};
 if(![1,50].includes(minFit))return {available:false,reason:'Choose an available fit threshold.'};
 if(!Number.isInteger(context.forecastN)||context.forecastN<minFit)return {available:false,reason:'Current box has '+(context.forecastN??'unknown')+' matched dates. '+(minFit===50?'Select “All positive fits” sensitivity to inspect matching history.':'The box needs at least one matched date.')};
 return {available:true,reason:null};
}
export function projectedLevel(context,side,multiple){
 if(!context?.available||!['U','D'].includes(side)||!Number.isFinite(multiple))return null;
 return side==='U'?context.lower+multiple*context.width:context.upper-multiple*context.width;
}
export function wilsonPercent(hits,n){
 if(!Number.isInteger(hits)||!Number.isInteger(n)||n<=0||hits<0||hits>n)return null;
 const z=1.959963984540054,p=hits/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,r=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
 return [100*Math.max(0,c-r),100*Math.min(1,c+r)];
}
export function observationFromFields(fields){
 const minute=minuteOf(fields.time),overshoot=fields.type==='WICK_ONLY'?0:Number(fields.overshoot)/100;
 if(!['U','D'].includes(fields.side)||!['WICK_ONLY','CLOSE_OUTSIDE'].includes(fields.type))throw Error('Choose the first breached side and how that candle closed.');
 if(minute===null||minute<515||minute>960||minute%5!==0)throw Error('Use a completed five-minute candle from 08:35 through 16:00 New York time.');
 if(fields.type==='CLOSE_OUTSIDE'&&(String(fields.overshoot).trim()===''||!Number.isFinite(overshoot)||overshoot<=0))throw Error('Enter a positive closing distance beyond the boundary, as a percentage of the full Mean box width.');
 return {side:fields.side,type:fields.type,signalCloseMinute:minute,closeOvershoot:overshoot};
}
