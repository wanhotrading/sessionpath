import {bucket,pathClass} from './window-engine.mjs';

const numeric=value=>typeof value==='number'&&Number.isFinite(value);
const same=(a,b)=>numeric(a)&&numeric(b)&&Math.abs(a-b)<=1e-8;
const fail=message=>{throw Error(message);};
const nyParts=time=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(time*1000)).map(part=>[part.type,part.value]));
const nyDate=p=>p.year+'-'+p.month+'-'+p.day;
const previousDate=date=>new Date(Date.parse(date+'T12:00:00Z')-86400000).toISOString().slice(0,10);
const labels=['Higher finish','Lower finish','Trend up then fade','Trend down then recover','Little net change'];

function validateIdentity(receipt,result,schema){
 if(!receipt||receipt.schema!==schema||receipt.status!=='ready'||['market','date','contract'].some(key=>receipt[key]!==result[key]))fail('The chart observation receipt does not match this market, contract and date.');
}

export function validatedFrozenAVR(result,{convention}={}){
 const receipt=result.avr,value=result.values?.avr;
 if(value===undefined){if(receipt?.status==='ready')fail('The frozen AVR receipt is incomplete.');return null;}
 validateIdentity(receipt,result,'sessionpath.frozen-avr.v1');
 const expectedConvention=result.market==='GC'?convention?.id:'sessionpath-shared-ny-v1';
 if(!expectedConvention||receipt.convention!==expectedConvention||receipt.timeZone!=='America/New_York'||receipt.session?.start!=='09:30'||receipt.session?.end!=='16:00'||![300,900].includes(receipt.intervalSeconds))fail('The frozen AVR uses a different session reference.');
 if(!numeric(value)||!(value>0)||!same(receipt.value,value)||receipt.n!==10||!Array.isArray(receipt.dates)||receipt.dates.length!==10||new Set(receipt.dates).size!==10||!Array.isArray(receipt.ranges)||receipt.ranges.length!==10||receipt.ranges.some(range=>!numeric(range)||range<=0))fail('The frozen AVR requires ten complete same-contract reference sessions.');
 const freezeDate=previousDate(result.date);
 if(receipt.freezeDate!==freezeDate||receipt.dates.some((date,i)=>!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>freezeDate||i>0&&date>=receipt.dates[i-1]))fail('The frozen AVR includes a reference session after its freeze time.');
 if(!Number.isSafeInteger(receipt.freezeTime))fail('The frozen AVR freeze time is invalid.');
 const frozen=nyParts(receipt.freezeTime);
 if(nyDate(frozen)!==freezeDate||frozen.hour!=='19'||frozen.minute!=='30'||frozen.second!=='00'||!same(receipt.ranges.reduce((sum,range)=>sum+range,0)/10,value))fail('The frozen AVR does not match the ten-session arithmetic mean frozen at 19:30 New York.');
 return {value,receipt};
}

export function validatedObservableFields(result,{convention}={}){
 const values=result.values||{},issues=[],avr=validatedFrozenAVR(result,{convention});
 let decisionOpen=null,behavior=null,range={rangeHigh:values.rangeHigh,rangeLow:values.rangeLow,open1930:values.open1930,up:values.up,down:values.down};
 if(values.decisionOpen!==undefined){
  if(!numeric(values.decisionOpen))fail('The decision open must be a finite price.');
  decisionOpen=values.decisionOpen;
  if(result.decisionOpen!==undefined){
   const receipt=result.decisionOpen;validateIdentity(receipt,result,'sessionpath.decision-open.v1');
   if(receipt.cutoff!==result.cutoff||!same(receipt.open,decisionOpen)||!Number.isSafeInteger(receipt.time))fail('The decision-open receipt does not match the selected cutoff.');
   const parts=nyParts(receipt.time);
   if(nyDate(parts)!==result.date||parts.hour+':'+parts.minute!==result.cutoff||parts.second!=='00')fail('The decision-open receipt uses a different New York cutoff.');
  }
 }else issues.push('Decision open unavailable');
 if(result.observableRange?.status==='unavailable')issues.push('Known-open range receipt unavailable');
 else if(result.observableRange!==undefined){
  const receipt=result.observableRange;validateIdentity(receipt,result,'sessionpath.observable-range.v1');
  if(decisionOpen===null||receipt.cutoff!==result.cutoff||receipt.timeZone!=='America/New_York'||receipt.includesCutoffOpen!==true||!same(receipt.decisionOpen,decisionOpen)||!same(receipt.open1930,values.open1930)||!same(receipt.rangeHigh,Math.max(values.rangeHigh,decisionOpen))||!same(receipt.rangeLow,Math.min(values.rangeLow,decisionOpen))||!same(receipt.up,receipt.rangeHigh-values.open1930)||!same(receipt.down,values.open1930-receipt.rangeLow))fail('The observable range does not match completed candles plus the known cutoff open.');
  range={rangeHigh:receipt.rangeHigh,rangeLow:receipt.rangeLow,open1930:receipt.open1930,up:receipt.up,down:receipt.down};
 }
 if(!avr)issues.push('Ten-session frozen AVR unavailable');
 if(values.behavior!==undefined){
  const receipt=result.lastHour;validateIdentity(receipt,result,'sessionpath.last-hour.v1');
  if(!avr||!labels.includes(values.behavior)||receipt.behavior!==values.behavior||!same(receipt.avr,avr.value)||!numeric(receipt.baseClose)||!Array.isArray(receipt.closes)||receipt.closes.length!==12||receipt.closes.some(close=>!numeric(close))||!Array.isArray(receipt.path)||receipt.path.length!==12||receipt.path.some((part,i)=>!same(part,(receipt.closes[i]-receipt.baseClose)/avr.value))||!Number.isSafeInteger(receipt.start)||!Number.isSafeInteger(receipt.end)||receipt.end-receipt.start!==3600)fail('The last-hour behavior requires twelve completed five-minute closes and the same frozen AVR.');
  const parts=nyParts(receipt.end);
  if(nyDate(parts)!==result.date||parts.hour+':'+parts.minute!==result.cutoff||parts.second!=='00'||pathClass(receipt.path)!==values.behavior)fail('The completed last-hour behavior does not match the research rule.');
  behavior=values.behavior;
 }else issues.push('Completed five-minute last-hour behavior unavailable');
 if(decisionOpen!==null&&(decisionOpen<range.rangeLow-1e-8||decisionOpen>range.rangeHigh+1e-8))issues.push('Known-open range receipt unavailable; update high/low before forecasting');
 return {decisionOpen,avr:avr?.value??null,behavior,range,includesCutoffOpen:result.observableRange?.includesCutoffOpen===true,issues};
}

