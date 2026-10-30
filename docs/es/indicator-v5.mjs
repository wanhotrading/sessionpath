import {instrument} from './instrument.mjs';
import {nyTimestamp} from './planner-v3.mjs';
import {nyMethodToken,parseNYMethodToken} from './ny-method-metadata.mjs';

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
 const nyPlan=q.minute===510&&[630,960].includes(box.endMinute);
 if(!(end>start)||q.minute< -270||end-start>13*3600000||(box.endMinute>510&&!nyPlan))throw new Error('Use an overnight endpoint through 08:30, or an 08:30 NY plan ending at 10:30 or 16:00.');
 const f=x=>Number(x).toFixed(6);
 const numbers=[start,end,q.price,box.upPoints,box.downPoints,box.n,100*box.coverage,100*box.touchUp,100*box.touchDown,q.avr];
 if(numbers.some(x=>!Number.isFinite(x)))throw new Error('Forecast contains an invalid number.');
 const extra=[box.upMaxPoints,box.downMaxPoints,box.upMedianPoints,box.downMedianPoints];
 const envelope=extra.every(Number.isFinite);
 if(instrument.id==='NQ'&&!envelope)throw Error('NQ forecasts require complete mean, median and envelope statistics.');
 const base=['SP4',String(start),String(end),f(q.price),f(box.upPoints),f(box.downPoints),String(box.n),f(100*box.coverage),f(100*box.touchUp),f(100*box.touchDown),f(q.avr)];
 if(envelope){if(extra[0]<box.upPoints||extra[1]<box.downPoints||extra.some(x=>x<0)||extra[2]>extra[0]||extra[3]>extra[1])throw Error('Invalid envelope statistics.');base[0]=instrument.forecastPrefix;base.push(...extra.map(f));}
 // A full observed high/low snapshot opts into the new dated expansion layer.
 // Leaving both anchors absent preserves earlier mean-box-only export formats.
 if(q.rangeHigh!=null||q.rangeLow!=null){
  const expansion=[q.rangeHigh,q.rangeLow,box.extensionUpPoints,box.extensionDownPoints];
  if(!envelope||!expansion.every(Number.isFinite)||q.rangeHigh<q.rangeLow||q.price<q.rangeLow-1e-8||q.price>q.rangeHigh+1e-8||box.extensionUpPoints<0||box.extensionDownPoints<0)throw Error('Expansion boxes require the cutoff high/low around the decision open and nonnegative matched expansion distances.');
  base[0]=instrument.expansionPrefix??(instrument.id==='NQ'?'SPNQ2':'SP6');base.push(...expansion.map(f));
 }
 // NY method travels with its forecast; an unclassified/custom selection must
 // never inherit a named research table from an unrelated indicator setting.
 if(nyPlan)base.push(nyMethodToken(q.nyResearchMethod??'Custom'));
 const code=base.join('|');parseForecastCode(code);return code;
}
export function parseForecastCode(code) {
 const a=String(code).trim().split('|');
 const nyResearchMethod=parseNYMethodToken(a.at(-1));
 const nyMethodMetadataPresent=nyResearchMethod!==null;
 if(nyMethodMetadataPresent)a.pop();
 const v=a.slice(1).map(Number);
 const expansionPrefix=instrument.expansionPrefix??(instrument.id==='NQ'?'SPNQ2':'SP6');
 const expanded=a.length===19&&a[0]===expansionPrefix,envelope=expanded||(a.length===15&&a[0]===instrument.forecastPrefix);
 if(!((instrument.id==='CL'&&a.length===11&&a[0]==='SP4')||envelope)||a.slice(1).some(x=>x.trim()==='')||v.some(x=>!Number.isFinite(x)))throw new Error('Invalid '+instrument.id+' forecast code.');
 const [start,end,price,up,down,n,containment,touchUp,touchDown,avr]=v;
 if(start<=0||end<=start||end-start>13*3600000||up<0||down<0||!Number.isInteger(n)||n<1||avr<=0||[containment,touchUp,touchDown].some(x=>x<0||x>100))throw new Error('Invalid SP4 forecast values.');
 const [maxUp,maxDown,medianUp,medianDown]=envelope?v.slice(10,14):[up,down,null,null];
 if(envelope&&(maxUp<up||maxDown<down||medianUp<0||medianDown<0||medianUp>maxUp||medianDown>maxDown))throw Error('Invalid envelope values.');
 const [rangeHigh,rangeLow,extensionUpPoints,extensionDownPoints]=expanded?v.slice(14,18):[null,null,null,null];
 if(expanded&&(rangeHigh<rangeLow||price<rangeLow-1e-8||price>rangeHigh+1e-8||extensionUpPoints<0||extensionDownPoints<0))throw Error('Invalid cutoff range or expansion distances.');
 return {start,end,price,up,down,n,containment,touchUp,touchDown,avr,maxUp,maxDown,medianUp,medianDown,rangeHigh,rangeLow,extensionUpPoints,extensionDownPoints,nyResearchMethod,nyMethodMetadataPresent};
}
export function makeChartPine(template,box,q,{anchorMode='Frozen 04:30'}={}) {
 const code=box?makeForecastCode(box,q):'';
 const field=q?.minute===510?'NY forecast code (08:30)':q?.minute===300?'05:00 forecast code (optional)':'Forecast code from website';
 const needle='input.string("", "'+field+'"';
 if(!template.includes(needle))throw Error('Indicator template unavailable.');
 let result=template.replace(needle,'input.string('+JSON.stringify(code)+', "'+field+'"').replace('input.string("Frozen 04:30", "AVR anchor"','input.string('+JSON.stringify(anchorMode)+', "AVR anchor"');
 return result;
}
