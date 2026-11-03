import {validatedObservableFields,mainAutoFillPlan,autoFillSourceStatus,autoFillFailureMessage} from './auto-fill-observables.mjs?v=complete-inputs-20261103';
export {validatedObservableFields,mainAutoFillPlan};
import {instrument} from './instrument.mjs';
import {computeNYPositionAutofill} from './ny-position-autofill-core.mjs';
import {fillLiveNYPositionHelper,positionFillUnavailable} from './ny-reference-v5.mjs?v=ny-timing-20261102';
import {directionFieldIDs,mountNYDirectionAutoFillStatus,directionFillPlan,applyDirectionFill,directionFillUnavailable} from './ny-direction-autofill.mjs';

const $=id=>document.getElementById(id);
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'});
const value=id=>$(id)?.value??'';
let requestSequence=0;

export function buildAutoFillURL(endpoint,{market,date,cutoff,nonce=Date.now()}){
 if(typeof endpoint!=='string'||!endpoint.trim())throw Error('Auto-fill’s live-data service is not configured. Please try again after it is connected.');
 let url;try{url=new URL(endpoint.trim());}catch{throw Error('Auto-fill’s live-data service URL is invalid.');}
 const host=url.hostname.toLowerCase().replace(/\.$/,''),ip=/^\d+\.\d+\.\d+\.\d+$/.test(host)?host.split('.').map(Number):null;
 const privateHost=!host.includes('.')||host.startsWith('[')||/(^|\.)(localhost|local|internal|invalid)$/.test(host)||ip&&(ip[0]===0||ip[0]===10||ip[0]===127||ip[0]>=224||ip[0]===169&&ip[1]===254||ip[0]===172&&ip[1]>=16&&ip[1]<=31||ip[0]===192&&ip[1]===168||ip[0]===100&&ip[1]>=64&&ip[1]<=127);
 if(url.protocol!=='https:'||url.username||url.password||url.hash||privateHost)throw Error('Auto-fill requires a public HTTPS live-data service URL.');
 url.searchParams.set('market',market);url.searchParams.set('date',date);url.searchParams.set('cutoff',cutoff);url.searchParams.set('v',String(nonce));
 return url.href;
}

let bellContext;
function prepareBell(){
 // Unlock during the button gesture; the delayed fetch must not trigger autoplay.
 try{
  const AudioContext=window.AudioContext||window.webkitAudioContext;
  if(!AudioContext)return null;
  if(!bellContext||bellContext.state==='closed')bellContext=new AudioContext();
  if(bellContext.state==='suspended')bellContext.resume().catch(()=>{});
  return bellContext;
 }catch{return null;}
}
function playBell(context){
 if(!context||context.state!=='running')return;
 try{
  const start=context.currentTime,output=context.createGain();
  output.gain.setValueAtTime(0,start);
  output.gain.linearRampToValueAtTime(.035,start+.015);
  output.gain.exponentialRampToValueAtTime(.0001,start+1.95);
  output.gain.linearRampToValueAtTime(0,start+2);
  output.connect(context.destination);
  const partials=[[880,1],[2376,.24],[3520,.08]];
  let remaining=partials.length;
  for(const [frequency,volume]of partials){
   const oscillator=context.createOscillator(),gain=context.createGain();
   oscillator.type='sine';oscillator.frequency.value=frequency;gain.gain.value=volume;
   oscillator.connect(gain);gain.connect(output);
   oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();if(!--remaining)output.disconnect();};
   oscillator.start(start);oscillator.stop(start+2.02);
  }
 }catch{/* Sound is optional; a successful fill must still complete. */}
}

