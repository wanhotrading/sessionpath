import {writeFile} from 'node:fs/promises';
import {normalizeYahooChart,calculateContext} from './context-calculations.mjs';

const generatedAt=new Date().toISOString();
const date=new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'});
async function chart(symbol){
 const url='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?range=5d&interval=5m';
 const response=await fetch(url,{headers:{'User-Agent':'SessionPath/1.0 (delayed futures context)'},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('Yahoo Finance delayed data is unavailable. Try again later.');
 return response.json();
}
const snapshot={schema:'sessionpath.autofill.v1',generatedAt,source:'Yahoo Finance',markets:{}};
for(const market of ['CL','NQ']){
 let feed,failure;
 try{
  const alias=normalizeYahooChart(await chart(market+'=F'),{market});
  const contract=alias.meta.contract;
  const symbol=contract.slice(0,3)+contract.slice(-2)+(market==='CL'?'.NYM':'.CME');
  feed=normalizeYahooChart(await chart(symbol),{market});
  if(feed.meta.continuous||feed.meta.contract!==contract)throw Error('The front-month contract could not be verified.');
 }catch(error){failure=error.message||'The delayed-data source is unavailable.';}
 snapshot.markets[market]={};
 for(const cutoff of ['03:00','05:00']){
  try{
   if(failure)throw Error(failure);
   const data=calculateContext(feed,{date,cutoff,market,contract:feed.meta.contract});
   const values=Object.fromEntries(['priorLow','priorHigh','open1930','rangeHigh','rangeLow','up','down'].map(k=>[k,data[k]]));
   snapshot.markets[market][cutoff]={status:'ready',date,cutoff,market,generatedAt,source:'Yahoo Finance',sourceSymbol:data.symbol,contract:data.contract,continuous:false,quoteTime:data.quoteTime,priorDate:data.priorDate,priorBarCount:data.priorBarCount,overnightBarCount:data.overnightBarCount,values};
   console.log(market,cutoff,data.contract,'ready',JSON.stringify(values));
  }catch(error){
   snapshot.markets[market][cutoff]={status:'unavailable',date,cutoff,market,generatedAt,error:error.message||'The delayed data could not be read.'};
   console.log(market,cutoff,'unavailable:',error.message);
  }
 }
}
await writeFile('context-snapshot.json',JSON.stringify(snapshot));
if(!process.env.GITHUB_TOKEN){console.log('Saved local snapshot; GitHub publishing skipped.');process.exit(0);}

const repository=process.env.GITHUB_REPOSITORY;
if(repository!=='wanhotrading/sessionpath')throw Error('Unexpected destination repository.');
const base='https://api.github.com/repos/'+repository;
async function api(route,method='GET',body){
 const response=await fetch(base+route,{method,headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+process.env.GITHUB_TOKEN,'X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
 if(response.status===404&&method==='GET')return null;
 if(!response.ok)throw Error('GitHub snapshot publishing failed ('+response.status+').');
 return response.json();
}
const previous=await api('/git/ref/heads/live-data');
const parent=previous?.object.sha||process.env.GITHUB_SHA;
if(!/^[a-f0-9]{40}$/.test(parent||''))throw Error('No valid snapshot parent.');
const blob=await api('/git/blobs','POST',{content:JSON.stringify(snapshot),encoding:'utf-8'});
const tree=await api('/git/trees','POST',{tree:[{path:'context.json',mode:'100644',type:'blob',sha:blob.sha}]});
const commit=await api('/git/commits','POST',{message:'Refresh delayed front-month context '+generatedAt,tree:tree.sha,parents:[parent]});
if(previous)await api('/git/refs/heads/live-data','PATCH',{sha:commit.sha,force:false});
else await api('/git/refs','POST',{ref:'refs/heads/live-data',sha:commit.sha});
console.log('Published delayed-data snapshot to live-data branch.');
