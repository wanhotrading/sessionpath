import {CHART_REFERENCE_VERSION,CHART_COMPARISON_PROMPT} from './chart-reading-reference.mjs?v=visual-tags-20261108b';
import {makeChartSessionPathCode} from './session-path-code.mjs?v=session-path-code-20261106';
import {readChartResponse} from './chart-event-stream.mjs?v=grok-stream-20261108';
import {createChartVisualReading} from './chart-visual-view.mjs?v=visual-reading-20261108';

const MARKETS=['CL','NQ','ES','GC'];
const WINDOWS=['03:00-05:00','05:00-08:30','08:30-16:00'];
const CONCEPTS=['mean_box','containment','avr_expansion','extension'];
const STORAGE='sessionpath-assistant-chat-v1';
const ENDPOINT='https://sessionpath-assistant.jjj-jason2345.workers.dev/api/chat';
const CHART_ENDPOINT='https://sessionpath-assistant.jjj-jason2345.workers.dev/api/chart';
const MAX_IMAGE_BYTES=10*1024*1024,MAX_IMAGE_PIXELS=16000000,MAX_IMAGE_URL=1572864;
const DEFAULT_CHART_QUESTION='Describe the visible price movement so far.';
const DEFINITIONS={
 mean_box:'The mean box shows average historical upside and downside from the decision open. Its edges are average excursions, not guaranteed boundaries.',
 containment:'Containment is the share of historical full-window paths that stayed inside the fitted mean box. It is different from a final close inside or a return after a breach, and is not a trade win rate.',
 avr_expansion:'Orange boxes show expected additional movement beyond the running high and low since 19:30, scaled by the frozen AVR. Historical averages include zero expansion.',
 extension:'Extensions use the entire SessionPath box width, measured from the opposite extreme. A $89–$91 box has a 1.20× upper level at $91.40. Hit probabilities require the matching breakout definition and time window.'
};
const plain=(value,max=600)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
const abortError=()=>Object.assign(new Error('Request cancelled.'),{name:'AbortError'});
const canonicalDate=value=>{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const stamp=Date.parse(value+'T00:00:00Z');return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===value;
};
const nyDate=now=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now)).map(part=>[part.type,part.value]));return `${p.year}-${p.month}-${p.day}`;};
// Old interpreters can omit date on undated commands. An explicit date request
// must never silently turn into today's live forecast during a staged rollout.
const monthWords='(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const dateMentionPattern=new RegExp('\\b'+monthWords+'\\.?\\s*\\d{1,2}\\b|\\b\\d{1,2}(?:st|nd|rd|th)?\\s*'+monthWords+'\\b|\\b(?:today|yesterday)\\b|\\b\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}\\b|\\b\\d{1,2}\\/\\d{1,2}\\b|\\d{1,2}月|昨天|昨日|今天|今日','iu');
const mentionsDate=query=>dateMentionPattern.test(query);

export function chartImageDimensions(input,mime){
 const bytes=input instanceof Uint8Array?input:new Uint8Array(input),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let width,height;
 const ascii=(start,length)=>String.fromCharCode(...bytes.subarray(start,start+length));
 if(mime==='image/png'&&bytes.length>=24&&bytes[0]===137&&ascii(1,3)==='PNG'&&ascii(12,4)==='IHDR'){width=view.getUint32(16);height=view.getUint32(20);}
 else if(mime==='image/jpeg'&&bytes.length>=4&&bytes[0]===255&&bytes[1]===216){
  let position=2;while(position+3<bytes.length){if(bytes[position++]!==255)break;while(bytes[position]===255)position++;const marker=bytes[position++];if(marker===217||marker===218)break;if(marker===1||(marker>=208&&marker<=215))continue;if(position+2>bytes.length)break;const length=view.getUint16(position);if(length<2||position+length>bytes.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=7){height=view.getUint16(position+3);width=view.getUint16(position+5);break;}position+=length;}
 }else if(mime==='image/webp'&&bytes.length>=30&&ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP'){
  const chunk=ascii(12,4);if(chunk==='VP8X'){width=1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16);height=1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16);}
  else if(chunk==='VP8 '&&bytes[23]===157&&bytes[24]===1&&bytes[25]===42){width=view.getUint16(26,true)&16383;height=view.getUint16(28,true)&16383;}
  else if(chunk==='VP8L'&&bytes[20]===47){const bits=view.getUint32(21,true);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;}
 }
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>16384||height>16384)throw new Error('Choose a valid PNG, JPEG or WebP screenshot.');
 if(width*height>MAX_IMAGE_PIXELS)throw new Error('The screenshot is over 16 megapixels. Crop or resize it before attaching.');
 return {width,height};
}

