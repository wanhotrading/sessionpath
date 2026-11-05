// validation.mjs
const PERSONAL_SCHEMA = 'sessionpath.personal.tradingview.v1';
const PERSONAL_AVR_PROFILE = 'continuous-prior10-0930-1600-frozen-before1930-v1';
const PERSONAL_MARKETS = Object.freeze({CL:0.01,NQ:0.25,ES:0.25,GC:0.1});
const PERSONAL_CUTOFFS = ['03:00','05:00','08:30'];
class FeedError extends Error {
  constructor(code,status=400){super(code);this.code=code;this.status=status;}
}
const bad=(code)=>{throw new FeedError(code);};
const nyFormatter = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function nyParts(ms){return Object.fromEntries(nyFormatter.formatToParts(new Date(ms)).map(p=>[p.type,p.value]));}
function datePlus(date,days){return new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);}
function validDate(date){return typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T12:00:00Z'))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date;}
function weekday(date){return ![0,6].includes(new Date(date+'T12:00:00Z').getUTCDay());}
function previousWeekday(date){let prior=datePlus(date,-1);while(!weekday(prior))prior=datePlus(prior,-1);return prior;}
function nyDate(ms){const p=nyParts(ms);return `${p.year}-${p.month}-${p.day}`;}
function targetSessionDate(ms){const p=nyParts(ms),d=`${p.year}-${p.month}-${p.day}`;return Number(p.hour)*60+Number(p.minute)>=1170?datePlus(d,1):d;}
function nyEpoch(date,clock){
  const base=Date.parse(date+'T'+clock+':00Z'); let guess=base;
  for(let i=0;i<3;i++){const p=nyParts(guess);const represented=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);guess+=base-represented;}
  return guess;
}
function instant(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))bad('INVALID_TIMESTAMP');const n=Date.parse(value);if(!Number.isFinite(n)||new Date(n).toISOString().replace('.000Z','Z')!==value.replace('.000Z','Z'))bad('INVALID_TIMESTAMP');return n;}
function keys(obj,allowed){if(!obj||typeof obj!=='object'||Array.isArray(obj)||Object.keys(obj).some(k=>!allowed.includes(k)))bad('UNEXPECTED_FIELDS');}
function price(value,tick){if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>1e9||Math.abs(value/tick-Math.round(value/tick))>0.00001)bad('INVALID_PRICE');return Number((Math.round(value/tick)*tick).toFixed(2));}
const snapshotKeys=['cutoff','as_of','reference_price','open_1930','range_high','range_low','prior_high','prior_low','prior_ny_date','prior_ny_count','avr','avr_count','avr_dates','avr_frozen_at','avr_override','last_hour_rule','asia_high','asia_low','asia_close','asia_complete','london_high','london_low','london_close','london_complete','ready'];
function normalizeSnapshot(s,{date,observedMs,tick}){
  keys(s,snapshotKeys);
  if(!PERSONAL_CUTOFFS.includes(s.cutoff)||instant(s.as_of)!==nyEpoch(date,s.cutoff)||observedMs<instant(s.as_of)+300000)bad('INVALID_CUTOFF');
  if(s.ready!==true||s.avr_override!==false||s.avr_count!==10||s.prior_ny_count!==78||s.asia_complete!==true||!Number.isInteger(s.last_hour_rule)||s.last_hour_rule<1||s.last_hour_rule>5)bad('INCOMPLETE_SNAPSHOT');
  if(typeof s.avr!=='number'||!Number.isFinite(s.avr)||s.avr<=0||s.avr>1e9)bad('INVALID_AVR');
  const frozen=nyEpoch(datePlus(date,-1),'19:30');
  if(instant(s.avr_frozen_at)!==frozen)bad('INVALID_AVR_FREEZE');
  if(!validDate(s.prior_ny_date)||s.prior_ny_date!==previousWeekday(date))bad('INVALID_PRIOR_SESSION');
  if(!Array.isArray(s.avr_dates)||s.avr_dates.length!==10||s.avr_dates.some((d,i)=>!validDate(d)||!weekday(d)||d>=date||(i>0&&d<=s.avr_dates[i-1])||nyEpoch(d,'16:00')>frozen)||s.avr_dates[9]!==s.prior_ny_date)bad('INVALID_AVR_DATES');
  const result={cutoff:s.cutoff,as_of:new Date(instant(s.as_of)).toISOString()};
  for(const k of ['reference_price','open_1930','range_high','range_low','prior_high','prior_low'])result[k]=price(s[k],tick);
  if(result.prior_high<=result.prior_low||result.range_high<result.range_low||[result.open_1930,result.reference_price].some(v=>v<result.range_low||v>result.range_high))bad('INCONSISTENT_PRICES');
  Object.assign(result,{prior_ny_date:s.prior_ny_date,prior_ny_count:78,avr:s.avr,avr_count:10,avr_dates:[...s.avr_dates],avr_frozen_at:new Date(frozen).toISOString(),avr_override:false,last_hour_rule:s.last_hour_rule});
  for(const k of ['asia_high','asia_low','asia_close'])result[k]=price(s[k],tick);
  if(result.asia_high<=result.asia_low||result.asia_close<result.asia_low||result.asia_close>result.asia_high||result.asia_high>result.range_high||result.asia_low<result.range_low)bad('INCONSISTENT_ASIA');
  result.asia_complete=true;
  const londonReady=s.cutoff==='08:30';
  if(s.london_complete!==londonReady)bad('INVALID_LONDON_STATE');
  for(const k of ['london_high','london_low','london_close']){if(londonReady)result[k]=price(s[k],tick);else {if(s[k]!==null)bad('FUTURE_LONDON_VALUES');result[k]=null;}}
  if(londonReady&&(result.london_high<=result.london_low||result.london_close<result.london_low||result.london_close>result.london_high||result.london_high>result.range_high||result.london_low<result.range_low))bad('INCONSISTENT_LONDON');
  result.london_complete=londonReady;result.ready=true;return result;
}
function normalizePacket(input,{now=Date.now()}={}){
  keys(input,['schema','token','market','source_symbol','timeframe','timezone','observed_at','sent_at','session_date','avr_profile','feed_type','backadjustment','snapshots','last_price','confirmed']);
  if(input.schema!==PERSONAL_SCHEMA||!Object.hasOwn(PERSONAL_MARKETS,input.market)||input.source_symbol!==input.market+'1!'||input.timeframe!=='5'||input.timezone!=='America/New_York'||input.confirmed!==true||input.feed_type!=='continuous_front_contract'||input.backadjustment!=='off'||input.avr_profile!==PERSONAL_AVR_PROFILE)bad('INVALID_FEED');
  const observedMs=instant(input.observed_at),sentMs=instant(input.sent_at);
  if(observedMs%300000||observedMs>now+5000||now-observedMs>180000||sentMs<observedMs||sentMs>now+30000||now-sentMs>180000||sentMs-observedMs>180000)bad('STALE_TRANSPORT');
  if(!validDate(input.session_date)||input.session_date!==targetSessionDate(observedMs-1))bad('SESSION_DATE_MISMATCH');
  if(!Array.isArray(input.snapshots)||input.snapshots.length>3)bad('INVALID_SNAPSHOTS');
  const snapshots=input.snapshots.map(s=>normalizeSnapshot(s,{date:input.session_date,observedMs,tick:PERSONAL_MARKETS[input.market]}));
  if(snapshots.some((s,i)=>i&&PERSONAL_CUTOFFS.indexOf(s.cutoff)<=PERSONAL_CUTOFFS.indexOf(snapshots[i-1].cutoff)))bad('DUPLICATE_OR_UNORDERED_CUTOFF');
  if(snapshots.length&&(!weekday(input.session_date)||nyDate(observedMs)!==input.session_date))bad('INVALID_SESSION_DATE');
  // Available snapshots are cumulative; a sender may omit a still-unready cutoff,
  // but must never skip an earlier ready cutoff and supply a later one.
  if(snapshots.some((s,i)=>s.cutoff!==PERSONAL_CUTOFFS[i]))bad('MISSING_EARLIER_CUTOFF');
  const shared=['open_1930','prior_high','prior_low','prior_ny_date','prior_ny_count','avr','avr_count','avr_dates','avr_frozen_at','asia_high','asia_low','asia_close'];
  if(snapshots.some((s,i)=>i&&(shared.some(k=>JSON.stringify(s[k])!==JSON.stringify(snapshots[0][k]))||s.range_high<snapshots[i-1].range_high||s.range_low>snapshots[i-1].range_low)))bad('INCONSISTENT_SNAPSHOT_SEQUENCE');
  return {schema:PERSONAL_SCHEMA,market:input.market,source_symbol:input.source_symbol,timeframe:'5',timezone:'America/New_York',confirmed:true,observed_at:new Date(observedMs).toISOString(),sent_at:new Date(sentMs).toISOString(),session_date:input.session_date,avr_profile:PERSONAL_AVR_PROFILE,feed_type:'continuous_front_contract',backadjustment:'off',snapshots,last_price:price(input.last_price,PERSONAL_MARKETS[input.market])};
}

