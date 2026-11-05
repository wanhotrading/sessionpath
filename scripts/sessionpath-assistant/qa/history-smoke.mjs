import {writeFile} from 'node:fs/promises';
import {FREE_MODEL} from '../router.mjs';
const assistant='https://sessionpath-assistant.jjj-jason2345.workers.dev';
const source='https://sessionpath-personal.jjj-jason2345.workers.dev';
const headers={'Content-Type':'application/json',Origin:'https://wanhotrading.github.io'};
const results=[];
async function ask(message,context){
 const response=await fetch(assistant+'/api/chat',{method:'POST',headers,body:JSON.stringify({message,context}),signal:AbortSignal.timeout(12000)});
 const body=await response.json();if(!response.ok||body.ok!==true)throw Error('Intent request failed: '+response.status);
 return body;
}
for(const [name,message,context,expected]of [
 ['user example','can you fetch the CL 03-05 code of 2nd Nov?',{market:'CL',window:'03:00-05:00',date:null},{action:'forecast',market:'CL',date:'2026-11-02'}],
 ['cached-client safety','can you fetch the CL 03-05 code of 2nd Nov?',{market:'CL',window:'03:00-05:00'},{action:'clarify',date:null}],
 ['historical follow-up','NQ 05-0830',{market:'CL',window:'03:00-05:00',date:'2026-11-02'},{action:'forecast',market:'NQ',date:'2026-11-02'}],
 ['return today','CL 03-05 today',{market:'CL',window:'03:00-05:00',date:'2026-11-02'},{action:'forecast',date:null}],
 ['Chinese date','CL 03-05 2026年11月2日',{market:'CL',window:'03:00-05:00',date:null},{action:'forecast',date:'2026-11-02'}],
 ['invalid date','CL 03-05 2026-02-30',{market:'CL',window:'03:00-05:00',date:null},{action:'clarify',date:null}],
 ['future date','CL 03-05 2099-11-02',{market:'CL',window:'03:00-05:00',date:null},{action:'clarify',date:null}],
]){
 const body=await ask(message,context);for(const[key,value]of Object.entries(expected))if(body[key]!==value)throw Error(name+': '+key+' mismatch');
 if(body.interpreter!=='rules')throw Error(name+': deterministic command unexpectedly used AI');
 results.push({name,action:body.action,market:body.market,date:body.date,interpreter:body.interpreter});
}
const historyResponse=await fetch(source+'/api/history?market=CL&date=2026-11-02',{headers:{Origin:headers.Origin},signal:AbortSignal.timeout(12000)});
const history=await historyResponse.json();
if(!historyResponse.ok||history.schema!=='sessionpath.tradingview.history.v1'||history.date!=='2026-11-02'||!['ready','unavailable'].includes(history.status))throw Error('Historical source contract failed');
if(history.packet&&history.packet.session_date!=='2026-11-02')throw Error('Historical source substituted a different date');
const health=await (await fetch(assistant+'/health')).json();if(health.model!==FREE_MODEL||!health.freeModelsOnly)throw Error('Free-only service changed');
const report={checkedAt:new Date().toISOString(),health,results,sourceHistoryStatus:history.status,modelCallsMade:0,credentialsUsed:false};
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