export async function normalizeChartImage(file,{document:doc=globalThis.document}={}){
 const win=doc.defaultView;if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Choose a PNG, JPEG or WebP screenshot.');
 if(!Number.isFinite(file.size)||file.size<1||file.size>MAX_IMAGE_BYTES)throw new Error('Choose a screenshot smaller than 10 MB.');
 const bytes=typeof file.arrayBuffer==='function'?await file.arrayBuffer():await new Promise((resolve,reject)=>{const reader=new win.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('The screenshot could not be read.'));reader.readAsArrayBuffer(file);});
 chartImageDimensions(bytes,file.type);let bitmap,temporaryURL,canvas;
 try{
  if(typeof win.createImageBitmap==='function')bitmap=await win.createImageBitmap(file,{imageOrientation:'from-image'});
  else bitmap=await new Promise((resolve,reject)=>{const img=new win.Image();temporaryURL=win.URL.createObjectURL(file);img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('The screenshot could not be decoded.'));img.src=temporaryURL;});
  const width=bitmap.width||bitmap.naturalWidth,height=bitmap.height||bitmap.naturalHeight;if(!(width>0&&height>0)||width*height>MAX_IMAGE_PIXELS)throw new Error('The screenshot is over 16 megapixels. Crop or resize it before attaching.');
  const ratio=Math.min(1,2048/Math.max(width,height));canvas=doc.createElement('canvas');canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));const context=canvas.getContext('2d');if(!context)throw new Error('This browser could not prepare the screenshot.');
  context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
  // Drawing pixels to JPEG removes source metadata and prevents animated input
  // previews. Only this normalized image can be submitted to the vision API.
  for(const quality of [.84,.72,.6]){const dataUrl=canvas.toDataURL('image/jpeg',quality);if(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/u.test(dataUrl)&&dataUrl.length<=MAX_IMAGE_URL)return {dataUrl,width:canvas.width,height:canvas.height};}
  throw new Error('The prepared screenshot is still too large. Crop the chart and try again.');
 }finally{bitmap?.close?.();if(canvas){canvas.width=0;canvas.height=0;}if(temporaryURL)win.URL.revokeObjectURL(temporaryURL);}
}

export function validateChartReading(body,context,observation=null){
 const text=(value,max)=>plain(value,max)&&value.trim().length>0,list=(value,max)=>Array.isArray(value)&&value.length>=1&&value.length<=8&&value.every(item=>text(item,max));
 if(body?.ok!==true||body.schema!=='sessionpath.assistant.chart.v1'||body.action!=='describe_chart'||body.market!==context.market||body.window!==context.window||(body.date??null)!==(context.date??null)||!text(body.model,160)||body.referenceVersion!==CHART_REFERENCE_VERSION)return false;
 const echoed=body.observationContext;
 if(observation===null?echoed!==undefined:!echoed||Object.keys(echoed).length!==3||echoed.mode!==observation.mode||echoed.date!==observation.date||echoed.cutoff!==observation.cutoff)return false;
 if(body.shapeTags!==undefined&&(!Array.isArray(body.shapeTags)||body.shapeTags.length>4||new Set(body.shapeTags.map(row=>row?.session)).size!==body.shapeTags.length||!body.shapeTags.every(row=>Object.hasOwn(chartShapeSessions,row?.session)&&Object.hasOwn(chartShapeStatuses,row.status)&&((row.status==='archive'||row.status==='provisional')?Object.hasOwn(chartShapeNames,row.tag):row.tag===null)&&text(row.reason,350))))return false;
 const a=body.analysis;return a&&text(a.summary,800)&&list(a.sequence,400)&&text(a.bbox,600)&&text(a.sessionpath,600)&&list(a.uncertainties,300)&&[a.summary,...a.sequence,a.bbox,a.sessionpath,...a.uncertainties].reduce((total,value)=>total+value.length,0)<=6000;
}

const chartShapeSessions=Object.freeze({NTA:'NTA · NY to Asia',ASIA:'Asia',LONDON:'London',NY:'New York'});
const chartShapeNames=Object.freeze({DOWN_FINISH:'Down finish',DOWN_THEN_BOUNCE:'Down then bounce',DROP_RECOVERY:'Trend down, then recover',UP_FINISH:'Up finish',UP_THEN_PULLBACK:'Up then pullback',RALLY_FADE:'Trend up, then fade',NARROW:'Narrow range',ORDER_UNRESOLVED:'Order unresolved'});
const chartShapeStatuses=Object.freeze({archive:'Archive match',provisional:'Screenshot only',unverified:'Unverified',in_progress:'Not complete'});

export function chartComparisonPrompt(question,context,observation=null){return `${CHART_COMPARISON_PROMPT}\n\nReference version: ${CHART_REFERENCE_VERSION}\nUser question: ${question}\nSelected context (not verified from the screenshot): ${JSON.stringify(context)}${observation?`\nHistorical chart observation supplied by the user: ${JSON.stringify(observation)}`:''}\nAttach the same screenshot in GPT before comparing the descriptions. Do not treat the selected context as verified chart metadata.`;}

export function validateChatIntent(value){
 if(!value||value.ok!==true||!['forecast','explain','clarify'].includes(value.action)||!MARKETS.includes(value.market)||!WINDOWS.includes(value.window)||!(value.concept===null||CONCEPTS.includes(value.concept))||!plain(value.message,400)||!['rules','openrouter'].includes(value.interpreter))return null;
 if((value.action==='explain')!==(value.concept!==null))return null;
 const date=value.date??null;if(date!==null&&!canonicalDate(date))return null;
 return {action:value.action,market:value.market,window:value.window,concept:value.concept,date,message:value.message,interpreter:value.interpreter};
}

