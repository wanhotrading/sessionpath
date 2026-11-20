import {FeedError,normalizePacket,PERSONAL_MARKETS,targetSessionDate,validDate,nyDate,nyEpoch} from './validation.mjs';
import { summarizeOvernightTiming } from './overnight-timing.mjs';
export const PERSONAL_ORIGIN='https://wanhotrading.github.io';
export const MAX_BODY_BYTES=16384;
const encoder=new TextEncoder();
function hasValidMarketQuery(url){return [...url.searchParams.keys()].every(k=>k==='market')&&url.searchParams.getAll('market').length===1&&Object.hasOwn(PERSONAL_MARKETS,url.searchParams.get('market'));}
const historyDateFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
function hasValidHistoryQuery(url,current){
  const date=url.searchParams.get('date'),parts=Object.fromEntries(historyDateFormat.formatToParts(current).map(p=>[p.type,p.value])),today=`${parts.year}-${parts.month}-${parts.day}`;
  return [...url.searchParams.keys()].every(k=>k==='market'||k==='date')&&url.searchParams.getAll('market').length===1&&url.searchParams.getAll('date').length===1&&Object.hasOwn(PERSONAL_MARKETS,url.searchParams.get('market'))&&/^20\d{2}-\d{2}-\d{2}$/.test(date??'')&&Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date&&date<=today;
}
async function readHistory(market,date,env){
  const saved=await env.PERSONAL_FEEDS.getByName(market).getHistory(date);
  return {schema:'sessionpath.tradingview.history.v1',status:saved?.packet.snapshots.length?'ready':'unavailable',date,receivedAt:saved?.receivedAt??null,packet:publicPacket(saved?.packet),source:'TradingView personal Pine alert',validationBasis:'authenticated_pine_attestation',...checkpointMetadata(saved)};
}
// A source may revise historical candles when its alert runtime recalculates.
// Reads retain the first verified version of EACH decision checkpoint. A later
// checkpoint is verified on its own receipt, rather than being represented as
// part of one unchanged upstream packet. These receipts contain no credentials.
function checkpointMetadata(entry){
  return {snapshotPolicy:'first-accepted-per-checkpoint',checkpointProvenance:entry?.checkpointProvenance??null,reconciliation:entry?.reconciliation??null};
}
async function readSnapshot(market,env,current){
  const latest=await env.PERSONAL_FEEDS.getByName(market).getLatest();
  const stale=latest&&(current-latest.observedMs>480000||current-Date.parse(latest.receivedAt)>480000||latest.packet.session_date!==targetSessionDate(current));
  return {schema:'sessionpath.tradingview.read.v1',status:stale?'stale':latest?.packet.snapshots.length?'ready':'waiting',receivedAt:latest?.receivedAt??null,packet:publicPacket(latest?.packet),source:'TradingView personal Pine alert',validationBasis:'authenticated_pine_attestation',...checkpointMetadata(latest)};
}
function publicPacket(packet){
  if(!packet)return null;
  const {research_bars,...published}=packet;
  const overnight = summarizeOvernightTiming(packet);
  return {...published,
    ...(research_bars?{research_through:180+5*(research_bars.length/3)}:{}),
    ...(overnight?{overnight_timing:overnight}:{}),
  };
}
const followupWindows={'03:00':[180,300],'05:00':[300,510],'08:30':[510,960]};
function followupQuery(url,now){
  const query=url.searchParams;
  if(query.size!==5||['market','date','cutoff','upper','lower'].some(k=>query.getAll(k).length!==1))return null;
  const market=query.get('market'),date=query.get('date'),cutoff=query.get('cutoff');
  if(!Object.hasOwn(PERSONAL_MARKETS,market)||!validDate(date)||date>nyDate(now)||!Object.hasOwn(followupWindows,cutoff))return null;
  const read=name=>/^\d{1,10}(?:\.\d{1,8})?$/.test(query.get(name))?Number(query.get(name)):NaN;
  const upper=read('upper'),lower=read('lower');
  if(!(upper>lower&&lower>0&&upper<=1e9))return null;
  return {market,date,cutoff,upper,lower};
}
export function verifiedFirstBreach(packet,{market,date,cutoff,upper,lower}){
  const range=followupWindows[cutoff];
  if(!packet||packet.session_date!==date||packet.market!==market||!range||!packet.snapshots.some(s=>s.cutoff===cutoff))return {status:'unavailable'};
  const [start,end]=range,bars=packet.research_bars,tick=PERSONAL_MARKETS[market];
  if(!bars?.length)return {status:'unavailable'};
  const through=Math.min(end,180+5*(bars.length/3));
  if(through<=start)return {status:'waiting'};
  const epsilon=1e-8,width=upper-lower;
  for(let minute=start+5;minute<=through;minute+=5){
    const offset=3*((minute-180)/5-1);
    if(bars[offset]===null)return {status:'gap'};
    const high=bars[offset]*tick,low=bars[offset+1]*tick,close=bars[offset+2]*tick;
    const up=high>upper+epsilon,down=low<lower-epsilon;
    if(up&&down)return {status:'ambiguous',minute};
    if(!up&&!down)continue;
    const outside=close>upper+epsilon||close<lower-epsilon;
    const reaches=factor=>up?high>=lower+factor*width-epsilon:low<=upper-factor*width+epsilon;
    return {status:'breach',minute,observation:{side:up?'U':'D',signalType:outside?'CLOSE_OUTSIDE':'WICK_ONLY',
      strengthPercent:outside?Math.max(0,100*(up?close-upper:lower-close)/width):null,
      alreadyReached:{reach120:reaches(1.2),reach130:reaches(1.3)}}};
  }
  return {status:'unbreached',minute:through};
}
export async function sha256(value,cryptoImpl=globalThis.crypto){return Array.from(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',encoder.encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function authenticateToken(token,expectedHash,cryptoImpl=globalThis.crypto){
  if(typeof expectedHash!=='string'||!/^[a-f0-9]{64}$/.test(expectedHash))throw new FeedError('SERVICE_UNCONFIGURED',503);
  // Both buffers are fixed-size SHA-256 digests. Workers supplies a native
  // timing-safe comparison; tests inject Node's native equivalent.
  const supplied=await cryptoImpl.subtle.digest('SHA-256',encoder.encode(typeof token==='string'?token:''));
  const expected=Uint8Array.from(expectedHash.match(/../g),h=>parseInt(h,16));
  if(typeof cryptoImpl.subtle.timingSafeEqual!=='function')throw new FeedError('SERVICE_UNAVAILABLE',503);
  const equal=cryptoImpl.subtle.timingSafeEqual(supplied,expected);
  return equal&&typeof token==='string'&&/^[A-Za-z0-9_-]{32,256}$/.test(token);
}
export async function boundedJSON(request){
  if(!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get('content-type')??''))throw new FeedError('JSON_REQUIRED',415);
  const length=request.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_BODY_BYTES))throw new FeedError('BODY_TOO_LARGE',413);
  if(!request.body)throw new FeedError('INVALID_JSON');
  const reader=request.body.getReader();const chunks=[];let bytes=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_BODY_BYTES){await reader.cancel();throw new FeedError('BODY_TOO_LARGE',413);}chunks.push(value);}}
  finally{reader.releaseLock();}
  const result=new Uint8Array(bytes);let offset=0;for(const c of chunks){result.set(c,offset);offset+=c.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(result));}catch{throw new FeedError('INVALID_JSON');}
}
export function createPersonalHandler({now=Date.now,cryptoImpl=globalThis.crypto}={}){
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
      if(url.pathname==='/api/followup'&&request.method==='GET'){
        if(env.PUBLIC_AUTOFILL_ENABLED!=='true')throw new FeedError('NOT_FOUND',404);
        const query=followupQuery(url,now());
        if(!query)throw new FeedError('INVALID_QUERY');
        const saved=await env.PERSONAL_FEEDS.getByName(query.market).getHistory(query.date);
        return reply({date:query.date,market:query.market,cutoff:query.cutoff,...verifiedFirstBreach(saved?.packet,query)});
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

