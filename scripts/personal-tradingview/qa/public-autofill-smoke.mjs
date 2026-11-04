import {writeFile} from 'node:fs/promises';
import {validatePersonalRead} from '../../../docs/tradingview-live-core.mjs';

// Live GETs only. No private keys, cookies, synthetic packets or webhook writes.
const endpoint='https://sessionpath-personal.jjj-jason2345.workers.dev';
const checkedAt=new Date().toISOString();
const results=await Promise.all(['CL','NQ','ES','GC'].map(async market=>{
 const target=new URL('/api/autofill',endpoint);target.searchParams.set('market',market);
 const response=await fetch(target,{headers:{Origin:'https://wanhotrading.github.io'},credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(12000)});
 const body=await response.json();
 if(!response.ok)throw Error(market+': PUBLIC_READ_FAILED');
 const packet=validatePersonalRead(body,{market});
 if(!packet)throw Error(market+': NO_COMPLETE_CHECKPOINT');
 return {market,http:response.status,status:body.status,credentialless:true,cors:response.headers.get('access-control-allow-origin'),observedAt:packet.observed_at,receivedAt:body.receivedAt,checkpoints:packet.snapshots.map(s=>({cutoff:s.cutoff,decisionOpen:s.reference_price,avr:s.avr})),containsCredentialField:Object.hasOwn(packet,'token')};
}));
const privateResponse=await fetch(new URL('/api/snapshots?market=CL',endpoint),{cache:'no-store',signal:AbortSignal.timeout(12000)});
if(privateResponse.status!==401)throw Error('PRIVATE_READ_AUTH_REGRESSION');
const report={checkedAt,readOnly:true,noTestPacketsInserted:true,results,anonymousPrivateReadHTTP:privateResponse.status};
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