export function readChatState(storage,now=Date.now()){
 try{
  const raw=storage.getItem(STORAGE);if(!raw||raw.length>16000)return {messages:[],pending:null,lastDate:null};
  const state=JSON.parse(raw),messages=[];
  if(Array.isArray(state.messages))for(const message of state.messages.slice(-10))if(message&&['user','assistant'].includes(message.role)&&plain(message.text,1200))messages.push({role:message.role,text:message.text});
  const p=state.pending,intent=validateChatIntent(p?.intent);
  const pending=p&&intent?.action==='forecast'&&plain(p.query,600)&&Number.isFinite(p.createdAt)&&now-p.createdAt>=0&&now-p.createdAt<=90000?{intent,query:p.query,createdAt:p.createdAt}:null;
  return {messages,pending,lastDate:canonicalDate(state.lastDate)?state.lastDate:null};
 }catch{return {messages:[],pending:null,lastDate:null};}
}

export function assistantMarketURL(market,rootURL=new URL('./',import.meta.url)){
 if(!MARKETS.includes(market))throw new Error('Invalid market.');
 const target=new URL(({ES:'es/',GC:'gc/'}[market]||'./'),rootURL);target.searchParams.set('instrument',market);return target.href;
}

function waitForReady(doc,signal,timeout=30000){
 return new Promise((resolve,reject)=>{
  let timer;const started=Date.now();
  const stop=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);};
  const cancel=()=>{stop();reject(abortError());};
  const check=()=>{if(signal.aborted)return cancel();if(doc.documentElement.dataset.startup==='ready'&&doc.querySelector('#analyze-btn:not(:disabled)')){stop();resolve();}else if(Date.now()-started>=timeout){stop();reject(new Error('SessionPath is still loading. Please try again.'));}else timer=setTimeout(check,500);};
  signal.addEventListener('abort',cancel,{once:true});check();
 });
}

function requestForecast(doc,intent,signal,requestId,timeout=30000){
 return new Promise((resolve,reject)=>{
  let timer;const stop=()=>{clearTimeout(timer);doc.removeEventListener('sessionpath:assistant-result',receive);signal.removeEventListener('abort',cancel);};
  const cancel=()=>{stop();reject(abortError());};
  const receive=event=>{if(event.detail?.requestId!==requestId)return;stop();resolve(event.detail);};
  if(signal.aborted)return cancel();doc.addEventListener('sessionpath:assistant-result',receive);signal.addEventListener('abort',cancel,{once:true});
  timer=setTimeout(()=>{stop();reject(new Error('The forecast took too long. Please try again.'));},timeout);
  doc.dispatchEvent(new doc.defaultView.CustomEvent('sessionpath:assistant-request',{detail:{requestId,market:intent.market,window:intent.window,date:intent.date??null}}));
 });
}

function validForecast(result,intent){
 if(!result||result.schema!=='sessionpath.assistant.forecast.v1'||result.ok!==true||result.market!==intent.market||result.window!==intent.window||!canonicalDate(result.date)||result.timezone!=='America/New_York'||!plain(result.code,12000)||!result.code||!Number.isInteger(result.sampleCount)||result.sampleCount<1)return false;
 if(!result.range||!['upper','lower','upPoints','downPoints'].every(key=>Number.isFinite(result.range[key]))||result.range.upPoints<0||result.range.downPoints<0)return false;
 if(result.probabilities?.units!=='fraction')return false;
 return ['containment','upperTouch','lowerTouch'].every(key=>{const p=result.probabilities[key];return p&&Number.isFinite(p.p)&&p.p>=0&&p.p<=1&&Number.isInteger(p.n)&&p.n===result.sampleCount&&Number.isInteger(p.k)&&p.k>=0&&p.k<=p.n&&Math.abs(p.k/p.n-p.p)<=1/p.n;});
}

