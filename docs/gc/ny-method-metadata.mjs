// A named NY reference is provenance, never a guess from the selected quarters.
export const NY_METHOD_TOKENS=Object.freeze({'Own Exact':'OE','Own Wide':'OW','Prior Exact':'PE','Prior Wide':'PW','Custom':'CUSTOM'});
const TOKEN_METHODS=Object.freeze(Object.fromEntries(Object.entries(NY_METHOD_TOKENS).map(([name,token])=>[token,name])));
export function nyMethodToken(method){
 const token=NY_METHOD_TOKENS[method];
 if(!token)throw Error('Invalid NY research method.');
 return 'NY1:'+token;
}
export function parseNYMethodToken(token){
 if(!/^NY1:/.test(String(token)))return null;
 const method=TOKEN_METHODS[String(token).slice(4)];
 if(!method)throw Error('Invalid NY research method metadata.');
 return method;
}
const sameSet=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&[...a].sort().every((v,i)=>v===[...b].sort()[i]);
export function nyResearchMethod({basis,mode,appliedPosition,filters={},endMinute=960}={}){
 // Published NY extension tables cover full NY, without extra year/shape slices.
 if(endMinute!==960||filters.year||filters.asiaShape||filters.londonShape)return 'Custom';
 if(!['own','bbox'].includes(basis)||!['exact','wide'].includes(mode)||!appliedPosition)return 'Custom';
 const method=(basis==='own'?'Own':'Prior')+' '+(mode==='exact'?'Exact':'Wide');
 if(appliedPosition.basis!==basis||appliedPosition.mode!==mode||appliedPosition.method!==method)return 'Custom';
 if(!['asia','london'].every(session=>filters[session]?.length&&sameSet(filters[session],appliedPosition[session])))return 'Custom';
 return method;
}