const fieldValue=value=>value===''||value===null||value===undefined?null:Number(value);
const staleGenerated=(previous,result,id,current)=>previous&&previous.fields?.[id]!==undefined&&String(current[id])===String(previous.fields[id])&&(previous.date!==result.date||previous.contract!==result.contract||id==='behavior'&&previous.cutoff!==result.cutoff);

export function mainAutoFillPlan(result,{units='points',current={},previous,convention}={}){
 const observed=validatedObservableFields(result,{convention}),data={...result.values,...observed.range},updates={'prior-low':data.priorLow,'prior-high':data.priorHigh,open1930:data.open1930,'range-high':data.rangeHigh,'range-low':data.rangeLow};
 const missing=[...observed.issues];
 if(observed.decisionOpen!==null)updates.price=observed.decisionOpen;
 else if(staleGenerated(previous,result,'price',current))updates.price='';
 if(observed.avr!==null)updates.avr=observed.avr;
 else if(staleGenerated(previous,result,'avr',current))updates.avr='';
 if(observed.behavior!==null)updates.behavior=observed.behavior;
 else if(staleGenerated(previous,result,'behavior',current))updates.behavior='';
 const avr=observed.avr??(updates.avr===''?null:fieldValue(current.avr)),price=observed.decisionOpen;
 if(units==='points'){updates.up=data.up;updates.down=data.down;}
 else if(units==='percent'&&avr>0){updates.up=data.up*100/avr;updates.down=data.down*100/avr;}
 else if(units==='percent'){updates.up='';updates.down='';}
 else fail('The selected U/D input units are invalid.');
 if(avr>0)updates.printed=(data.rangeHigh-data.rangeLow)/avr*100;
 else updates.printed='';
 if(price!==null){
  updates.location=bucket((price-data.priorLow)/(data.priorHigh-data.priorLow));
  if(data.rangeHigh>data.rangeLow){const position=Math.max(0,Math.min(1,(price-data.rangeLow)/(data.rangeHigh-data.rangeLow)));updates['range-position']=(.1+.2*Math.min(4,Math.floor(position*5))).toFixed(1);}
 }
 const autoFields=Object.fromEntries(Object.entries(updates).filter(([key])=>!['avr','behavior'].includes(key)||observed[key]!==null));
 return {updates,missing,usedManualAVR:observed.avr===null&&avr>0,includesCutoffOpen:observed.includesCutoffOpen,forecastReady:price!==null&&price>=data.rangeLow&&price<=data.rangeHigh&&avr>0&&data.rangeHigh>data.rangeLow&&updates.printed<=2000,provenance:{date:result.date,contract:result.contract,cutoff:result.cutoff,fields:autoFields}};
}

export function autoFillSourceStatus(result){
 const parts=nyParts(Date.parse(result.generatedAt)/1000);
 const prior=/^\d{4}-\d{2}-\d{2}$/.test(result.priorDate||'')?' · prior NY '+result.priorDate+(result.priorReference==='latest-complete-before-1930'?' (latest complete)':''):'';
 return result.source+' · '+result.contract+' · '+result.date+' '+result.cutoff+' NY'+prior+' · fetched '+parts.hour+':'+parts.minute+':'+parts.second+' NY';
}

export function autoFillFailureMessage(error){
 if(error?.name==='AbortError')return 'The chart-data request timed out. Your existing inputs were kept. Try Auto-fill again.';
 if(error?.name==='TypeError'&&/fetch|network|load failed/i.test(error.message||'')||/^(?:failed to fetch|fetch failed|load failed|networkerror(?:\b|:))/i.test(error?.message||''))return 'Cannot reach the chart-data service. Your existing inputs were kept. Check your connection and try Auto-fill again.';
 return error?.message||'Auto-fill failed. Your existing inputs were kept. Try again.';
}
