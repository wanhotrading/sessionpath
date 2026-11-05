import {validatePersonalRead,nyClock,READ_SCHEMA,PROFILE} from './tradingview-live-core.mjs';
import {regime} from './research-core.mjs';
import {readSnapshot} from './window-engine.mjs';
import {nyTimestamp} from './planner-v3.mjs';

export const ASSISTANT_FORECAST_SCHEMA='sessionpath.assistant.forecast.v1';
export const ASSISTANT_WINDOWS=Object.freeze({
 '03:00-05:00':Object.freeze({cutoff:'03:00',minute:180,endMinute:300}),
 '05:00-08:30':Object.freeze({cutoff:'05:00',minute:300,endMinute:510}),
 '08:30-16:00':Object.freeze({cutoff:'08:30',minute:510,endMinute:960})
});
const failure=(code,message)=>Object.assign(new Error(message),{code});
const finite=Number.isFinite;
const samePrice=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=1e-7;
const validDate=date=>typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&finite(Date.parse(date+'T12:00:00Z'))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date;
const previousDate=date=>new Date(Date.parse(date+'T12:00:00Z')-86400000).toISOString().slice(0,10);
export const ASSISTANT_HISTORY_URL=new URL('./assistant-historical-inputs.json',import.meta.url).href;
export const EXPLICIT_AVR_PROFILE='explicit-prior10-0930-1600-frozen-before1930-v1';

export function validateForecastRequest(input,market,now=Date.now()){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['requestId','market','window','date'].includes(key)))throw failure('INVALID_REQUEST','Choose a market and one SessionPath window.');
 if(typeof input.requestId!=='string'||!/^[\w-]{1,80}$/.test(input.requestId))throw failure('INVALID_REQUEST','The forecast request is missing a valid request ID.');
 if(!['CL','NQ','ES','GC'].includes(input.market))throw failure('INVALID_MARKET','Select CL, NQ, ES or GC futures.');
 if(input.market!==market)throw failure('MARKET_MISMATCH','Open the matching market before requesting its forecast.');
 if(!Object.hasOwn(ASSISTANT_WINDOWS,input.window))throw failure('INVALID_WINDOW','Choose 03:00–05:00, 05:00–08:30 or 08:30–16:00 New York time.');
 const date=input.date??null,today=nyClock(now).date;
 if(date!==null&&!validDate(date))throw failure('INVALID_DATE','Use a valid trading date in YYYY-MM-DD format.');
 if(date!==null&&date>today)throw failure('FUTURE_DATE','That New York trading date has not occurred yet.');
 return {...input,date,historical:date!==null&&date<today,...ASSISTANT_WINDOWS[input.window]};
}

function sessionAt(source,timeline,start,end){
 const layout={start:timeline.startMinute??-270,step:timeline.stepMinutes??timeline.step??5,scale:timeline.priceScale??100},from=(start-layout.start)/layout.step,to=(end-layout.start)/layout.step;
 if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<=from)return null;
 let high=-Infinity,low=Infinity,close=null;
 for(let i=from;i<to;i++){
  const[h,l,c]=source[2].slice(i*3,i*3+3);if(![h,l,c].every(finite)||h<l||c>h||c<l)return null;
  high=Math.max(high,h/layout.scale);low=Math.min(low,l/layout.scale);close=c/layout.scale;
 }
 return {high,low,close};
}