export function mountAssistantChat({instrument,document:doc=globalThis.document,fetchImpl=(...args)=>fetch(...args),navigate=url=>doc.defaultView.location.assign(url),storage=doc.defaultView.sessionStorage,rootURL=new URL('./',import.meta.url),requestTimeout=30000,now=()=>Date.now(),prepareImage=normalizeChartImage}={}){
 if(doc.getElementById('sessionpath-assistant')||!MARKETS.includes(instrument?.id))return null;
 const win=doc.defaultView,element=(tag,className,text)=>{const el=doc.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
 const state=readChatState(storage,now()),messages=state.messages;let pending=state.pending,busy=false,controller=null,destroyed=false,lastWindow=WINDOWS[0],lastDate=state.lastDate,copyTimers=new Set(),attachment=null,preparingImage=false,attachmentVersion=0;
 const host=element('aside','sp-assistant');host.id='sessionpath-assistant';host.setAttribute('aria-label','SessionPath assistant');
 const viewport=element('div','sp-chat-viewport');viewport.hidden=true;viewport.dataset.state='closed';
 const panel=element('section','sp-chat-panel');panel.id='sp-chat-panel';panel.hidden=true;panel.setAttribute('aria-label','SessionPath conversation');panel.setAttribute('aria-hidden','true');panel.setAttribute('inert','');panel.inert=true;viewport.append(panel);
 const header=element('div','sp-chat-head'),brand=element('strong','','SessionPath');const subtitle=element('span','','Forecast assistant');const close=element('button','sp-chat-close','×');close.type='button';close.setAttribute('aria-label','Close conversation');header.append(brand,subtitle,close);
 const history=element('div','sp-chat-history');history.setAttribute('role','log');history.setAttribute('aria-label','Conversation');history.setAttribute('aria-live','polite');history.setAttribute('aria-relevant','additions');
 const examples=element('div','sp-chat-examples');for(const query of ['CL 03-05','NQ 05-0830','GC 08:30-16:00']){const button=element('button','',query);button.type='button';button.addEventListener('click',()=>{input.value=query;submit(query);});examples.append(button);}
 const status=element('p','sp-chat-status');status.setAttribute('role','status');
 const attachmentBox=element('section','sp-chat-attachment');attachmentBox.hidden=true;attachmentBox.setAttribute('aria-label','Screenshot to send');const preview=element('img','sp-chat-preview');preview.alt='Selected chart screenshot';const attachmentInfo=element('div','sp-chat-attachment-info'),attachmentName=element('span','sp-chat-filename'),attachmentSize=element('small','sp-chat-image-size');attachmentInfo.append(attachmentName,attachmentSize);const removeAttachment=element('button','sp-chat-remove-image','×');removeAttachment.type='button';removeAttachment.setAttribute('aria-label','Remove screenshot');const disclosure=element('p','sp-chat-image-disclosure','Send shares this image with OpenRouter/xAI. Crop out account details.');
 const historicalLabel=element('label','sp-chat-historical-toggle'),historical=element('input');historical.type='checkbox';historicalLabel.append(historical,doc.createTextNode('Historical / replay screenshot'));
 const observationFields=element('div','sp-chat-historical-fields');observationFields.hidden=true;
 const chartDateLabel=element('label','','Chart trading date · NY'),chartDate=element('input','sp-chat-chart-date');chartDate.type='date';chartDate.max=nyDate(now());chartDateLabel.append(chartDate);
 const chartCloseLabel=element('label','','Last completed close · NY'),chartClose=element('input','sp-chat-chart-close');chartClose.type='time';chartClose.step='300';chartCloseLabel.append(chartClose,element('small','','Optional · five-minute close'));
 observationFields.append(chartDateLabel,chartCloseLabel);attachmentBox.append(preview,attachmentInfo,removeAttachment,historicalLabel,observationFields,disclosure);
 panel.append(header,history,attachmentBox,examples,status);
 const form=element('form','sp-chat-composer');form.noValidate=true;form.tabIndex=-1;const toggle=element('button','sp-chat-mark','SP');toggle.type='button';toggle.setAttribute('aria-label','Open conversation');toggle.setAttribute('aria-controls',panel.id);toggle.setAttribute('aria-expanded','false');
 const input=element('input','sp-chat-input');input.type='text';input.placeholder='Ask SessionPath · CL, 03–05 range';input.maxLength=600;input.setAttribute('aria-label','Ask SessionPath');input.autocomplete='off';
 const attach=element('button','sp-chat-attach','＋');attach.type='button';attach.setAttribute('aria-label','Attach chart screenshot');attach.title='Attach a PNG, JPEG or WebP screenshot';const filePicker=element('input');filePicker.type='file';filePicker.accept='image/png,image/jpeg,image/webp';filePicker.hidden=true;filePicker.setAttribute('aria-label','Choose chart screenshot');const send=element('button','sp-chat-send','Send');send.type='submit';form.append(toggle,attach,filePicker,input,send);host.append(viewport,form);doc.body.append(host);
 const save=()=>{try{storage.setItem(STORAGE,JSON.stringify({messages:messages.slice(-10),pending,lastDate}));}catch{}};
 const reducedMotion=win.matchMedia?.('(prefers-reduced-motion: reduce)');let motionTimer=null;
 const motionOff=()=>reducedMotion?.matches||doc.body.classList.contains('motion-paused');
 function finishMotion(){
  clearTimeout(motionTimer);motionTimer=null;
  if(viewport.dataset.state==='closing'){viewport.dataset.state='closed';panel.hidden=true;viewport.hidden=true;}
  else if(viewport.dataset.state==='opening')viewport.dataset.state='open';
 }
 const open=()=>{
  if(destroyed||['open','opening'].includes(viewport.dataset.state))return;
  clearTimeout(motionTimer);panel.hidden=false;viewport.hidden=false;panel.inert=false;panel.removeAttribute('inert');panel.setAttribute('aria-hidden','false');toggle.setAttribute('aria-expanded','true');
  // Flush only the initial resting frame. Subsequent frames are handled by
  // compositor transforms; no measurements or DOM updates run per frame.
  if(viewport.dataset.state==='closed'&&!motionOff())panel.getBoundingClientRect();
  viewport.dataset.state='opening';if(motionOff())finishMotion();else motionTimer=setTimeout(finishMotion,1000);
 };
 const collapse=()=>{
  if(destroyed||['closed','closing'].includes(viewport.dataset.state))return;
  clearTimeout(motionTimer);toggle.setAttribute('aria-expanded','false');panel.inert=true;panel.setAttribute('inert','');panel.setAttribute('aria-hidden','true');
  // The composer remains in place. Return focus to the form without focusing
  // the input (which would immediately open the conversation again).
  form.focus({preventScroll:true});viewport.dataset.state='closing';if(motionOff())finishMotion();else motionTimer=setTimeout(finishMotion,1000);
 };
 const finishTransition=event=>{if(event.target===panel&&event.propertyName==='transform')finishMotion();};panel.addEventListener('transitionend',finishTransition);
 const finishPausedMotion=()=>{if(motionOff())finishMotion();};reducedMotion?.addEventListener?.('change',finishPausedMotion);
 const motionObserver=new win.MutationObserver(finishPausedMotion);motionObserver.observe(doc.body,{attributes:true,attributeFilter:['class']});
 const scroll=()=>{history.scrollTop=history.scrollHeight;};
 function bubble(role,text,{remember=true}={}){const item=element('div','sp-chat-message sp-chat-'+role);item.append(element('p','',text));history.append(item);if(remember){messages.push({role,text:text.slice(0,1200)});while(messages.length>10)messages.shift();save();}while(history.children.length>10)history.firstElementChild.remove();scroll();return item;}
 for(const message of messages)bubble(message.role,message.text,{remember:false});
 function setBusy(value,text=''){busy=value;send.disabled=value||preparingImage;attach.disabled=value||preparingImage;removeAttachment.disabled=value;input.readOnly=value;for(const field of [historical,chartDate,chartClose])field.disabled=value||preparingImage;for(const button of examples.children)button.disabled=value||preparingImage;status.textContent=text;host.setAttribute('aria-busy',String(value||preparingImage));}
 function resetChartObservation(){historical.checked=false;chartDate.value='';chartClose.value='';chartDate.required=false;observationFields.hidden=true;}
 function chartObservationNow(){
  if(!historical.checked)return null;
  const date=chartDate.value,time=chartClose.value;
  if(!canonicalDate(date))throw new Error('Choose the chart trading date in New York.');
  if(date>nyDate(now()))throw new Error('The chart trading date cannot be after today in New York.');
  if(time&&(!/^([01]\d|2[0-3]):[0-5]\d$/u.test(time)||Number(time.slice(3))%5!==0))throw new Error('Use a five-minute completed-close time, for example 08:45 NY.');
  return {mode:'historical',date,cutoff:time?`${date}T${time}`:null};
 }
 function clearAttachment(){attachmentVersion++;if(attachment?.previewURL)win.URL.revokeObjectURL(attachment.previewURL);attachment=null;preparingImage=false;resetChartObservation();preview.removeAttribute('src');attachmentName.textContent='';attachmentSize.textContent='';attachmentBox.hidden=true;delete host.dataset.hasImage;filePicker.value='';if(!destroyed)setBusy(busy);}
 async function stageImage(file){
  if(busy||preparingImage||destroyed)return false;open();preparingImage=true;let prepared=false;const version=++attachmentVersion;setBusy(false,'Preparing screenshot locally…');
  try{
   const normalized=await prepareImage(file,{document:doc});if(destroyed||version!==attachmentVersion)return false;
   if(!normalized||typeof normalized.dataUrl!=='string'||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/u.test(normalized.dataUrl)||normalized.dataUrl.length>MAX_IMAGE_URL)throw new Error('The screenshot could not be prepared. Crop it and try again.');
   const binary=win.atob(normalized.dataUrl.split(',')[1]),data=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)data[i]=binary.charCodeAt(i);
   const blob=new win.Blob([data],{type:'image/jpeg'}),previewURL=win.URL.createObjectURL(blob);if(attachment?.previewURL)win.URL.revokeObjectURL(attachment.previewURL);
   resetChartObservation();attachment={dataUrl:normalized.dataUrl,previewURL,name:plain(file?.name,240)?file.name:'Chart screenshot'};preview.src=previewURL;attachmentName.textContent=attachment.name;attachmentSize.textContent=`${normalized.width} × ${normalized.height} · ready to send`;attachmentBox.hidden=false;host.dataset.hasImage='true';prepared=true;return true;
  }catch(error){if(!destroyed&&version===attachmentVersion)status.textContent=plain(error?.message,400)?error.message:'The screenshot could not be prepared.';return false;}
  finally{if(!destroyed&&version===attachmentVersion){const message=status.textContent;preparingImage=false;setBusy(false,prepared?'Screenshot ready. Press Send when you are ready.':message);}filePicker.value='';}
 }
 function contextNow(){const cutoff=doc.getElementById('asof')?.value;return {market:instrument.id,window:lastWindow===WINDOWS[2]?lastWindow:cutoff==='05:00'?WINDOWS[1]:cutoff==='03:00'?WINDOWS[0]:lastWindow,date:lastDate??null};}
 function failure(error,query,{chart=false}={}){if(error?.name==='AbortError'||destroyed)return;bubble('assistant',plain(error?.message,400)?error.message:'Failed to fetch. Please try again.',{remember:!chart});const retry=element('button','sp-chat-retry','Try again'),retryAttachmentVersion=attachmentVersion;retry.type='button';retry.addEventListener('click',()=>{if(chart&&(!attachment||attachmentVersion!==retryAttachmentVersion)){open();status.textContent='Attach the original screenshot again, or press Send to read the current one.';return;}submit(query);});history.lastElementChild.append(retry);scroll();}
 function renderChart(body,query,context){
  const item=bubble('assistant','Chart reading',{remember:false});item.classList.add('sp-chat-chart-reading');
  const observation=body.observationContext;
  const contextLabel=observation?`Historical screenshot · chart date ${observation.date} · NY${observation.cutoff?` · last completed close ${observation.cutoff.slice(11)}`:''}. Selected context: ${context.market} · ${context.window} NY${context.date?` · ${context.date}`:''}.`:`Selected context: ${context.market} · ${context.window} NY · ${context.date??'live / today'}.`;
  item.append(element('p','sp-chat-note',`${contextLabel} This selection does not verify the screenshot’s market, date or timeframe.`));
  item.append(createChartVisualReading(doc,body));
  const pathCode=makeChartSessionPathCode(body),asksForPath=/\bpath[\s-]+code\b/iu.test(query);
  const calculated=element('details','sp-chat-calculated-classification');calculated.append(element('summary','','Calculated classification'));
  if(body.shapeTags?.length){
   const panel=element('div','sp-chat-shapes');panel.append(element('p','sp-chat-note','Exact price inputs and archive matches, when available.'));
   const obs=body.chartObservation;
   if(MARKETS.includes(obs?.market)&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(obs.cutoff)&&obs.timezone==='America/New_York')panel.append(element('p','sp-chat-note',`Chart read as ${obs.market} · ${obs.cutoff.replace('T',' ')} NY completed-close cutoff.`));
   if(MARKETS.includes(obs?.market)&&obs.market!==context.market)panel.append(element('p','sp-chat-note',`The chart reads as ${obs.market}; the selected page market is ${context.market}.`));
   const list=element('ul','sp-chat-shape-list');for(const row of body.shapeTags){const li=element('li','sp-chat-shape');const value=chartShapeNames[row.tag]||chartShapeStatuses[row.status];li.append(element('strong','',`${chartShapeSessions[row.session]} · ${value}`));if(row.tag)li.append(element('span','sp-chat-shape-source',`${chartShapeStatuses[row.status]} · ${row.session}:${row.tag}`));li.append(element('small','',row.reason));list.append(li);}
   panel.append(list);
   if(pathCode){
    const label=element('label','sp-chat-code-label','Session paths code'),code=element('textarea','sp-chat-code');code.readOnly=true;code.value=pathCode;code.rows=2;code.setAttribute('aria-label','Session paths code');label.append(code);
    const actions=element('div','sp-chat-path-actions'),copy=element('button','sp-chat-copy','Copy path code'),apply=element('button','sp-chat-copy','Apply to Session paths'),feedback=element('p','sp-chat-note');copy.type=apply.type='button';feedback.setAttribute('role','status');
    copy.addEventListener('click',async()=>{try{await win.navigator.clipboard.writeText(pathCode);feedback.textContent='Path code copied.';}catch{code.focus();code.select();feedback.textContent='The code is selected for copying.';}});
    apply.addEventListener('click',()=>{const detail={code:pathCode,result:null};doc.dispatchEvent(new win.CustomEvent('sessionpath:apply-path-code',{detail}));feedback.textContent=detail.result?.message||'Open the matching SessionPath planner to apply this code.';if(detail.result?.ok){collapse();doc.getElementById('sessions-section')?.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:motionOff()?'instant':'smooth'});}});
    actions.append(copy,apply);panel.append(label,actions,feedback);
   }else if(asksForPath){panel.append(element('p','sp-chat-note','A path code needs archive matches for NTA, Asia and London. Use a five-minute chart after 08:30 NY and include its market, trading date, completed-close time, prior NY high/low and 19:30 open if the labels are hard to read.'));}
   calculated.append(panel);
  }else{calculated.append(element('p','sp-chat-note','No calculated classification is available. Readable session high, low and close values or matching archive data are needed.'));if(asksForPath)calculated.append(element('p','sp-chat-note','No verified path code is available for this screenshot.'));}
  item.append(calculated);
  const copy=element('button','sp-chat-comparison-copy','Copy comparison prompt'),feedback=element('span','sp-chat-copy-feedback','Copied!');copy.type='button';feedback.hidden=true;feedback.setAttribute('role','status');let timer,fallback;
  copy.addEventListener('click',async()=>{const prompt=chartComparisonPrompt(query,context,observation);try{await win.navigator.clipboard.writeText(prompt);clearTimeout(timer);copyTimers.delete(timer);feedback.hidden=false;feedback.classList.remove('sp-chat-faded');timer=setTimeout(()=>{feedback.classList.add('sp-chat-faded');copyTimers.delete(timer);},2000);copyTimers.add(timer);}catch{if(!fallback){fallback=element('textarea','sp-chat-code');fallback.readOnly=true;fallback.value=prompt;fallback.setAttribute('aria-label','Comparison prompt to copy');item.append(fallback);}fallback.focus();fallback.select();}});item.append(copy,feedback);scroll();
 }
 function renderForecast(result,intent){
  const fmt=value=>value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}),heading=`${result.market} · ${result.window.replace('-', ' → ')} NY`;
  const mode=result.mode??(result.date===nyDate(now())?'live':'historical');
  const item=bubble('assistant',`${heading}\n${mode==='historical'?'Historical forecast':'Live forecast'} · ${result.date} (New York)\n${result.sampleCount} matching historical dates`);
  const range=element('div','sp-chat-range');for(const [label,points,price,cls]of [['Mean upside',result.range.upPoints,result.range.upper,'sp-chat-up'],['Mean downside',result.range.downPoints,result.range.lower,'sp-chat-down']]){const metric=element('div',cls);metric.append(element('span','',label),element('strong','',`${fmt(points)} pt`),element('small','',`${fmt(price)} boundary`));range.append(metric);}item.append(range);
  const probabilities=element('dl','sp-chat-probabilities');for(const [key,label]of [['containment','Stayed inside'],['upperTouch','Upper touch'],['lowerTouch','Lower touch']]){const probability=result.probabilities[key],row=element('div','');row.append(element('dt','',label),element('dd','',`${(probability.p*100).toFixed(1)}% · ${probability.k}/${probability.n}`));probabilities.append(row);}item.append(probabilities);
  item.append(element('p','sp-chat-note','Stayed inside = the entire historical window stayed inside its fitted mean box. Touch = reached or exceeded that side. These are fitted historical frequencies, not trade win rates.'));
  if(Number.isFinite(result.range.extensionUpPoints)&&Number.isFinite(result.range.extensionDownPoints))item.append(element('p','sp-chat-note',`Orange added range · upper ${fmt(result.range.extensionUpPoints)} pt / lower ${fmt(result.range.extensionDownPoints)} pt`));
  const source=result.source||{};if(plain(source.symbol,80)&&plain(source.checkpoint,20))item.append(element('p','sp-chat-note',`${source.symbol} · frozen ${source.checkpoint} NY checkpoint`));
  const codeLabel=element('label','sp-chat-code-label','TradingView forecast code');const code=element('textarea','sp-chat-code');code.readOnly=true;code.value=result.code;code.rows=2;code.setAttribute('aria-label',`${result.market} forecast code`);codeLabel.append(code);
  const copy=element('button','sp-chat-copy','Copy code');copy.type='button';const feedback=element('span','sp-chat-copy-feedback','Copied!');feedback.hidden=true;feedback.setAttribute('role','status');
  let copyTimer;copy.addEventListener('click',async()=>{try{await win.navigator.clipboard.writeText(result.code);clearTimeout(copyTimer);copyTimers.delete(copyTimer);feedback.textContent='Copied!';feedback.hidden=false;feedback.classList.remove('sp-chat-faded');copyTimer=setTimeout(()=>{feedback.classList.add('sp-chat-faded');copyTimers.delete(copyTimer);},2000);copyTimers.add(copyTimer);}catch{feedback.textContent='Select and copy the code above.';feedback.hidden=false;code.focus();code.select();}});
  item.append(codeLabel,copy,feedback);for(const warning of Array.isArray(result.warnings)?result.warnings.slice(0,3):[])if(plain(warning,300))item.append(element('p','sp-chat-note',warning));
  const stored=messages[messages.length-1];stored.text+=`\nMean U ${fmt(result.range.upPoints)} pt / D ${fmt(result.range.downPoints)} pt. Containment ${(result.probabilities.containment.p*100).toFixed(1)}%.`;save();scroll();
 }
 async function runForecast(intent,query,signal){
  lastWindow=intent.window;lastDate=intent.date??null;save();
  if(intent.market!==instrument.id){pending={intent:{...intent,ok:true},query,createdAt:now()};save();status.textContent=`Opening ${intent.market}${intent.date?' · '+intent.date:''}…`;navigate(assistantMarketURL(intent.market,rootURL));return;}
  status.textContent=intent.date&&intent.date!==nyDate(now())?`Reading historical inputs for ${intent.date}…`:'Reading the latest TradingView checkpoint…';await waitForReady(doc,signal,requestTimeout);if(signal.aborted)throw abortError();
  const requestId=win.crypto.randomUUID();status.textContent='Calculating your SessionPath forecast…';const result=await requestForecast(doc,intent,signal,requestId,requestTimeout);if(signal.aborted||destroyed)throw abortError();
  if(result?.ok!==true)throw new Error(plain(result?.error?.message,400)?result.error.message:'The forecast is unavailable. Please try again.');
  if(!validForecast(result,intent))throw new Error('The forecast response was incomplete. Please try again.');
  if(intent.date&&result.date!==intent.date)throw new Error(`The forecast does not match ${intent.date}. No code was copied or substituted from another date.`);
  if(result.date>nyDate(now()))throw new Error('That New York trading date has not occurred yet. Choose today or an earlier date.');
  if(!intent.date&&result.date!==nyDate(now()))throw new Error(`Today’s New York checkpoint is unavailable. The received ${result.date} forecast was not substituted.`);
  if(result.mode!==undefined&&!['live','historical'].includes(result.mode))throw new Error('The forecast mode was invalid. Please try again.');
  if(result.mode==='live'&&result.date!==nyDate(now()))throw new Error('The live checkpoint is for a different New York date. Please try again.');
  renderForecast(result,intent);
 }
 async function submit(query=input.value,resumedIntent=null){
  if(busy||preparingImage||destroyed)return;const chart=!resumedIntent&&attachment;
  if(chart&&typeof query==='string'&&!query.trim())query=DEFAULT_CHART_QUESTION;
  if(!plain(query,600)||!query.trim()){open();status.textContent='Ask for a market and a session, for example CL 03-05.';return;}
  let observation=null;
  try{if(chart)observation=chartObservationNow();}catch(error){open();status.textContent=error.message;return;}
  query=query.trim();controller?.abort();controller=new AbortController();const signal=controller.signal;let timedOut=false;open();setBusy(true,chart?'Reading your screenshot…':'Understanding your request…');if(!resumedIntent)bubble('user',query,{remember:!chart});input.value='';
  try{
   if(chart){
    const context=contextNow(),timeout=setTimeout(()=>{timedOut=true;controller.abort();},195000);let response,body;
    try{response=await fetchImpl(CHART_ENDPOINT,{method:'POST',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json','Accept':'text/event-stream'},body:JSON.stringify({message:query,context,referenceVersion:CHART_REFERENCE_VERSION,image:{dataUrl:chart.dataUrl},...(observation?{observation}:{})}),signal});if(signal.aborted||destroyed)throw abortError();body=await readChartResponse(response,{signal});}finally{clearTimeout(timeout);}
    if(signal.aborted||destroyed)throw abortError();
    if(!response.ok||body.ok!==true)throw new Error(plain(body?.error?.message,400)?body.error.message:response.status===429?'Chart-reading limit reached. Please try again later.':'The chart reader is temporarily unavailable. Please try again.');
    if(!validateChartReading(body,context,observation))throw new Error('The chart reading was incomplete. Please refresh and try again.');
    renderChart(body,query,context);clearAttachment();return;
   }
   let intent=resumedIntent;
   if(!intent){
    // Presence of date (including null) tells the server this client preserves
    // dated intents. Cached pre-date clients must never get a historical intent
    // that they would accidentally execute as today's forecast.
    const context=contextNow();
    const timeout=setTimeout(()=>{timedOut=true;controller.abort();},20000);let response;try{response=await fetchImpl(ENDPOINT,{method:'POST',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:query,context}),signal});}finally{clearTimeout(timeout);}
    if(signal.aborted)throw abortError();let body;try{body=await response.json();}catch{throw new Error('The assistant returned an unreadable response. Please try again.');}
    if(!response.ok||body.ok!==true)throw new Error(plain(body?.error?.message,400)?body.error.message:response.status===429?'Usage limit reached. Please try again later.':'The assistant is temporarily unavailable. Please try again.');
    intent=validateChatIntent(body);if(!intent)throw new Error('The assistant could not identify a supported request. Try CL 03-05.');
    if(intent.action==='forecast'&&!Object.hasOwn(body,'date')&&mentionsDate(query))throw new Error('Dated requests are not available from this assistant version yet. Please refresh and try again; today’s code was not substituted.');
   }
   if(intent.action==='forecast')await runForecast(intent,query,signal);
   else if(intent.action==='explain')bubble('assistant',DEFINITIONS[intent.concept]);
   else bubble('assistant',intent.message||'Choose CL, NQ, ES or GC and one window: 03:00–05:00, 05:00–08:30 or 08:30–16:00 NY.');
  }catch(error){if(chart&&!destroyed)input.value=query;failure(timedOut?new Error(chart?'The chart reader took too long. Your screenshot is still attached; try again.':'The assistant took too long. Please try again.'):error,query,{chart:Boolean(chart)});}finally{if(!destroyed)setBusy(false);}
 }
 attach.addEventListener('click',()=>filePicker.click());filePicker.addEventListener('change',()=>{const file=filePicker.files?.[0];if(file)stageImage(file);});removeAttachment.addEventListener('click',()=>{if(!busy)clearAttachment();});
 historical.addEventListener('change',()=>{observationFields.hidden=!historical.checked;chartDate.required=historical.checked;chartDate.max=nyDate(now());if(historical.checked&&!chartDate.value&&doc.getElementById('replay-toggle')?.checked){const date=doc.getElementById('replay-date')?.value;if(canonicalDate(date))chartDate.value=date;}});
 host.addEventListener('dragover',event=>{if([...event.dataTransfer?.types??[]].includes('Files')){event.preventDefault();host.classList.add('sp-chat-dragover');}});
 host.addEventListener('dragleave',event=>{if(!host.contains(event.relatedTarget))host.classList.remove('sp-chat-dragover');});
 host.addEventListener('drop',event=>{host.classList.remove('sp-chat-dragover');const file=event.dataTransfer?.files?.[0];if(!file)return;event.preventDefault();stageImage(file);});
 host.addEventListener('paste',event=>{const items=[...event.clipboardData?.items??[]],file=items.find(item=>item.kind==='file'&&item.type.startsWith('image/'))?.getAsFile()??[...event.clipboardData?.files??[]].find(file=>file.type.startsWith('image/'));if(file){event.preventDefault();stageImage(file);}});
 form.addEventListener('submit',event=>{event.preventDefault();submit();});toggle.addEventListener('click',()=>{open();input.focus();});input.addEventListener('focus',open);input.addEventListener('pointerdown',open);input.addEventListener('input',open);close.addEventListener('click',collapse);host.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();collapse();}});
 function destroy(){destroyed=true;controller?.abort();clearAttachment();clearTimeout(motionTimer);motionObserver.disconnect();reducedMotion?.removeEventListener?.('change',finishPausedMotion);for(const timer of copyTimers)clearTimeout(timer);copyTimers.clear();win.removeEventListener('pagehide',destroy);host.remove();}
 win.addEventListener('pagehide',destroy,{once:true});
 if(pending){const continuation=pending;pending=null;save();if(continuation.intent.market===instrument.id)submit(continuation.query,continuation.intent);}
 return {submit,attachImage:stageImage,clearAttachment,destroy,element:host};
}