// state.mjs
function decideFeedUpdate(current,incoming){
  if(current&&incoming.packet.session_date===current.packet.session_date){
    for(const [cutoff,hash] of Object.entries(current.snapshotHashes))if(incoming.snapshotHashes[cutoff]!==hash)return {status:'conflict',code:'IMMUTABLE_SNAPSHOT'};
  }
  if(current&&incoming.observedMs<=current.observedMs)return {status:incoming.packetHash===current.packetHash?'duplicate':'ignored'};
  if(current&&incoming.packet.session_date<current.packet.session_date)return {status:'ignored'};
  return {status:'accepted'};
}
// SQLite-backed Durable Objects also expose the transactional KV storage API.
// Keep frozen daily inputs separately from the live heartbeat. Neither record
// contains a token; unchanged five-minute heartbeats do not rewrite history.
const MAX_HISTORY_DATES=1024;
class PersonalFeedStore {
  constructor(storage,{historyLimit=MAX_HISTORY_DATES}={}){this.storage=storage;this.historyLimit=historyLimit;}
  async getLatest(){return (await this.storage.get('latest'))??null;}
  async getHistory(date){
    const saved=await this.storage.get('history:'+date);
    if(saved)return saved;
    const latest=await this.getLatest();
    return latest?.packet.session_date===date&&latest.packet.snapshots.length?latest:null;
  }
  async archive(tx,entry){
    if(!entry?.packet.snapshots.length)return;
    const date=entry.packet.session_date,key='history:'+date,prior=await tx.get(key);
    if(prior&&JSON.stringify(prior.snapshotHashes)===JSON.stringify(entry.snapshotHashes))return;
    if(prior&&decideFeedUpdate(prior,entry).status!=='accepted')return;
    await tx.put(key,entry);
    if(prior)return;
    const dates=[...new Set([...(await tx.get('history-dates')??[]),date])].sort();
    while(dates.length>this.historyLimit)await tx.delete('history:'+dates.shift());
    await tx.put('history-dates',dates);
  }
  async accept(incoming){return this.storage.transaction(async tx=>{
    const current=await tx.get('latest'),result=decideFeedUpdate(current,incoming);
    if(result.status==='accepted'){
      // Upgrade old deployments lazily: save their last complete day before
      // the next session replaces it, even when the new packet is a heartbeat.
      await this.archive(tx,current);await this.archive(tx,incoming);
      await tx.put('latest',incoming);
    }
    return result;
  });}
}

