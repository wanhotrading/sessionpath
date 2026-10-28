import {nyTimestamp} from './planner-v3.mjs';

export function observedUD({open,high,low,avr,up,down,units='points'}) {
 let u=up,d=down;
 if(Number.isFinite(open)&&Number.isFinite(high)&&Number.isFinite(low)) {
  if(open<low-1e-8||open>high+1e-8)throw new Error('The 19:30 open must be inside the running high/low.');
  u=high-open;d=open-low;units='points';
 }
 if([u,d].some(v=>v!=null&&(!Number.isFinite(v)||v<0)))throw new Error('U and D must be nonnegative.');
 if(units==='points'&&[u,d].some(Number.isFinite)&&!(avr>0))throw new Error('Enter AVR points to compare current U/D with the historical sample.');
 const ratio=v=>!Number.isFinite(v)?null:units==='points'?v/avr:v/100;
 return {up:ratio(u),down:ratio(d),upPoints:units==='points'?u:u==null?null:u/100*avr,downPoints:units==='points'?d:d==null?null:d/100*avr};
}

// Reference logic used in verification. Pine applies the same frozen-quarter rule at bar close.
export function avrProjection({minute,price,fixedHigh,fixedLow,high,low,avr,mode='Frozen 04:30',highBroken=false,lowBroken=false}) {
 if(minute<270||minute>=510)return {side:'none',reason:'Outside 04:30–08:30'};
 if(!(fixedHigh>fixedLow)||!(avr>0)||!Number.isFinite(price))return {side:'none',reason:'Incomplete inputs'};
 const position=(price-fixedLow)/(fixedHigh-fixedLow);
 const side=position>=.75?'up':position<=.25?'down':'none';
 if(side==='none')return {side,position,reason:'Middle 50%'};
 if(mode==='Frozen 04:30'&&(side==='up'?lowBroken:highBroken))return {side:'none',position,reason:'Opposite 04:30 boundary breached'};
 const anchor=side==='up'?(mode==='Frozen 04:30'?fixedLow:low):(mode==='Frozen 04:30'?fixedHigh:high);
 if(!Number.isFinite(anchor))return {side:'none',position,reason:'Missing anchor'};
 const target=anchor+(side==='up'?avr:-avr);
 return {side,position,anchor,target,reached:side==='up'?high>=target:low<=target};
}

export function makeForecastCode(box,q) {
 if(!box||!(q.avr>0)||!Number.isFinite(q.price)||!(box.n>0))throw new Error('Price, AVR and historical matches are required.');
 const start=nyTimestamp(q.date,q.minute),end=nyTimestamp(q.date,box.endMinute);
 if(!(end>start)||q.minute< -270||box.endMinute>510)throw new Error('Forecast must end by 08:30 New York time.');
 const f=x=>Number(x).toFixed(6);
 const numbers=[start,end,q.price,box.upPoints,box.downPoints,box.n,100*box.coverage,100*box.touchUp,100*box.touchDown,q.avr];
 if(numbers.some(x=>!Number.isFinite(x)))throw new Error('Forecast contains an invalid number.');
 return ['SP4',String(start),String(end),f(q.price),f(box.upPoints),f(box.downPoints),String(box.n),f(100*box.coverage),f(100*box.touchUp),f(100*box.touchDown),f(q.avr)].join('|');
}
export function parseForecastCode(code) {
 const a=String(code).trim().split('|'),v=a.slice(1).map(Number);
 if(a.length!==11||a[0]!=='SP4'||a.slice(1).some(x=>x.trim()==='')||v.some(x=>!Number.isFinite(x)))throw new Error('Invalid SP4 forecast code.');
 const [start,end,price,up,down,n,containment,touchUp,touchDown,avr]=v;
 if(start<=0||end<=start||end-start>13*3600000||up<0||down<0||!Number.isInteger(n)||n<1||avr<=0||[containment,touchUp,touchDown].some(x=>x<0||x>100))throw new Error('Invalid SP4 forecast values.');
 return {start,end,price,up,down,n,containment,touchUp,touchDown,avr};
}
export function makeChartPine(template,box,q,{anchorMode='Frozen 04:30'}={}) {
 const code=box?makeForecastCode(box,q):'';
 if(!template.includes('input.string("", "Forecast code from website"'))throw new Error('Indicator template could not be loaded.');
 return template.replace('input.string("", "Forecast code from website"',`input.string(${JSON.stringify(code)}, "Forecast code from website"`).replace('input.string("Frozen 04:30", "AVR anchor"',`input.string(${JSON.stringify(anchorMode)}, "AVR anchor"`);
}
