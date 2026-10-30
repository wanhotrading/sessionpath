import {instrument} from './instrument.mjs';
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

export function validateAutoFill(result,{date,cutoff,market,now=Date.now(),requestStartedAt}){
 if(!result||typeof result!=='object')throw Error('Delayed data is not ready. Try again later.');
 if(result.market!==market)throw Error(`The data service returned a different market. Select ${market} and try auto-fill again.`);
 if(result.date!==date)throw Error(`The data service returned a different trading date. Expected ${date} in New York.`);
 if(result.cutoff!==cutoff)throw Error(`The data service returned a different cutoff. Expected ${cutoff} New York.`);
 if(result.status!=='ready')throw Error(typeof result.error==='string'&&result.error?result.error:'Delayed candles are not complete for this cutoff yet. Try again later.');
 if(result.source!=='Yahoo Finance'||result.continuous!==false||!new RegExp('^'+market+'[FGHJKMNQUVXZ]\\d{4}$').test(result.contract||''))throw Error('The front-month contract could not be verified.');
 const generatedAt=Date.parse(result.generatedAt);
 if(!Number.isFinite(generatedAt)||generatedAt>now+60000||now-generatedAt>120000||Number.isFinite(requestStartedAt)&&generatedAt<requestStartedAt-60000)throw Error('The data service returned an old response. Click auto-fill to fetch fresh delayed candles.');
 const data=result.values;
 if(!data||!['priorLow','priorHigh','open1930','rangeHigh','rangeLow','up','down'].every(k=>typeof data[k]==='number'&&Number.isFinite(data[k])))throw Error('The source returned incomplete prices.');
 if(!(data.priorHigh>data.priorLow&&data.rangeHigh>=data.open1930&&data.rangeLow<=data.open1930&&data.rangeHigh>=data.rangeLow&&data.up>=0&&data.down>=0))throw Error('The source returned inconsistent session prices.');
 if(Math.abs(data.up-(data.rangeHigh-data.open1930))>1e-6||Math.abs(data.down-(data.open1930-data.rangeLow))>1e-6)throw Error('The 19:30 excursions could not be verified.');
 if(cutoff==='08:30'&&!Number.isFinite(data.decisionOpen))throw Error('The delayed source has not supplied the 08:30 opening price yet. Try again later.');
 return data;
}