// Research snapshots read the actual decision open and only completed earlier
// candles. Reading a saved day's future H/L/C is never needed to build inputs.
export function archivedForecastRecord(days,timeline,request){
 const day=days.find(d=>d.date===request.date);if(!day)return null;
 const observed=readSnapshot(day,timeline,request.minute);if(!observed)return null;
 const source=(Array.isArray(timeline)?timeline:timeline.rows)?.find(row=>row[0]===day.index);if(!source)return null;
 const asia=sessionAt(source,timeline,-270,120),london=request.minute===510?sessionAt(source,timeline,180,510):null;
 return {market:request.market,date:day.date,contract:day.contract,source:{provider:'SessionPath research archive',avrProfile:EXPLICIT_AVR_PROFILE,priceBasis:'Explicit delivery contract; archived frozen ten-session AVR.'},snapshot:{cutoff:request.cutoff,as_of:new Date(nyTimestamp(day.date,request.minute)).toISOString(),reference_price:observed.closePrice,avr:day.avr,open_1930:day.open1930,range_high:observed.runningHigh,range_low:observed.runningLow,prior_high:day.priorHigh,prior_low:day.priorLow,prior_ny_date:day.priorDate,last_hour_behavior:observed.behavior,asia_high:asia?.high??null,asia_low:asia?.low??null,asia_close:asia?.close??null,asia_complete:Boolean(asia),london_high:london?.high??null,london_low:london?.low??null,london_close:london?.close??null,london_complete:Boolean(london)}};
}

export function validateHistoricalRecord(record,request){
 const s=record?.snapshot,tick={CL:.01,NQ:.25,ES:.25,GC:.1}[request.market],unavailable=()=>failure('HISTORICAL_UNAVAILABLE',`No verified ${request.market} ${request.cutoff} inputs are available for ${request.date}.`);
 if(!record||record.market!==request.market||record.date!==request.date||!s||s.cutoff!==request.cutoff||Date.parse(s.as_of)!==nyTimestamp(request.date,request.minute))throw unavailable();
 const contractPattern=new RegExp('^(?:[A-Z0-9_]+:)?'+request.market+'(?:[FGHJKMNQUVXZ]\\d{4}|1!)$');
 if(typeof record.contract!=='string'||!contractPattern.test(record.contract)||!record.source?.provider||![EXPLICIT_AVR_PROFILE,PROFILE].includes(record.source.avrProfile)||record.source.avrProfile===PROFILE&&!record.contract.endsWith('1!')||record.source.avrProfile===EXPLICIT_AVR_PROFILE&&record.contract.endsWith('1!'))throw unavailable();
 if(!['reference_price','open_1930','range_high','range_low','prior_high','prior_low'].every(key=>finite(s[key])&&s[key]>0&&s[key]<=1e9&&Math.abs(s[key]/tick-Math.round(s[key]/tick))<1e-5)||!(finite(s.avr)&&s.avr>0)||s.prior_high<=s.prior_low||s.range_high<=s.range_low||s.range_high<Math.max(s.reference_price,s.open_1930)||s.range_low>Math.min(s.reference_price,s.open_1930)||!validDate(s.prior_ny_date)||s.prior_ny_date>=request.date)throw unavailable();
 if(s.avr_dates!=null){
  if(!Array.isArray(s.avr_dates)||s.avr_dates.length!==10||new Set(s.avr_dates).size!==10||s.avr_dates.some((date,i)=>!validDate(date)||date>=request.date||i>0&&date<=s.avr_dates[i-1])||s.avr_count!==10||s.prior_ny_count!==78||s.avr_dates.at(-1)!==s.prior_ny_date||Date.parse(s.avr_frozen_at)!==nyTimestamp(previousDate(request.date),1170))throw unavailable();
 }
 for(const name of ['asia','london'])if(s[name+'_complete']){
  const hi=s[name+'_high'],lo=s[name+'_low'],close=s[name+'_close'];if(![hi,lo,close].every(finite)||hi<=lo||close<lo||close>hi)throw unavailable();
 }
 if(request.minute===510&&(!s.asia_complete||!s.london_complete))throw unavailable();
 return record;
}

export function supplementForecastRecord(payload,request){
 if(payload?.schema!=='sessionpath.assistant.historical-inputs.v1'||!Array.isArray(payload.records))return null;
 const matches=payload.records.filter(record=>record.market===request.market&&record.date===request.date&&record.snapshot?.cutoff===request.cutoff);
 if(matches.length>1)throw failure('HISTORICAL_UNAVAILABLE','The historical input archive has conflicting records for this date.');
 return matches.length?validateHistoricalRecord(matches[0],request):null;
}

