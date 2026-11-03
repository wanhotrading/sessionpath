import {FeedError,normalizePacket,PERSONAL_MARKETS,targetSessionDate} from './validation.mjs';
export const PERSONAL_ORIGIN='https://wanhotrading.github.io';
export const MAX_BODY_BYTES=16384;
const encoder=new TextEncoder();
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
        if(origin!==PERSONAL_ORIGIN||url.pathname!=='/api/snapshots'||[...url.searchParams.keys()].some(k=>k!=='market')||url.searchParams.getAll('market').length!==1||!Object.hasOwn(PERSONAL_MARKETS,url.searchParams.get('market')))throw new FeedError('ORIGIN_DENIED',403);
        if(request.headers.get('Access-Control-Request-Method')!=='GET'||(request.headers.get('Access-Control-Request-Headers')??'').split(',').some(x=>x.trim()&&!['authorization'].includes(x.trim().toLowerCase())))throw new FeedError('PREFLIGHT_DENIED',403);
        headers.set('Access-Control-Allow-Methods','GET');headers.set('Access-Control-Allow-Headers','Authorization');headers.set('Access-Control-Max-Age','300');return reply(null,204);
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
      if(url.pathname==='/api/snapshots'&&request.method==='GET'){
        if([...url.searchParams.keys()].some(k=>k!=='market')||url.searchParams.getAll('market').length!==1||!Object.hasOwn(PERSONAL_MARKETS,url.searchParams.get('market')))throw new FeedError('INVALID_QUERY');
        const bearer=/^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(request.headers.get('Authorization')??'');
        if(!await authenticateToken(bearer?.[1],env.READ_TOKEN_HASH,cryptoImpl))throw new FeedError('UNAUTHORIZED',401);
        const latest=await env.PERSONAL_FEEDS.getByName(url.searchParams.get('market')).getLatest();
        const current=now();
        const stale=latest&&(current-latest.observedMs>480000||current-Date.parse(latest.receivedAt)>480000||latest.packet.session_date!==targetSessionDate(current));
        return reply({schema:'sessionpath.tradingview.read.v1',status:stale?'stale':latest?.packet.snapshots.length?'ready':'waiting',receivedAt:latest?.receivedAt??null,packet:latest?.packet??null,source:'TradingView personal Pine alert',validationBasis:'authenticated_pine_attestation'});
      }
      throw new FeedError('NOT_FOUND',404);
    }catch(error){
      // No request, token, header, body, or exception strings are logged/echoed.
      return reply({error:error instanceof FeedError?error.code:'SERVICE_UNAVAILABLE'},error instanceof FeedError?error.status:503);
    }
  };
}