export function mountAutoFill(){
 const panel=document.querySelector('.input-more');
 if(!panel||$('context-auto-fill'))return;
 const row=document.createElement('div');row.className='context-auto-fill-row';
 const button=document.createElement('button');button.type='button';button.id='context-auto-fill';button.className='quiet';button.textContent='auto-fill';
 button.title='Yahoo Finance delayed front-month futures · prior NY 09:30–16:00 and 19:30 to the selected cutoff. Requires complete five-minute candles.';
 row.append(button);panel.querySelector('fieldset').before(row);
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
  if($('analyze-btn')?.disabled){notify('Wait for the research data to load, then try again.',true);return;}
  if($('replay-toggle')?.checked){notify('Auto-fill uses today’s front-month contract. Turn Replay off.',true);return;}
  const currentDate=today();
  if($('trading-date'))$('trading-date').value=currentDate;
  if($('date-label'))$('date-label').textContent='Today · '+currentDate;
  const date=value('trading-date'),cutoff=value('asof'),units=value('ud-units'),avr=value('avr');
  if(units==='percent'&&!(Number(avr)>0)){notify('Enter a positive AVR before filling U/D percentages.',true);return;}
  const requestStartedAt=Date.now();let endpoint;
  try{endpoint=buildAutoFillURL(document.querySelector('meta[name="sessionpath-context-endpoint"]')?.content,{market:instrument.id,date,cutoff,nonce:String(requestStartedAt)+String(++requestSequence).padStart(4,'0')});}
  catch(error){notify(error.message,true);return;}
  const sound=prepareBell();
  reading=true;button.disabled=true;button.textContent='Reading…';
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
  try{
   const response=await fetch(endpoint,{signal:controller.signal,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
   let payload;try{payload=await response.json();}catch{throw Error('Could not read the live-data service. Try again later.');}
   if(payload?.schema!=='sessionpath.autofill.v2')throw Error('The live-data service is unavailable. Try again later.');
   const result=payload.result;
   if(!response.ok&&result?.status==='ready')throw Error('Could not read the delayed-data source. Try again later.');
   const data=validateAutoFill(result,{date,cutoff,market:instrument.id,requestStartedAt});
   if(today()!==date)throw Error('The New York trading date changed while reading. Refresh the date and click auto-fill again.');
   if(value('trading-date')!==date||value('asof')!==cutoff||value('ud-units')!==units||value('avr')!==avr||$('replay-toggle')?.checked)throw Error('Inputs changed while reading. Click auto-fill again.');
   const multiplier=units==='percent'?100/Number(avr):1;
   const updates={'prior-low':data.priorLow,'prior-high':data.priorHigh,open1930:data.open1930,'range-high':data.rangeHigh,'range-low':data.rangeLow,up:data.up*multiplier,down:data.down*multiplier};
   const targets=Object.keys(updates).map(id=>$(id));if(targets.some(e=>!e))throw Error('The session inputs are not ready. Reload and try again.');
   for(const [id,number]of Object.entries(updates))$(id).value=String(Number(number.toFixed(6)));
   $('open1930').dispatchEvent(new Event('change',{bubbles:true}));
   highlightFilled(targets);
   playBell(sound);
   button.title=`Yahoo Finance · ${result.contract} · ${date} · through ${cutoff} New York · delayed data`;
   notify(`Done! ${result.contract} · ${cutoff} NY`);
  }catch(error){notify(error.name==='AbortError'?'The delayed-data source timed out. Try again.':error.message||'Auto-fill failed. Try again.',true);}
  finally{clearTimeout(timeout);reading=false;button.disabled=false;button.textContent='auto-fill';}
 });

 function mountNYAutoFill(){
  const controls=document.querySelector('#ny-reference .ny-numeric-inputs');
  if(!controls||!$('ny-date'))return false;
  if($('ny-auto-fill'))return true;
  const row=document.createElement('div');row.className='context-auto-fill-row';
  const nyButton=document.createElement('button');nyButton.id='ny-auto-fill';nyButton.type='button';nyButton.className='quiet';nyButton.textContent='auto-fill · 08:30';
  nyButton.title='Fill the 08:30 open, overnight high/low, U/D forecast utilization and archived five-minute close dominance. Utilization uses your frozen NY AVR and the research’s earlier-date Mean forecasts.';
  row.append(nyButton);controls.before(row);
  mountNYDirectionAutoFillStatus();
  let busy=false;
  nyButton.addEventListener('click',async()=>{
   if(busy)return;
   const date=value('ny-date'),cutoff='08:30',market=instrument.id;
   if(date!==today()){notify('08:30 auto-fill reads today’s New York session. Select today’s date first.',true);return;}
   const ids=['ny-date','ny-avr','ny-price','ny-range-high','ny-range-low','ny-printed',...directionFieldIDs],before=ids.map(value);
   const started=Date.now();let endpoint;
   try{endpoint=buildAutoFillURL(document.querySelector('meta[name="sessionpath-context-endpoint"]')?.content,{market,date,cutoff,nonce:String(started)+String(++requestSequence).padStart(4,'0')});}
   catch(e){notify(e.message,true);return;}
   const sound=prepareBell(),controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
   busy=true;nyButton.disabled=true;nyButton.textContent='Reading…';
   try{
    const response=await fetch(endpoint,{signal:controller.signal,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
    const payload=await response.json();
    if(payload?.schema!=='sessionpath.autofill.v2')throw Error('The live-data service is unavailable. Try again later.');
    if(!response.ok&&payload.result?.status==='ready')throw Error('Could not read the delayed-data source.');
    const data=validateAutoFill(payload.result,{date,cutoff,market,requestStartedAt:started});
    let directionPlan,directionError;
    try{directionPlan=await directionFillPlan(payload.result,{date,avr:value('ny-avr')===''?null:Number(value('ny-avr'))});}
    catch(error){directionError=payload.result.nyDirection?.error||error.message;}
    if(today()!==date||ids.some((id,i)=>value(id)!==before[i]))throw Error('NY inputs changed while reading. Click auto-fill again.');
    const updates={'ny-price':data.decisionOpen,'ny-range-high':data.rangeHigh,'ny-range-low':data.rangeLow};
    const targets=Object.keys(updates).map($);if(targets.some(x=>!x))throw Error('NY inputs are not ready. Reload and try again.');
    for(const [id,number]of Object.entries(updates))$(id).value=String(Number(number.toFixed(6)));
    if(directionPlan)targets.push(...applyDirectionFill(directionPlan,{date,contract:payload.result.contract,avr:Number(value('ny-avr'))}));
    else directionFillUnavailable(directionError||'Complete five-minute candles are not available.');
    $('ny-range-low').dispatchEvent(new Event('change',{bubbles:true}));
    if(value('ny-printed')!=='')targets.push($('ny-printed'));
    highlightFilled(targets);playBell(sound);
    nyButton.title=`${payload.result.contract} · ${date} · 08:30 NY. Completed 03–05 / 05–08:30 windows; the 08:30 candle’s H/L/C are excluded. Your position and shape filters are retained.`;
    notify(directionPlan?.complete?`Done! ${payload.result.contract} · NY inputs and both direction panels`:directionPlan?`NY prices and candle counts filled. See the U/D usage note.`:`NY prices filled. Direction windows unavailable; see their notes.`,!directionPlan);
   }catch(e){notify(e.name==='AbortError'?'The delayed-data source timed out. Try again.':e.message||'08:30 auto-fill failed. Try again.',true);}
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