export function historicalFeedRecord(body,request){
 if(body?.schema!=='sessionpath.tradingview.history.v1'||body.status!=='ready'||body.date!==request.date||body.validationBasis!=='authenticated_pine_attestation')return null;
 const received=Date.parse(body.receivedAt);if(!finite(received))return null;
 // Validate the historical packet against its original receipt time, preserving
 // every profile/coverage check without pretending that it is fresh today.
 let packet;try{packet=validatePersonalRead({...body,schema:READ_SCHEMA},{market:request.market,now:received});}catch{return null;}
 if(packet?.session_date!==request.date)return null;
 const snapshot=packet.snapshots.find(s=>s.cutoff===request.cutoff);if(!snapshot)return null;
 return validateHistoricalRecord({market:request.market,date:request.date,contract:packet.source_symbol,source:{provider:'TradingView personal Pine alert',avrProfile:packet.avr_profile,priceBasis:'Continuous front contract, unadjusted.',observedAt:packet.observed_at,receivedAt:body.receivedAt},snapshot},request);
}

export async function loadHistoricalForecast({request,archive,loadSupplement,feedURL,fetchImpl=(...args)=>fetch(...args)}){
 if(archive)return validateHistoricalRecord(archive,request);
 if(loadSupplement){let payload;try{payload=await loadSupplement();}catch{}if(payload){const record=supplementForecastRecord(payload,request);if(record)return record;}}
 if(feedURL){const target=new URL('/api/history',feedURL);target.searchParams.set('market',request.market);target.searchParams.set('date',request.date);const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
  try{const response=await fetchImpl(target,{credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});if(response.ok){const record=historicalFeedRecord(await response.json(),request);if(record)return record;}}catch{}finally{clearTimeout(timeout);}
 }
 throw failure('HISTORICAL_UNAVAILABLE',`No verified ${request.market} ${request.cutoff} inputs are available for ${request.date}. Today’s prices were not substituted.`);
}

export function expansionResult(observations,q){
 const cutoff={180:'p03',300:'p05',510:'p0830'}[q?.minute];
 if(!cutoff||q.endMinute!==({p03:300,p05:510,p0830:960}[cutoff]))return null;
 if(!Array.isArray(observations?.avr))throw failure('EXPANSION_UNAVAILABLE','The separate expansion history is unavailable.');
 const previous=q.observations||[],at=minute=>previous.find(p=>p.minute===minute&&finite(p.printed))?.printed??null;
 const input={date:q.date,cutoff,avr:q.avr,printed:q.printed,p03:at(180),p05:at(300),target:.75};
 const s=regime(observations.avr.filter(row=>!q.year||row.year===String(q.year)),input);
 const measured=(value,definition)=>({p:value.p,k:value.k,n:value.n,interval:[value.lo,value.hi],definition});
 return {cohort:'Separate printed-AVR-bin history; forecast tags, BBOX position and nearest-case limits do not filter this sample.',units:'fraction',sampleCount:s.n,eligibleCount:s.total,conditions:{printedBand:s.bin,year:q.year||'',earlier03Printed:input.p03,earlier05Printed:input.p05},percentile:s.percentile,meanAddedAvr:s.mean,medianAddedAvr:s.median,
  noFurtherExpansion:measured(s.zero,'The running high–low since 19:30 did not expand further by this window’s endpoint.'),
  add25:measured(s.extra25,'The running high–low since 19:30 expanded by at least another 25 percentage points of frozen AVR by this window’s endpoint.')};
}

