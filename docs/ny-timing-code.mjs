// Only the selected method/fit travels with the code; Pine does not embed every research table.
import {makeNYTimingExportToken,parseNYTimingExportToken} from './ny-timing-export.mjs';
export const NY_TIMING_LEVELS = Object.freeze([120,130,140,150,175,200]);
export function parseNYTimingToken(value,expected={}){
 const text=String(value);
 if(!text.startsWith('NYT1:'))return null;
 const fields=text.split(':');
 if(fields[1]==='2')return parseNYTimingExportToken(text,expected);
 if(fields.length!==4||fields[0]!=='NYT1'||fields[1]!=='1'||!['1','50'].includes(fields[2])||!NY_TIMING_LEVELS.includes(Number(fields[3]))||String(Number(fields[3]))!==fields[3])throw Error('Invalid NY timing metadata.');
 return {version:1,minFit:Number(fields[2]),target:Number(fields[3])/100};
}
export function makeNYTimingToken({payload,method,minFit=50,target=1.5}={}){
 return makeNYTimingExportToken(payload,{method,minFit,target});
}
export function appendNYTimingMetadata(code,settings={}){
 const fields=String(code).trim().split('|'),timing=fields.filter(x=>x.startsWith('NYT1:'));
 if(timing.length>1)throw Error('Duplicate NY timing metadata.');
 for(const x of timing)parseNYTimingToken(x);
 const clean=fields.filter(x=>!x.startsWith('NYT1:'));
 if(!settings.enabled)return clean.join('|');
 const methods=clean.filter(x=>x.startsWith('NY1:'));
 if(methods.length!==1||!['NY1:OE','NY1:OW','NY1:PE','NY1:PW'].includes(methods[0]))return clean.join('|');
 if(!settings.referenceToken)return clean.join('|');
 const reference=parseNYTimingToken(settings.referenceToken,{market:settings.market});
 if(reference.version!==2||reference.methodToken!==methods[0].slice(4)||reference.minFit!==settings.minFit||reference.target!==settings.target)throw Error('Timing reference does not match the current NY forecast settings.');
 return [...clean,settings.referenceToken].join('|');
}
