import {validatePersonalRead,nyClock} from './tradingview-live-core.mjs';
import {regime} from './research-core.mjs';

export const ASSISTANT_FORECAST_SCHEMA='sessionpath.assistant.forecast.v1';
export const ASSISTANT_WINDOWS=Object.freeze({
 '03:00-05:00':Object.freeze({cutoff:'03:00',minute:180,endMinute:300}),
 '05:00-08:30':Object.freeze({cutoff:'05:00',minute:300,endMinute:510}),
 '08:30-16:00':Object.freeze({cutoff:'08:30',minute:510,endMinute:960})
});
const failure=(code,message)=>Object.assign(new Error(message),{code});
const finite=Number.isFinite;
const samePrice=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=1e-7;

export function validateForecastRequest(input,market){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['requestId','market','window'].includes(key)))throw failure('INVALID_REQUEST','Choose a market and one SessionPath window.');
 if(typeof input.requestId!=='string'||!/^[\w-]{1,80}$/.test(input.requestId))throw failure('INVALID_REQUEST','The forecast request is missing a valid request ID.');
 if(!['CL','NQ','ES','GC'].includes(input.market))throw failure('INVALID_MARKET','Select CL, NQ, ES or GC futures.');
 if(input.market!==market)throw failure('MARKET_MISMATCH','Open the matching market before requesting its forecast.');
 if(!Object.hasOwn(ASSISTANT_WINDOWS,input.window))throw failure('INVALID_WINDOW','Choose 03:00–05:00, 05:00–08:30 or 08:30–16:00 New York time.');
 return {...input,...ASSISTANT_WINDOWS[input.window]};
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
 const frequency=(p,definition,interval)=>({p,k:Math.round(p*b.n),n:b.n,...(Array.isArray(interval)?{interval:[...interval]}:{}),definition});
 const orangeUp=finite(b.extensionUpPoints)&&finite(q.rangeHigh)?q.rangeHigh+b.extensionUpPoints:null;
 const orangeDown=finite(b.extensionDownPoints)&&finite(q.rangeLow)?q.rangeLow-b.extensionDownPoints:null;
 const warnings=['Mean excursions are historical averages, not probability boundaries.','Containment and touch frequencies describe the same historical sample used to fit this box; they are not a trade win rate.'];
 if(b.n<50)warnings.push('Fewer than 50 matching dates: this is a small historical sample.');
 return {schema:ASSISTANT_FORECAST_SCHEMA,ok:true,requestId:request.requestId,market:request.market,window:request.window,date:packet.session_date,timezone:'America/New_York',generatedAt:new Date(now).toISOString(),
  source:{provider:'TradingView',symbol:packet.source_symbol,observedAt:packet.observed_at,receivedAt,checkpoint:snapshot.cutoff,asOf:snapshot.as_of,avrProfile:packet.avr_profile},
  inputs:{decisionOpen:q.price,avr:q.avr,printedAvr:finite(q.printed)?q.printed:(snapshot.range_high-snapshot.range_low)/snapshot.avr,rangeHigh:q.rangeHigh,rangeLow:q.rangeLow},
  range:{upper:q.price+b.upPoints,lower:q.price-b.downPoints,upPoints:b.upPoints,downPoints:b.downPoints,medianUpPoints:finite(b.upMedianPoints)?b.upMedianPoints:null,medianDownPoints:finite(b.downMedianPoints)?b.downMedianPoints:null,orangeUpper:orangeUp,orangeLower:orangeDown,extensionUpPoints:finite(b.extensionUpPoints)?b.extensionUpPoints:null,extensionDownPoints:finite(b.extensionDownPoints)?b.extensionDownPoints:null},
  probabilities:{units:'fraction',containment:frequency(b.coverage,'The full historical window stayed within its fitted mean U/D box.',b.interval),upperTouch:frequency(b.touchUp,'The historical window reached or exceeded the fitted mean upper boundary.'),lowerTouch:frequency(b.touchDown,'The historical window reached or exceeded the fitted mean lower boundary.')},
  sampleCount:b.n,conditions:model.conditions||{},code:model.code,warnings};
}