// Only the model that just rendered may supply numbers. The LLM never calculates
// boundaries or historical frequencies, and old output is not a fallback.
export function forecastResult({request,packet,receivedAt,snapshot,model,now=Date.now()}){
 const q=model?.query,b=model?.box;
 if(model?.exportBlocked)throw failure('EXPORT_UNAVAILABLE',model.error||'The selected forecast cannot be exported.');
 if(!q||!b||!model.code)throw failure('FORECAST_UNAVAILABLE','The requested forecast is not ready. Try again after the research finishes loading.');
 if(q.date!==packet.session_date||q.minute!==request.minute||b.endMinute!==request.endMinute||!samePrice(q.price,snapshot.reference_price)||!samePrice(q.avr,snapshot.avr))throw failure('FORECAST_MISMATCH','The forecast no longer matches the requested TradingView checkpoint. Try again.');
 if(!(b.n>0)||!Number.isInteger(b.n)||![b.upPoints,b.downPoints,b.coverage,b.touchUp,b.touchDown].every(finite)||b.upPoints<0||b.downPoints<0||[b.coverage,b.touchUp,b.touchDown].some(p=>p<0||p>1))throw failure('FORECAST_UNAVAILABLE','No valid historical sample is available for this forecast.');
 if(request.historical&&(!Array.isArray(b.dates)||b.dates.length!==b.n||b.dates.some(date=>!validDate(date)||date>=q.date)))throw failure('HISTORICAL_LOOKAHEAD','The historical forecast does not have a verified earlier-date sample.');
 const frequency=(p,definition,interval)=>({p,k:Math.round(p*b.n),n:b.n,...(Array.isArray(interval)?{interval:[...interval]}:{}),definition});
 const orangeUp=finite(b.extensionUpPoints)&&finite(q.rangeHigh)?q.rangeHigh+b.extensionUpPoints:null;
 const orangeDown=finite(b.extensionDownPoints)&&finite(q.rangeLow)?q.rangeLow-b.extensionDownPoints:null;
 const warnings=['Mean excursions are historical averages, not probability boundaries.','Containment and touch frequencies describe the same historical sample used to fit this box; they are not a trade win rate.'];
 if(b.n<50)warnings.push('Fewer than 50 matching dates: this is a small historical sample.');
 return {schema:ASSISTANT_FORECAST_SCHEMA,ok:true,requestId:request.requestId,market:request.market,window:request.window,date:packet.session_date,mode:request.historical?'historical':'live',timezone:'America/New_York',generatedAt:new Date(now).toISOString(),
  source:{provider:packet.source_provider||'TradingView',symbol:packet.source_symbol,observedAt:packet.observed_at,receivedAt,checkpoint:snapshot.cutoff,asOf:snapshot.as_of,avrProfile:packet.avr_profile,...(packet.price_basis?{priceBasis:packet.price_basis}:{}),...(packet.source_hash?{sha256:packet.source_hash}:{})},
  inputs:{decisionOpen:q.price,avr:q.avr,printedAvr:finite(q.printed)?q.printed:(snapshot.range_high-snapshot.range_low)/snapshot.avr,rangeHigh:q.rangeHigh,rangeLow:q.rangeLow},
  range:{upper:q.price+b.upPoints,lower:q.price-b.downPoints,upPoints:b.upPoints,downPoints:b.downPoints,medianUpPoints:finite(b.upMedianPoints)?b.upMedianPoints:null,medianDownPoints:finite(b.downMedianPoints)?b.downMedianPoints:null,orangeUpper:orangeUp,orangeLower:orangeDown,extensionUpPoints:finite(b.extensionUpPoints)?b.extensionUpPoints:null,extensionDownPoints:finite(b.extensionDownPoints)?b.extensionDownPoints:null},
  probabilities:{units:'fraction',containment:frequency(b.coverage,'The full historical window stayed within its fitted mean U/D box.',b.interval),upperTouch:frequency(b.touchUp,'The historical window reached or exceeded the fitted mean upper boundary.'),lowerTouch:frequency(b.touchDown,'The historical window reached or exceeded the fitted mean lower boundary.')},
  sampleCount:b.n,conditions:model.conditions||{},code:model.code,warnings};
}

