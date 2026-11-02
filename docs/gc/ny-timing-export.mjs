// Transport only the chosen method/fit. Statistics remain unchanged descriptive references.
import {NY_TIMING_METHODS,NY_TIMING_FITS,NY_TIMING_LEVELS} from './ny-timing-reference.mjs';
export const NY_TIMING_MARKETS=Object.freeze(['CL','NQ','ES','GC']);
export const NY_TIMING_METHOD_TOKENS=Object.freeze(['OE','OW','PE','PW']);
const TARGETS=Object.freeze([120,130,140,150,175,200]);
const MAX_INTEGER=1000000000;
const integer=text=>{
 if(!/^-?(?:0|[1-9]\d*)$/.test(text))throw Error('Invalid NY timing integer.');
 const n=Number(text);if(!Number.isSafeInteger(n)||Math.abs(n)>MAX_INTEGER||String(n)!==text)throw Error('Invalid NY timing integer.');
 return n;
};
function validateRow(row,feature){
 if(row.length!==19||row.some(n=>!Number.isSafeInteger(n)||Math.abs(n)>MAX_INTEGER))throw Error('Invalid NY timing row.');
 const [key,n,inside,same,later,p50,p75]=row;
 if(key<0||key>63||n<=0||inside<0||same<0||inside+same>n||later<0||later>n)throw Error('Invalid NY timing counts.');
 if(later===0?(p50!==-1||p75!==-1):(p50<0||p75<p50))throw Error('Invalid NY timing later-path quantiles.');
 let previousN=0;
 for(let i=0;i<6;i++){
  const k=row[7+2*i],denominator=row[8+2*i];
  if(k<0||denominator<0||k>denominator||denominator>later||denominator<previousN)throw Error('Invalid NY timing pending counts.');
  previousN=denominator;
 }
 if(feature==='timing'&&key%16===15&&(later!==0||row.slice(7).some(n=>n!==0)))throw Error('Invalid NY timing terminal row.');
 if(feature==='strength'&&Math.floor(key/16)%2===0&&key%16!==0)throw Error('Invalid NY timing wick-only strength.');
 return row;
}
function decodeBlock(text,feature){
 const parts=text.split('!');if(parts.length!==2)throw Error('Invalid NY timing row header.');
 const n=integer(parts[0]);if(n<0||n>64)throw Error('Invalid NY timing row count.');
 const rows=parts[1]===''?[]:parts[1].split(';').map(value=>validateRow(value.split(',').map(integer),feature));
 if(rows.length!==n||rows.some((row,i)=>i>0&&row[0]<=rows[i-1][0]))throw Error('NY timing rows are truncated, duplicated or unordered.');
 return rows;
}
function encodeBlock(rows,feature){
 const text=rows.length+'!'+rows.map(row=>validateRow(row,feature).join(',')).join(';');
 decodeBlock(text,feature);return text;
}
export function parseNYTimingExportToken(value,expected={}){
 const token=String(value);if(token.length>12000)throw Error('NY timing metadata is too large.');
 const a=token.split(':');
 if(a.length!==8||a[0]!=='NYT1'||a[1]!=='2'||!['1','50'].includes(a[2])||!TARGETS.includes(Number(a[3]))||String(Number(a[3]))!==a[3]||!NY_TIMING_MARKETS.includes(a[4])||!NY_TIMING_METHOD_TOKENS.includes(a[5]))throw Error('Invalid NY timing v2 metadata.');
 const result={version:2,minFit:Number(a[2]),target:Number(a[3])/100,market:a[4],method:NY_TIMING_METHODS[NY_TIMING_METHOD_TOKENS.indexOf(a[5])],methodToken:a[5],timing:decodeBlock(a[6],'timing'),strength:decodeBlock(a[7],'strength')};
 for(const key of ['market','method','minFit'])if(expected[key]!=null&&expected[key]!==result[key])throw Error('NY timing metadata does not match '+key+'.');
 return result;
}
export function makeNYTimingExportToken(payload,{method,minFit=50,target=1.5}={}){
 if(!payload||payload.version!==1||payload.eventKind!=='WICK_FIRST'||!NY_TIMING_MARKETS.includes(payload.market))throw Error('Historical NY timing data is unavailable.');
 const m=NY_TIMING_METHODS.indexOf(method),f=NY_TIMING_FITS.indexOf(minFit),t=NY_TIMING_LEVELS.indexOf(target);
 if(m<0||f<0||t<0||payload.methods?.[m]!==method||payload.fits?.[f]!==minFit)throw Error('Choose a matching named NY method, fit threshold and target.');
 const group=m*2+f;
 const blocks=['timing','strength'].map(feature=>{
  if(!Array.isArray(payload[feature]))throw Error('Historical NY timing rows are unavailable.');
  const rows=payload[feature].filter(row=>Math.floor(row[0]/64)===group).map(row=>[row[0]%64,...row.slice(1)]);
  return encodeBlock(rows,feature);
 });
 const token=['NYT1',2,minFit,TARGETS[t],payload.market,NY_TIMING_METHOD_TOKENS[m],...blocks].join(':');
 parseNYTimingExportToken(token,{market:payload.market,method,minFit});return token;
}