export function autoFillCoverageNotice(coverage){
 if(coverage===undefined)return '';
 const invalid=()=>{throw Error('The delayed-data service returned an unrecognized coverage warning. Try auto-fill again.');};
 if(!coverage||typeof coverage!=='object'||Array.isArray(coverage)||coverage.policy!=='one-interior-overnight-candle-v1'||coverage.complete!==false||coverage.missingCount!==1||![300,900].includes(coverage.intervalSeconds)||coverage.window!=='overnight')invalid();
 if(!Number.isSafeInteger(coverage.missingTime)||coverage.missingTime<=0||coverage.missingTime%coverage.intervalSeconds||typeof coverage.warning!=='string'||!coverage.warning.trim())invalid();
 const fields=coverage.approximateFields;
 if(!Array.isArray(fields)||fields.length!==4||new Set(fields).size!==4||!['rangeHigh','rangeLow','up','down'].every(key=>fields.includes(key)))invalid();
 let parts;
 try{parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(coverage.missingTime*1000)).map(part=>[part.type,part.value]));}catch{invalid();}
 const timeNY=parts.year+'-'+parts.month+'-'+parts.day+', '+parts.hour+':'+parts.minute;
 if(coverage.missingTimeNY!==timeNY)invalid();
 return '1 missing '+(coverage.intervalSeconds/60)+'-minute overnight candle · '+timeNY+' NY. Filled from observed prices; high/low and U/D may miss an unseen extreme.';
}

function mountCoverageNotice(row,id){
 const note=document.createElement('p');note.id=id;note.className='auto-fill-coverage-note';note.hidden=true;note.setAttribute('role','status');note.setAttribute('aria-live','polite');row.append(note);return note;
}
function updateCoverageNotice(note,coverage){
 const message=autoFillCoverageNotice(coverage);note.textContent=message;note.hidden=!message;
}

export function validateAutoFill(result,{date,cutoff,market,now=Date.now(),requestStartedAt,allowedSources=['Yahoo Finance']}){
 if(!result||typeof result!=='object')throw Error('Delayed data is not ready. Try again later.');
 if(result.market!==market)throw Error(`The data service returned a different market. Select ${market} and try auto-fill again.`);
 if(result.date!==date)throw Error(`The data service returned a different trading date. Expected ${date} in New York.`);
 if(result.cutoff!==cutoff)throw Error(`The data service returned a different cutoff. Expected ${cutoff} New York.`);
 if(result.status!=='ready')throw Error(typeof result.error==='string'&&result.error?result.error:'Delayed candles are not complete for this cutoff yet. Try again later.');
 autoFillCoverageNotice(result.coverage);
 if(!Array.isArray(allowedSources)||!['Yahoo Finance','TradingView chart'].includes(result.source)||!allowedSources.includes(result.source)||result.continuous!==false||!new RegExp('^'+market+'[FGHJKMNQUVXZ]\\d{4}$').test(result.contract||''))throw Error('The front-month contract could not be verified.');
 if(result.source==='TradingView chart'&&!({CL:['NYMEX'],NQ:['CME_MINI','CME'],ES:['CME_MINI','CME'],GC:['COMEX']}[market]||[]).some(exchange=>result.sourceSymbol===exchange+':'+result.contract))throw Error('The personal chart does not identify the matching exchange and delivery contract.');
 const generatedAt=Date.parse(result.generatedAt);
 if(!Number.isFinite(generatedAt)||generatedAt>now+60000||now-generatedAt>120000||Number.isFinite(requestStartedAt)&&generatedAt<requestStartedAt-60000)throw Error('The data service returned an old response. Click auto-fill to fetch fresh delayed candles.');
 const data=result.values;
 if(!data||!['priorLow','priorHigh','open1930','rangeHigh','rangeLow','up','down'].every(k=>typeof data[k]==='number'&&Number.isFinite(data[k])))throw Error('The source returned incomplete prices.');
 if(!(data.priorHigh>data.priorLow&&data.rangeHigh>=data.open1930&&data.rangeLow<=data.open1930&&data.rangeHigh>=data.rangeLow&&data.up>=0&&data.down>=0))throw Error('The source returned inconsistent session prices.');
 if(Math.abs(data.up-(data.rangeHigh-data.open1930))>1e-6||Math.abs(data.down-(data.open1930-data.rangeLow))>1e-6)throw Error('The 19:30 excursions could not be verified.');
 if(cutoff==='08:30'&&!Number.isFinite(data.decisionOpen))throw Error('The delayed source has not supplied the 08:30 opening price yet. Try again later.');
 return data;
}