export function createForecastRequester({market,feedURL,isReady=()=>true,isReplay=()=>false,isHistorical=()=>false,context=()=>'',applySnapshot,prepareLive,readForecast,readHistorical,readExpansion,fetchImpl=(...args)=>fetch(...args),now=()=>Date.now()}){
 let busy=false,assistantHistoricalContext=null;
 const run=async input=>{
  let request,resumeAssistantHistory=false;
  try{
   request=validateForecastRequest(input,market,now());
   if(busy)throw failure('REQUEST_BUSY','A forecast is already loading. Please wait for it to finish.');
   if(!isReady())throw failure('RESEARCH_LOADING','SessionPath research is still loading. Try again in a moment.');
   resumeAssistantHistory=!request.historical&&isReplay()&&assistantHistoricalContext!==null&&assistantHistoricalContext===context()&&typeof prepareLive==='function';
   if(!request.historical&&isReplay()&&!resumeAssistantHistory)throw failure('REPLAY_ACTIVE','Turn Replay off before requesting today’s live forecast.');
   if(!request.historical&&isHistorical())throw failure('HISTORICAL_MODE','Return to planning before requesting today’s live forecast.');
  }catch(error){return errorResult(input,market,error);}
  busy=true;const before=context(),controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
  try{
   let packet,snapshot,receivedAt;
   if(request.historical){
    if(!readHistorical)throw failure('HISTORICAL_UNAVAILABLE',`No verified historical input source is configured for ${request.date}.`);
    let record;try{record=validateHistoricalRecord(await readHistorical({request}),request);}catch(error){throw error.code?error:failure('HISTORICAL_UNAVAILABLE',`The historical inputs for ${request.date} could not be loaded. Today’s prices were not substituted.`);}
    snapshot=record.snapshot;receivedAt=record.source.receivedAt??null;
    packet={session_date:record.date,source_symbol:record.contract,observed_at:record.source.observedAt||snapshot.as_of,avr_profile:record.source.avrProfile,source_provider:record.source.provider,price_basis:record.source.priceBasis||'Explicit delivery contract; frozen historical inputs.',source_hash:record.source.sha256};
   }else{
    const target=new URL(feedURL);target.searchParams.set('market',market);
    const response=await fetchImpl(target,{credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});
    if(!response.ok)throw failure('FEED_UNAVAILABLE','Failed to fetch the current TradingView feed.');
    const body=await response.json();receivedAt=body.receivedAt;
    try{packet=validatePersonalRead(body,{market,now:now()});}catch{throw failure('FEED_UNAVAILABLE','A fresh, verified TradingView feed is unavailable. Try Auto-fill again.');}
    if(!packet)throw failure('CHECKPOINT_UNAVAILABLE','No complete TradingView checkpoint has arrived for today.');
    snapshot=packet.snapshots.find(s=>s.cutoff===request.cutoff);
    if(!snapshot){const clock=nyClock(now()),due=request.minute+5;throw failure('CHECKPOINT_UNAVAILABLE',clock.minute<due?`The ${request.cutoff} New York checkpoint is available after its first five-minute candle closes.`:`The ${request.cutoff} New York checkpoint has not arrived. Check the sender’s coverage.`);}
   }
   const blocked=()=>!request.historical&&(isReplay()&&!resumeAssistantHistory||isHistorical());
   if(!isReady()||blocked()||context()!==before)throw failure('INPUTS_CHANGED','Your inputs changed while the forecast was loading. Please request it again.');
   // Only an assistant-owned historical view may return to live automatically,
   // and only after today's exact checkpoint has been fetched and validated.
   if(resumeAssistantHistory){await prepareLive({request,snapshot,packet});if(isReplay())throw failure('REPLAY_ACTIVE','Turn Replay off before requesting today’s live forecast.');resumeAssistantHistory=false;}
   await applySnapshot({request,snapshot,packet});
   const appliedContext=context();
   const model=await readForecast({request,snapshot,packet});
   if(blocked()||context()!==appliedContext)throw failure('INPUTS_CHANGED','Your inputs changed while the forecast was loading. Please request it again.');
   const result=forecastResult({request,packet,receivedAt,snapshot,model,now:now()});
   if(readExpansion){
    let expiry;try{result.expansion=await Promise.race([Promise.resolve(readExpansion({request,snapshot,packet,model})),new Promise((_,reject)=>{expiry=setTimeout(()=>reject(failure('EXPANSION_UNAVAILABLE','The separate expansion history is still loading.')),4000);})]);}
    catch{result.expansion=null;result.warnings.push('The separate compression/expansion history is unavailable; mean-box results are unchanged.');}
    finally{clearTimeout(expiry);}
   }
   if(blocked()||context()!==appliedContext)throw failure('INPUTS_CHANGED','Your inputs changed while the forecast was loading. Please request it again.');
   assistantHistoricalContext=request.historical?context():null;
   return result;
  }catch(error){return errorResult(input,market,error);}
  finally{clearTimeout(timeout);busy=false;}
 };
 run.resetHistoricalOwnership=()=>{assistantHistoricalContext=null;};
 return run;
}

