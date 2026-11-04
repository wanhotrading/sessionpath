import {writeFile} from 'node:fs/promises';
const base='https://sessionpath-assistant.jjj-jason2345.workers.dev';
const headers={'Content-Type':'application/json',Origin:'https://wanhotrading.github.io'};
const healthResponse=await fetch(base+'/health',{signal:AbortSignal.timeout(12000)});
const health=await healthResponse.json();
if(!healthResponse.ok||health.freeModelsOnly!==true||health.model!=='openrouter/free')throw Error('FREE_ONLY_SERVICE_FAILED');
const results=[];
for(const [market,window,message]of [['CL','03:00-05:00','CL, 03-05 range'],['NQ','05:00-08:30','NQ 05-0830'],['ES','08:30-16:00','ES 08:30-16:00'],['GC','03:00-05:00','GC 03-05']]){
 const response=await fetch(base+'/api/chat',{method:'POST',headers,body:JSON.stringify({message,context:{market,window}}),signal:AbortSignal.timeout(12000)});
 const body=await response.json();
 if(!response.ok||body.action!=='forecast'||body.market!==market||body.window!==window||body.interpreter!=='rules')throw Error(market+': EXACT_COMMAND_FAILED');
 results.push({market,window,http:response.status,interpreter:body.interpreter,cors:response.headers.get('access-control-allow-origin')});
}
const report={checkedAt:new Date().toISOString(),health,results,modelCallsMade:0,credentialsUsed:false};
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