let customAutoFillTransport=null,transportRevision=0;
export function configureAutoFillTransport(handler){if(handler!==null&&typeof handler!=='function')throw Error('Auto-fill transport must be a function.');const previous=customAutoFillTransport;customAutoFillTransport=handler;transportRevision++;return()=>{if(customAutoFillTransport===handler){customAutoFillTransport=previous;transportRevision++;}};}
export async function fetchAutoFillResponse(request,{signal}={}){
 const returned=await(customAutoFillTransport?customAutoFillTransport(request,{signal}):fetch(request.endpoint,{signal,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'}));
 if(returned?.response&&returned.payload)return returned;
 const response=returned;
 let payload;try{payload=await response.json();}catch{throw Error('Could not read the chart-data service. Your existing inputs were kept. Try again.');}
 return {response,payload,allowedSources:['Yahoo Finance']};
}
function mountFillStatus(row,id){const status=document.createElement('p');status.id=id;status.className='auto-fill-source-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.textContent='Fill known chart inputs for the selected decision time.';row.append(status);return status;}
function fillStatus(status,text,state='ready'){status.textContent=text;status.dataset.state=state;}
function provenanceKey(kind){return 'sessionpath-autofill-observables-v1:'+instrument.id+':'+kind;}
function previousFill(kind){try{const receipt=JSON.parse(sessionStorage.getItem(provenanceKey(kind))||'null');return receipt&&typeof receipt==='object'?receipt:null;}catch{return null;}}
function saveFill(kind,receipt,targets){try{const previous=previousFill(kind),fields=Object.fromEntries(Object.keys(receipt.fields).filter(id=>$(id)).map(id=>[id,value(id)]));if(previous?.date===receipt.date&&previous.contract===receipt.contract)for(const[id,oldValue]of Object.entries(previous.fields||{}))if(!Object.hasOwn(fields,id)&&value(id)===oldValue&&(id!=='behavior'||previous.cutoff===receipt.cutoff))fields[id]=oldValue;sessionStorage.setItem(provenanceKey(kind),JSON.stringify({...receipt,fields}));}catch{}}
function applyFilledValues(updates){const targets=Object.keys(updates).map($);if(targets.some(input=>!input))throw Error('The session inputs are not ready. Reload and try again.');for(const[id,number]of Object.entries(updates))$(id).value=typeof number==='number'?String(Number(number.toFixed(6))):number;return targets;}
function forecastFilledInputs(){
 const button=$('analyze-btn'),form=$('scenario-form');if(!form||!button||button.disabled)return false;
 if($('mode-btn')?.classList.contains('active'))$('mode-btn').click();
 else if(typeof form.requestSubmit==='function')form.requestSubmit(button);
 else form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 return !$('form-error')?.textContent.trim();
}

export function mountAutoFill(){
 const planning=document.querySelector('#scenario-form .planning-bar');
 if(!planning||$('context-auto-fill'))return;
 const row=document.createElement('div');row.className='context-auto-fill-row planning-auto-fill-row';
 const button=document.createElement('button');button.type='button';button.id='context-auto-fill';button.className='quiet';button.textContent='auto-fill';
 button.title='Yahoo Finance delayed front-month futures · prior NY 09:30–16:00 and 19:30 to the selected cutoff. One missing interior 5- or 15-minute overnight candle may be tolerated with a visible warning; session boundaries must be present.';
 row.append(button);const mainStatus=mountFillStatus(row,'context-auto-fill-status'),coverageNote=mountCoverageNotice(row,'context-auto-fill-coverage');planning.after(row);
 const popup=document.createElement('div');popup.id='auto-fill-popup';popup.className='auto-fill-popup';popup.hidden=true;popup.setAttribute('aria-live','polite');document.body.append(popup);
 let fade,hide,reading=false;
 const highlightTimers=new Map();
 function highlightFilled(targets){
  for(const input of targets){clearTimeout(highlightTimers.get(input));input.classList.remove('auto-fill-updated');}
  // Restart the brief highlight even when another successful fill used the same values.
  void targets[0].offsetWidth;
  for(const input of targets){
   input.classList.add('auto-fill-updated');
   highlightTimers.set(input,setTimeout(()=>{input.classList.remove('auto-fill-updated');highlightTimers.delete(input);},2050));
  }
 }
 function notify(message,error=false){
  clearTimeout(fade);clearTimeout(hide);popup.textContent=message;popup.dataset.error=String(error);popup.setAttribute('role',error?'alert':'status');popup.hidden=false;popup.classList.remove('auto-fill-fade');
  fade=setTimeout(()=>popup.classList.add('auto-fill-fade'),1300);hide=setTimeout(()=>{popup.hidden=true;popup.textContent='';},1500);
 }
 button.addEventListener('click',async()=>{
  if(reading)return;
  if($('analyze-btn')?.disabled||document.documentElement?.dataset.startup==='loading'){notify('Wait for the research data to load, then try again.',true);return;}
  if($('replay-toggle')?.checked){notify('Auto-fill uses today’s front-month contract. Turn Replay off.',true);return;}
  const currentDate=today();
  if($('trading-date'))$('trading-date').value=currentDate;
  if($('date-label'))$('date-label').textContent='Today · '+currentDate;
  const date=value('trading-date'),cutoff=value('asof'),units=value('ud-units');
  const watched=['trading-date','asof','ud-units','avr','price','printed','range-high','range-low','range-position','prior-low','prior-high','location','open1930','up','down','behavior'],before=Object.fromEntries(watched.map(id=>[id,value(id)])),revision=transportRevision;
  const requestStartedAt=Date.now();let endpoint;
  try{endpoint=buildAutoFillURL(document.querySelector('meta[name="sessionpath-context-endpoint"]')?.content,{market:instrument.id,date,cutoff,nonce:String(requestStartedAt)+String(++requestSequence).padStart(4,'0')});}
  catch(error){notify(error.message,true);fillStatus(mainStatus,error.message,'error');return;}
  const sound=prepareBell();reading=true;button.disabled=true;button.textContent='Reading…';fillStatus(mainStatus,'Reading known chart inputs…','loading');
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
  try{
   const {response,payload,allowedSources}=await fetchAutoFillResponse({endpoint,market:instrument.id,date,cutoff,requestStartedAt},{signal:controller.signal});
   if(payload?.schema!=='sessionpath.autofill.v2')throw Error('The chart-data service is unavailable. Try again later.');
   const result=payload.result;
   if(!response.ok&&result?.status==='ready')throw Error('Could not read the chart-data source. Try again later.');
   validateAutoFill(result,{date,cutoff,market:instrument.id,requestStartedAt,allowedSources});
   const plan=mainAutoFillPlan(result,{units,current:before,previous:previousFill('main'),convention:instrument.autofillConvention});
   if(today()!==date)throw Error('The New York trading date changed while reading. Click Auto-fill again.');
   if(transportRevision!==revision||watched.some(id=>value(id)!==before[id])||$('replay-toggle')?.checked)throw Error('Inputs or source changed while reading. Click Auto-fill again.');
   const targets=applyFilledValues(plan.updates);
   $('open1930').dispatchEvent(new Event('input',{bubbles:true}));
   updateCoverageNotice(coverageNote,result.coverage);highlightFilled(targets);playBell(sound);
   const source=autoFillSourceStatus(result),gaps=plan.missing.length?' Still unavailable: '+plan.missing.join('; ')+'.':'';
   const manual=plan.usedManualAVR?' Your manual AVR was retained.':'';
   const forecast=plan.forecastReady?forecastFilledInputs():false;
   const forecastNote=forecast?' Forecast updated.':plan.forecastReady?' Forecast needs review: '+($('form-error')?.textContent||'Check the current filters.'):' Add the missing required inputs before forecasting.';
   const status=source+manual+gaps+forecastNote;
   fillStatus(mainStatus,status,plan.forecastReady&&!plan.missing.length?'ready':'partial');
   saveFill('main',{...plan.provenance,sourceStatus:source},targets);button.title=source;
   notify('Done! '+result.contract+' · '+cutoff+' NY');
  }catch(error){const message=autoFillFailureMessage(error),last=previousFill('main')?.sourceStatus;fillStatus(mainStatus,message+(last?' Last successful fill: '+last:''),'error');notify(message,true);}
  finally{clearTimeout(timeout);reading=false;button.disabled=false;button.textContent='auto-fill';}
 });

 function mountNYAutoFill(){
  const controls=document.querySelector('#ny-reference .ny-numeric-inputs');
  if(!controls||!$('ny-date'))return false;
  if($('ny-auto-fill'))return true;
  const row=document.createElement('div');row.className='context-auto-fill-row';
  const nyButton=document.createElement('button');nyButton.id='ny-auto-fill';nyButton.type='button';nyButton.className='quiet';nyButton.textContent='auto-fill · 08:30';
  nyButton.title='Fill the 08:30 open, overnight high/low, U/D forecast utilization and archived five-minute close dominance. Utilization uses your frozen NY AVR and the research’s earlier-date Mean forecasts.';
  row.append(nyButton);const nyStatus=mountFillStatus(row,'ny-auto-fill-status'),nyCoverageNote=mountCoverageNotice(row,'ny-auto-fill-coverage');controls.before(row);
  mountNYDirectionAutoFillStatus();
  let busy=false;
  nyButton.addEventListener('click',async()=>{
   if(busy)return;
   const date=value('ny-date'),cutoff='08:30',market=instrument.id;
   if(date!==today()){notify('08:30 auto-fill reads today’s New York session. Select today’s date first.',true);return;}
   const ids=['ny-date','ny-avr','ny-price','ny-range-high','ny-range-low','ny-printed','ny-basis','ny-position-mode','ny-position-asia','ny-position-london','ny-year','ny-end','ny-asia-shape','ny-london-shape',...directionFieldIDs],before=ids.map(value);
   const beforePositionFilters=[...document.querySelectorAll('#ny-reference [data-ny-session]')].map(e=>e.checked).join('|');
   const beforeReplay=$('replay-toggle')?.checked,beforeTradingDate=value('trading-date'),beforeReplayDate=value('replay-date');
   const started=Date.now();let endpoint;
   try{endpoint=buildAutoFillURL(document.querySelector('meta[name="sessionpath-context-endpoint"]')?.content,{market,date,cutoff,nonce:String(started)+String(++requestSequence).padStart(4,'0')});}
   catch(e){notify(e.message,true);return;}
   const sound=prepareBell(),controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
   const revision=transportRevision;
   busy=true;nyButton.disabled=true;nyButton.textContent='Reading…';fillStatus(nyStatus,'Reading completed New York inputs…','loading');
   try{
    const {response,payload,allowedSources}=await fetchAutoFillResponse({endpoint,market,date,cutoff,requestStartedAt:started},{signal:controller.signal});
    if(payload?.schema!=='sessionpath.autofill.v2')throw Error('The live-data service is unavailable. Try again later.');
    if(!response.ok&&payload.result?.status==='ready')throw Error('Could not read the delayed-data source.');
    const data=validateAutoFill(payload.result,{date,cutoff,market,requestStartedAt:started,allowedSources});
    const observed=validatedObservableFields(payload.result,{convention:instrument.autofillConvention}),prior=previousFill('ny');
    const staleAVR=prior&&prior.fields?.['ny-avr']===value('ny-avr')&&(prior.date!==date||prior.contract!==payload.result.contract);
    const effectiveAVR=observed.avr??(staleAVR?null:value('ny-avr')===''?null:Number(value('ny-avr')));
    let positionPlan,positionError;
    try{positionPlan=computeNYPositionAutofill(payload.result,{market,date,basis:value('ny-basis'),mode:value('ny-position-mode'),convention:instrument.autofillConvention});}
    catch(error){positionError=payload.result.nyPositions?.error||error.message;}
    let directionPlan,directionError;
    try{directionPlan=await directionFillPlan(payload.result,{date,avr:effectiveAVR});}
    catch(error){directionError=payload.result.nyDirection?.error||error.message;}
    if(transportRevision!==revision||today()!==date||$('replay-toggle')?.checked!==beforeReplay||value('trading-date')!==beforeTradingDate||value('replay-date')!==beforeReplayDate||ids.some((id,i)=>value(id)!==before[i])||beforePositionFilters!==[...document.querySelectorAll('#ny-reference [data-ny-session]')].map(e=>e.checked).join('|'))throw Error('NY inputs changed while reading. Click auto-fill again.');
    const updates={'ny-price':data.decisionOpen,'ny-range-high':observed.range.rangeHigh,'ny-range-low':observed.range.rangeLow};
    if(observed.avr!==null)updates['ny-avr']=observed.avr;else if(staleAVR)updates['ny-avr']='';
    if(effectiveAVR>0)updates['ny-printed']=(observed.range.rangeHigh-observed.range.rangeLow)/effectiveAVR*100;else if(staleAVR)updates['ny-printed']='';
    const targets=applyFilledValues(updates);
    if(directionPlan)targets.push(...applyDirectionFill(directionPlan,{date,contract:payload.result.contract,avr:Number(value('ny-avr'))}));
    else directionFillUnavailable(directionError||'Complete five-minute candles are not available.');
    if(positionPlan)targets.push(...fillLiveNYPositionHelper(payload.result));
    else positionFillUnavailable(positionError||'Complete Asia/London prices are unavailable.');
    $('ny-range-low').dispatchEvent(new Event('change',{bubbles:true}));
    if(value('ny-printed')!=='')targets.push($('ny-printed'));
    updateCoverageNotice(nyCoverageNote,payload.result.coverage);
    highlightFilled(targets);playBell(sound);
    const source=autoFillSourceStatus(payload.result),missing=observed.avr===null?' Frozen ten-session AVR unavailable; '+(effectiveAVR>0?'your manual AVR was retained.':'enter AVR to complete the forecast.') :'';
    fillStatus(nyStatus,source+missing,observed.avr===null?'partial':'ready');
    saveFill('ny',{date,contract:payload.result.contract,cutoff,sourceStatus:source,fields:observed.avr===null?{}:{'ny-avr':observed.avr}},targets);
    nyButton.title=`${payload.result.contract} · ${date} · 08:30 NY. Completed 03–05 / 05–08:30 windows; the 08:30 candle’s H/L/C are excluded. Asia/London positions and Exact/Wide selection are applied automatically. Year and shape filters are retained.`;
    notify(positionPlan?`Done! ${payload.result.contract} · ${positionPlan.method} positions applied`:directionPlan?.complete?`Done! ${payload.result.contract} · NY inputs and both direction panels`:directionPlan?`NY prices and candle counts filled. See the U/D usage note.`:`NY prices filled. Direction windows unavailable; see their notes.`,!positionPlan&&!directionPlan);
   }catch(e){const message=autoFillFailureMessage(e),last=previousFill('ny')?.sourceStatus;fillStatus(nyStatus,message+(last?' Last successful fill: '+last:''),'error');notify(message,true);}
   finally{clearTimeout(timeout);busy=false;nyButton.disabled=false;nyButton.textContent='auto-fill · 08:30';}
  });
  return true;
 }
 if(!mountNYAutoFill()){
  const observer=new MutationObserver(()=>{if(mountNYAutoFill()){observer.disconnect();clearTimeout(expiry);}});
  observer.observe(document.body,{childList:true,subtree:true});
  const expiry=setTimeout(()=>observer.disconnect(),30000);
 }
}

if(typeof document!=='undefined')mountAutoFill();