function errorResult(input,market,error){return {schema:ASSISTANT_FORECAST_SCHEMA,ok:false,requestId:typeof input?.requestId==='string'?input.requestId.slice(0,80):'',market,window:typeof input?.window==='string'?input.window:'',date:validDate(input?.date)?input.date:null,error:{code:error.code||'FEED_UNAVAILABLE',message:error.code?error.message:error.name==='AbortError'?'The TradingView feed timed out. Try again.':'Failed to fetch the current TradingView forecast.'}};}

export function mountAssistantForecastAdapter(options){
 const doc=options.document||globalThis.document,models=new Map();
 const capture=event=>{const model=event.detail?.model;if(model?.query&&model.code)models.set(model.query.minute,model);};
 doc.addEventListener('sessionpath:forecast-export',capture);
 const request=createForecastRequester({...options,applySnapshot:args=>{models.delete(args.request.minute);return options.applySnapshot(args);},readForecast:async args=>{
  const direct=options.readForecast?.(args);if(direct&&direct.exportPending!==true)return direct;
  // NY’s existing renderer can await its canonical research reference. Listen
  // for its structured export instead of scraping text from the result panel.
  const matching=()=>{const model=models.get(args.request.minute);return model?.exportPending!==true&&model?.query.date===args.packet.session_date&&samePrice(model?.query.price,args.snapshot.reference_price)&&samePrice(model?.query.avr,args.snapshot.avr)?model:null;};
  if(matching())return matching();
  return new Promise(resolve=>{let timeout;const check=()=>{const model=matching();if(model){clearTimeout(timeout);doc.removeEventListener('sessionpath:forecast-export',check);resolve(model);}};doc.addEventListener('sessionpath:forecast-export',check);timeout=setTimeout(()=>{doc.removeEventListener('sessionpath:forecast-export',check);resolve(null);},8000);check();});
 }});
 const onRequest=async event=>{
  // Invalid events still receive a bounded, structured error for their caller.
  const result=await request(event.detail);doc.dispatchEvent(new doc.defaultView.CustomEvent('sessionpath:assistant-result',{detail:result}));
 };
 doc.addEventListener('sessionpath:assistant-request',onRequest);
 const manualReplay=event=>{if(event.isTrusted&&['replay-toggle','replay-date'].includes(event.target?.id))request.resetHistoricalOwnership();};
 doc.addEventListener('change',manualReplay);
 const clear=()=>{models.clear();doc.removeEventListener('sessionpath:forecast-export',capture);doc.removeEventListener('sessionpath:assistant-request',onRequest);doc.removeEventListener('change',manualReplay);};
 doc.defaultView?.addEventListener('pagehide',clear,{once:true});
 return {request,destroy:clear};
}