export function createForecastRequester({market,feedURL,isReady=()=>true,isReplay=()=>false,isHistorical=()=>false,context=()=>'',applySnapshot,readForecast,readExpansion,fetchImpl=(...args)=>fetch(...args),now=()=>Date.now()}){
 let busy=false;
 return async input=>{
  let request;
  try{
   request=validateForecastRequest(input,market);
   if(busy)throw failure('REQUEST_BUSY','A forecast is already loading. Please wait for it to finish.');
   if(!isReady())throw failure('RESEARCH_LOADING','SessionPath research is still loading. Try again in a moment.');
   if(isReplay())throw failure('REPLAY_ACTIVE','Turn Replay off before requesting today’s live forecast.');
   if(isHistorical())throw failure('HISTORICAL_MODE','Return to planning before requesting today’s live forecast.');
  }catch(error){return errorResult(input,market,error);}
  busy=true;const before=context(),controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
  try{
   const target=new URL(feedURL);target.searchParams.set('market',market);
   const response=await fetchImpl(target,{credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});
   if(!response.ok)throw failure('FEED_UNAVAILABLE','Failed to fetch the current TradingView feed.');
   const body=await response.json();
   let packet;try{packet=validatePersonalRead(body,{market,now:now()});}catch{throw failure('FEED_UNAVAILABLE','A fresh, verified TradingView feed is unavailable. Try Auto-fill again.');}
   if(!packet)throw failure('CHECKPOINT_UNAVAILABLE','No complete TradingView checkpoint has arrived for today.');
   const snapshot=packet.snapshots.find(s=>s.cutoff===request.cutoff);
   if(!snapshot){const clock=nyClock(now()),due=request.minute+5;throw failure('CHECKPOINT_UNAVAILABLE',clock.minute<due?`The ${request.cutoff} New York checkpoint is available after its first five-minute candle closes.`:`The ${request.cutoff} New York checkpoint has not arrived. Check the sender’s coverage.`);}
   if(!isReady()||isReplay()||isHistorical()||context()!==before)throw failure('INPUTS_CHANGED','Your inputs changed while the forecast was loading. Please request it again.');
   await applySnapshot({request,snapshot,packet});
   const appliedContext=context();
   const model=await readForecast({request,snapshot,packet});
   if(isReplay()||isHistorical()||context()!==appliedContext)throw failure('INPUTS_CHANGED','Your inputs changed while the forecast was loading. Please request it again.');
   const result=forecastResult({request,packet,receivedAt:body.receivedAt,snapshot,model,now:now()});
   if(readExpansion){
    let expiry;try{result.expansion=await Promise.race([Promise.resolve(readExpansion({request,snapshot,packet,model})),new Promise((_,reject)=>{expiry=setTimeout(()=>reject(failure('EXPANSION_UNAVAILABLE','The separate expansion history is still loading.')),4000);})]);}
    catch{result.expansion=null;result.warnings.push('The separate compression/expansion history is unavailable; mean-box results are unchanged.');}
    finally{clearTimeout(expiry);}
   }
   if(isReplay()||isHistorical()||context()!==appliedContext)throw failure('INPUTS_CHANGED','Your inputs changed while the forecast was loading. Please request it again.');
   return result;
  }catch(error){return errorResult(input,market,error);}
  finally{clearTimeout(timeout);busy=false;}
 };
}

function errorResult(input,market,error){return {schema:ASSISTANT_FORECAST_SCHEMA,ok:false,requestId:typeof input?.requestId==='string'?input.requestId.slice(0,80):'',market,window:typeof input?.window==='string'?input.window:'',error:{code:error.code||'FEED_UNAVAILABLE',message:error.code?error.message:error.name==='AbortError'?'The TradingView feed timed out. Try again.':'Failed to fetch the current TradingView forecast.'}};}

export function mountAssistantForecastAdapter(options){
 const doc=options.document||globalThis.document,models=new Map();
 const capture=event=>{const model=event.detail?.model;if(model?.query&&model.code)models.set(model.query.minute,model);};
 doc.addEventListener('sessionpath:forecast-export',capture);
 const request=createForecastRequester({...options,applySnapshot:args=>{models.delete(args.request.minute);return options.applySnapshot(args);},readForecast:async args=>{
  const direct=options.readForecast?.(args);if(direct)return direct;
  // NY’s existing renderer can await its canonical research reference. Listen
  // for its structured export instead of scraping text from the result panel.
  const matching=()=>{const model=models.get(args.request.minute);return model?.query.date===args.packet.session_date&&samePrice(model?.query.price,args.snapshot.reference_price)&&samePrice(model?.query.avr,args.snapshot.avr)?model:null;};
  if(matching())return matching();
  return new Promise(resolve=>{let timeout;const check=()=>{const model=matching();if(model){clearTimeout(timeout);doc.removeEventListener('sessionpath:forecast-export',check);resolve(model);}};doc.addEventListener('sessionpath:forecast-export',check);timeout=setTimeout(()=>{doc.removeEventListener('sessionpath:forecast-export',check);resolve(null);},8000);check();});
 }});
 const onRequest=async event=>{
  // Invalid events still receive a bounded, structured error for their caller.
  const result=await request(event.detail);doc.dispatchEvent(new doc.defaultView.CustomEvent('sessionpath:assistant-result',{detail:result}));
 };
 doc.addEventListener('sessionpath:assistant-request',onRequest);
 const clear=()=>{models.clear();doc.removeEventListener('sessionpath:forecast-export',capture);doc.removeEventListener('sessionpath:assistant-request',onRequest);};
 doc.defaultView?.addEventListener('pagehide',clear,{once:true});
 return {request,destroy:clear};
}