// router.mjs
const PERSONAL_ORIGIN='https://wanhotrading.github.io';
const MAX_BODY_BYTES=16384;
const encoder=new TextEncoder();
function hasValidMarketQuery(url){return [...url.searchParams.keys()].every(k=>k==='market')&&url.searchParams.getAll('market').length===1&&Object.hasOwn(PERSONAL_MARKETS,url.searchParams.get('market'));}
const historyDateFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
function hasValidHistoryQuery(url,current){
  const date=url.searchParams.get('date'),parts=Object.fromEntries(historyDateFormat.formatToParts(current).map(p=>[p.type,p.value])),today=`${parts.year}-${parts.month}-${parts.day}`;
  return [...url.searchParams.keys()].every(k=>k==='market'||k==='date')&&url.searchParams.getAll('market').length===1&&url.searchParams.getAll('date').length===1&&Object.hasOwn(PERSONAL_MARKETS,url.searchParams.get('market'))&&/^20\d{2}-\d{2}-\d{2}$/.test(date??'')&&Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date&&date<=today;
}
async function readHistory(market,date,env){
  const saved=await env.PERSONAL_FEEDS.getByName(market).getHistory(date);
  return {schema:'sessionpath.tradingview.history.v1',status:saved?.packet.snapshots.length?'ready':'unavailable',date,receivedAt:saved?.receivedAt??null,packet:saved?.packet??null,source:'TradingView personal Pine alert',validationBasis:'authenticated_pine_attestation'};
}
async function readSnapshot(market,env,current){
  const latest=await env.PERSONAL_FEEDS.getByName(market).getLatest();
  const stale=latest&&(current-latest.observedMs>480000||current-Date.parse(latest.receivedAt)>480000||latest.packet.session_date!==targetSessionDate(current));
  return {schema:'sessionpath.tradingview.read.v1',status:stale?'stale':latest?.packet.snapshots.length?'ready':'waiting',receivedAt:latest?.receivedAt??null,packet:latest?.packet??null,source:'TradingView personal Pine alert',validationBasis:'authenticated_pine_attestation'};
}
async function sha256(value,cryptoImpl=globalThis.crypto){return Array.from(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',encoder.encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');}
async function authenticateToken(token,expectedHash,cryptoImpl=globalThis.crypto){
  if(typeof expectedHash!=='string'||!/^[a-f0-9]{64}$/.test(expectedHash))throw new FeedError('SERVICE_UNCONFIGURED',503);
  // Both buffers are fixed-size SHA-256 digests. Workers supplies a native
  // timing-safe comparison; tests inject Node's native equivalent.
  const supplied=await cryptoImpl.subtle.digest('SHA-256',encoder.encode(typeof token==='string'?token:''));
  const expected=Uint8Array.from(expectedHash.match(/../g),h=>parseInt(h,16));
  if(typeof cryptoImpl.subtle.timingSafeEqual!=='function')throw new FeedError('SERVICE_UNAVAILABLE',503);
  const equal=cryptoImpl.subtle.timingSafeEqual(supplied,expected);
  return equal&&typeof token==='string'&&/^[A-Za-z0-9_-]{32,256}$/.test(token);
}
async function boundedJSON(request){
  if(!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get('content-type')??''))throw new FeedError('JSON_REQUIRED',415);
  const length=request.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_BODY_BYTES))throw new FeedError('BODY_TOO_LARGE',413);
  if(!request.body)throw new FeedError('INVALID_JSON');
  const reader=request.body.getReader();const chunks=[];let bytes=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_BODY_BYTES){await reader.cancel();throw new FeedError('BODY_TOO_LARGE',413);}chunks.push(value);}}
  finally{reader.releaseLock();}
  const result=new Uint8Array(bytes);let offset=0;for(const c of chunks){result.set(c,offset);offset+=c.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(result));}catch{throw new FeedError('INVALID_JSON');}
}
function createPersonalHandler({now=Date.now,cryptoImpl=globalThis.crypto}={}){
  return async function fetch(request,env){
    const headers=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, max-age=0','CDN-Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
    const reply=(body,status=200)=>new Response(body===null?null:JSON.stringify(body),{status,headers});
    try{
      const url=new URL(request.url),origin=request.headers.get('Origin');
      if(origin&&origin!==PERSONAL_ORIGIN)throw new FeedError('ORIGIN_DENIED',403);
      if(origin===PERSONAL_ORIGIN)headers.set('Access-Control-Allow-Origin',origin);
      if(request.method==='OPTIONS'){
        const privateRead=url.pathname==='/api/snapshots',publicRead=url.pathname==='/api/autofill'&&env.PUBLIC_AUTOFILL_ENABLED==='true',historyRead=url.pathname==='/api/history'&&env.PUBLIC_AUTOFILL_ENABLED==='true';
        if(origin!==PERSONAL_ORIGIN||(!privateRead&&!publicRead&&!historyRead)||!(historyRead?hasValidHistoryQuery(url,now()):hasValidMarketQuery(url)))throw new FeedError('ORIGIN_DENIED',403);
        const allowedHeaders=privateRead?['authorization']:[];
        if(request.headers.get('Access-Control-Request-Method')!=='GET'||(request.headers.get('Access-Control-Request-Headers')??'').split(',').some(x=>x.trim()&&!allowedHeaders.includes(x.trim().toLowerCase())))throw new FeedError('PREFLIGHT_DENIED',403);
        headers.set('Access-Control-Allow-Methods','GET');if(privateRead)headers.set('Access-Control-Allow-Headers','Authorization');headers.set('Access-Control-Max-Age','300');return reply(null,204);
      }
      if(url.pathname==='/health'&&request.method==='GET'&&!url.search)return reply({ok:true,service:'sessionpath-personal'});
      if(url.pathname==='/webhook'&&request.method==='POST'){
        if(url.search||request.headers.has('Authorization'))throw new FeedError('INVALID_REQUEST');
        const input=await boundedJSON(request);
        if(!await authenticateToken(input?.token,env.WRITE_TOKEN_HASH,cryptoImpl))throw new FeedError('UNAUTHORIZED',401);
        const receivedMs=now(),packet=normalizePacket(input,{now:receivedMs});
        const snapshotHashes=Object.fromEntries(await Promise.all(packet.snapshots.map(async s=>[s.cutoff,await sha256(JSON.stringify(s),cryptoImpl)])));
        const envelope={packet,receivedAt:new Date(receivedMs).toISOString(),observedMs:Date.parse(packet.observed_at),packetHash:await sha256(JSON.stringify(packet),cryptoImpl),snapshotHashes};
        const result=await env.PERSONAL_FEEDS.getByName(packet.market).accept(envelope);
        if(result.status==='conflict')throw new FeedError(result.code,409);
        return reply({status:result.status});
      }
      // This opt-in route deliberately shares the validated feed with everyone.
      // It never reads or forwards the private bearer/write credential.
      if(url.pathname==='/api/autofill'&&request.method==='GET'){
        if(env.PUBLIC_AUTOFILL_ENABLED!=='true')throw new FeedError('NOT_FOUND',404);
        if(!hasValidMarketQuery(url))throw new FeedError('INVALID_QUERY');
        return reply(await readSnapshot(url.searchParams.get('market'),env,now()));
      }
      if(url.pathname==='/api/history'&&request.method==='GET'){
        if(env.PUBLIC_AUTOFILL_ENABLED!=='true')throw new FeedError('NOT_FOUND',404);
        if(!hasValidHistoryQuery(url,now()))throw new FeedError('INVALID_QUERY');
        return reply(await readHistory(url.searchParams.get('market'),url.searchParams.get('date'),env));
      }
      if(url.pathname==='/api/snapshots'&&request.method==='GET'){
        if(!hasValidMarketQuery(url))throw new FeedError('INVALID_QUERY');
        const bearer=/^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(request.headers.get('Authorization')??'');
        if(!await authenticateToken(bearer?.[1],env.READ_TOKEN_HASH,cryptoImpl))throw new FeedError('UNAUTHORIZED',401);
        return reply(await readSnapshot(url.searchParams.get('market'),env,now()));
      }
      throw new FeedError('NOT_FOUND',404);
    }catch(error){
      // No request, token, header, body, or exception strings are logged/echoed.
      return reply({error:error instanceof FeedError?error.code:'SERVICE_UNAVAILABLE'},error instanceof FeedError?error.status:503);
    }
  };
}

// worker.mjs
import {DurableObject} from 'cloudflare:workers';

export class PersonalFeed extends DurableObject {
  async getLatest(){return new PersonalFeedStore(this.ctx.storage).getLatest();}
  async getHistory(date){return new PersonalFeedStore(this.ctx.storage).getHistory(date);}
  async accept(envelope){return new PersonalFeedStore(this.ctx.storage).accept(envelope);}
}
export default {fetch:createPersonalHandler()};
