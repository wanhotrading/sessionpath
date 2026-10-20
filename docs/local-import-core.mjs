import {tagDefinitionsByInstrument} from './local-tag-definitions-by-instrument.mjs';
import {instrument} from './instrument.mjs';

const definitionsFor=market=>tagDefinitionsByInstrument[market]||[];
const tagDefinitions=definitionsFor(instrument.id);
const reportForMarket=market=>{const schema=structuredClone(reportSchema);schema.properties.tags.items.properties.id.enum=definitionsFor(market).map(t=>t.id);return schema;};

const contractPattern='(?:CL|MCL|NQ|MNQ)[FGHJKMNQUVXZ][0-9]{4}';
export function contractMatchesMarket(contract,market=instrument.id){
  return market==='CL'?/^(?:CL|MCL)[FGHJKMNQUVXZ][0-9]{4}$/.test(contract):market==='NQ'?/^(?:NQ|MNQ)[HMUZ][0-9]{4}$/.test(contract):false;
}

export const SCHEMA_VERSION = 'sessionpath.local-chart.v2';
export const LEGACY_SCHEMA_VERSION = 'sessionpath.local-chart.v1';
export const NY_SESSION_DEFINITION = 'Asia 19:30–02:00; London 03:00–08:30; New York time';
export const cutoffMinute = cutoff => ({'03:00':180,'05:00':300,'08:30':510})[cutoff];
// Frozen from the existing v8 server dictionary, never model-generated.
export const DICTIONARY_VERSION = 'sessionpath-v8-18tags-2026-10-10';
export const PROJECT_ID = 'appgprj_6abad02686b4819189b148645bc44e77';
export const BASE_FIELDS = ['price','avr','open1930','range-high','range-low','prior-high','prior-low'];
export const NY_FIELDS = ['ny-asia-high','ny-asia-low','ny-asia-close','ny-london-high','ny-london-low','ny-london-close'];
export const FIELDS = [...BASE_FIELDS,...NY_FIELDS];
const object = properties => ({type:'object', properties, required:Object.keys(properties), additionalProperties:false});
const string = {type:'string', maxLength:1600};
const nullableString = {type:['string','null'], maxLength:160};
const confidence = {type:'string',enum:['low','medium','high']};
const evidence = {...string,minLength:1};
export const reportSchema = object({
  status:{type:'string',enum:['ready_for_review','insufficient_evidence','cutoff_mismatch']},
  cutoff_verified:{type:'boolean'}, visible_date:nullableString, visible_last_time:nullableString,
  visible_timezone:nullableString, visible_contract:nullableString, summary:evidence,
  tags:{type:'array',maxItems:18,items:object({id:{type:'string',enum:tagDefinitions.map(t=>t.id)},
    assessment:{type:'string',enum:['supported','uncertain','insufficient_evidence']},
    known_at_minute:{type:['integer','null'],minimum:-480,maximum:510},evidence,confidence})},
  values:{type:'array',maxItems:13,items:object({field:{type:'string',enum:FIELDS},value:{type:'number',exclusiveMinimum:0},evidence,confidence})},
  uncertainties:{type:'array',maxItems:24,items:evidence}
});
const contextSchema = object({trading_date:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},
  cutoff:{type:'string',enum:['03:00','05:00','08:30']},timezone:{type:'string',enum:['America/New_York']},
  contract:{type:'string',pattern:'^'+contractPattern+'$'},cutoff_confirmed:{type:'boolean'}});
const recordSchema = object({
  id:{type:'string',pattern:'^[a-f0-9]{64}:[0-9-]{10}:(03:00|05:00|08:30):'+contractPattern+'$'},
  context:contextSchema,
  source:object({filename:{type:'string',minLength:1,maxLength:240},sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},
    bytes:{type:'integer',minimum:1,maximum:10485760},captured_at:nullableString}),
  analysis:object({client:{type:'string',enum:['official-codex-cli-chatgpt']},cli_version:string,created_at:string}),
  report:reportSchema
});
export const bundleSchema = object({schema_version:{type:'string',enum:[SCHEMA_VERSION]},project_id:{type:'string',enum:[PROJECT_ID]},
  dictionary_version:{type:'string',enum:[DICTIONARY_VERSION]},records:{type:'array',minItems:1,maxItems:50,items:recordSchema}});

// v1 remains frozen and importable; v2 adds a genuine 08:30 route.
export const legacyBundleSchema=structuredClone(bundleSchema);
legacyBundleSchema.properties.schema_version.enum=[LEGACY_SCHEMA_VERSION];
const legacyRecord=legacyBundleSchema.properties.records.items;
legacyRecord.properties.id.pattern=legacyRecord.properties.id.pattern.replace('|08:30','');
legacyRecord.properties.context.properties.cutoff.enum=['03:00','05:00'];
legacyRecord.properties.report.properties.tags.items.properties.known_at_minute.maximum=300;
legacyRecord.properties.report.properties.values.maxItems=7;
legacyRecord.properties.report.properties.values.items.properties.field.enum=BASE_FIELDS;

// Small validator for precisely the JSON Schema subset above, shared by CLI and browser.
export function validateSchema(value,schema,path='$') {
  const fail=message=>{throw Error(path+': '+message);};
  const types=Array.isArray(schema.type)?schema.type:[schema.type];
  const matches=t=>t==='null'?value===null:t==='array'?Array.isArray(value):t==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):t==='integer'?Number.isInteger(value):t==='number'?typeof value==='number'&&Number.isFinite(value):typeof value===t;
  if(!types.some(matches))fail('invalid type');
  if(schema.enum&&!schema.enum.some(v=>v===value))fail('unsupported value');
  if(value===null)return;
  if(typeof value==='string'){
    if(schema.minLength&&value.length<schema.minLength)fail('empty text');
    if(schema.maxLength&&value.length>schema.maxLength)fail('text too long');
    if(schema.pattern&&!new RegExp(schema.pattern).test(value))fail('invalid format');
  }
  if(typeof value==='number'){
    if(schema.minimum!==undefined&&value<schema.minimum)fail('too small');
    if(schema.exclusiveMinimum!==undefined&&value<=schema.exclusiveMinimum)fail('too small');
    if(schema.maximum!==undefined&&value>schema.maximum)fail('too large');
  }
  if(Array.isArray(value)){
    if(schema.minItems&&value.length<schema.minItems)fail('empty array');
    if(schema.maxItems&&value.length>schema.maxItems)fail('too many items');
    value.forEach((v,i)=>validateSchema(v,schema.items,path+'['+i+']'));
  } else if(typeof value==='object'){
    for(const key of schema.required||[])if(!Object.hasOwn(value,key))fail('missing '+key);
    for(const key of Object.keys(value)){
      if(!Object.hasOwn(schema.properties,key))fail('unknown property '+key);
      validateSchema(value[key],schema.properties[key],path+'.'+key);
    }
  }
}
export function validateContext(context,market=instrument.id){
  validateSchema(context,contextSchema);
  if(new Date(context.trading_date+'T00:00:00Z').toISOString().slice(0,10)!==context.trading_date)throw Error('Invalid trading date');
  if(!contractMatchesMarket(context.contract,market))throw Error(`This record is not a supported ${market} delivery contract. Switch markets before importing it.`);
  return context;
}
export function recordId(source,context){return `${source.sha256}:${context.trading_date}:${context.cutoff}:${context.contract}`;}
export function validateReport(report,context,market=instrument.id){
  validateContext(context,market);validateSchema(report,reportForMarket(market));
  const cutoff=cutoffMinute(context.cutoff);
  const actionable=report.tags.filter(t=>t.assessment==='supported');
  if(report.status!=='ready_for_review'||!report.cutoff_verified||!context.cutoff_confirmed){
    if(actionable.length||report.values.length)throw Error('Unverified cutoff cannot contain actionable observations');
    if(report.status==='ready_for_review')throw Error('Review status requires confirmed cutoff');
  } else {
    if(report.visible_date!==context.trading_date||report.visible_last_time!==context.cutoff||report.visible_timezone!=='America/New_York'||report.visible_contract!==context.contract)throw Error('Visible date, cutoff, timezone or contract does not match context');
  }
  const ids=new Set();
  for(const t of report.tags){
    if(ids.has(t.id))throw Error('Duplicate tag');ids.add(t.id);
    if(t.assessment==='supported'){
      const def=definitionsFor(market).find(d=>d.id===t.id);
      if(!Number.isInteger(t.known_at_minute)||t.known_at_minute<def.earliestMinute||t.known_at_minute>cutoff)throw Error('Tag is not known by cutoff: '+t.id);
      // These require the source numerical series, not visual impressions.
      if(t.id.startsWith('AVR75_')||t.id.startsWith('ASIA02:'))throw Error('Numerical tag requires source-data calculation: '+t.id);
    }
  }
  const groups=[['NTA_EXIT_UP','NTA_EXIT_DOWN','NTA_EXIT_BOTH','NTA_STAY_INSIDE'],['ASIA_EXIT_UP','ASIA_EXIT_DOWN','NO_ASIA_EXIT'],['LONDON_REEXIT_UP','LONDON_REEXIT_DOWN']];
  for(const group of groups)if(actionable.filter(t=>group.includes(t.id)).length>1)throw Error('Contradictory tags');
  const values=new Map();for(const v of report.values){if(context.cutoff!=='08:30'&&NY_FIELDS.includes(v.field))throw Error('NY session values require the 08:30 cutoff');if(values.has(v.field))throw Error('Duplicate numeric field');values.set(v.field,v.value);}
  for(const [h,l]of [['range-high','range-low'],['prior-high','prior-low'],['ny-asia-high','ny-asia-low'],['ny-london-high','ny-london-low']])if(values.has(h)&&values.has(l)&&values.get(h)<=values.get(l))throw Error('High must be greater than low');
  for(const session of ['asia','london']){
    const h=values.get(`ny-${session}-high`),l=values.get(`ny-${session}-low`),c=values.get(`ny-${session}-close`);
    if(c!=null&&((h!=null&&c>h)||(l!=null&&c<l)))throw Error('Session close must be within its session range');
  }
  return report;
}
export function validateBundle(bundle,market=instrument.id){
  const schema=structuredClone(bundle?.schema_version===LEGACY_SCHEMA_VERSION?legacyBundleSchema:bundleSchema);
  schema.properties.records.items.properties.report.properties.tags.items.properties.id.enum=definitionsFor(market).map(t=>t.id);
  validateSchema(bundle,schema);const ids=new Set();
  for(const r of bundle.records){
    validateReport(r.report,r.context,market);
    if(r.id!==recordId(r.source,r.context))throw Error('Record identity does not match provenance');
    if(ids.has(r.id))throw Error('Duplicate screenshot/context record');ids.add(r.id);
    if(/[\\/]/.test(r.source.filename))throw Error('Source must contain a filename, not a local path');
  }
  return bundle;
}
export function selectable(record){
  if(record.report.status!=='ready_for_review')return [];
  return [...record.report.tags.filter(t=>t.assessment==='supported').map(t=>({kind:'tag',value:t.id,evidence:t.evidence,confidence:t.confidence})),
    ...record.report.values.map(v=>({kind:'value',value:v.field+'='+v.value,evidence:v.evidence,confidence:v.confidence}))];
}
export function makeReview(record,keys,{confirmed=false,reviewer='',note=''}={}){
  validateReport(record.report,record.context);
  if(!confirmed||!reviewer.trim())throw Error('Confirm the source/cutoff and enter a reviewer name');
  const available=selectable(record),selected=available.filter(x=>keys.includes(x.kind+':'+x.value));
  if(!selected.length||selected.length!==new Set(keys).size)throw Error('Select valid observations to approve');
  return {schema_version:'sessionpath.review.v1',record_id:record.id,source:record.source,context:record.context,
    reviewed_at:new Date().toISOString(),reviewer:reviewer.trim().slice(0,100),note:note.slice(0,1000),selected,original_report:record.report};
}
export function appendReview(existing,review){
  if(existing.some(r=>r.record_id===review.record_id))throw Error('This screenshot/context was already approved; original review retained');
  if(existing.length>=500)throw Error('Export reviews before adding more; local limit 500');
  return [...existing,review];
}

// Conversion uses explicit reviewed prices, never chart pixels or model-invented quartiles.
export function nyInputsFromReview(review,{basis='own',wide=true}={}){
  if(review.context.cutoff!=='08:30')throw Error('NY import requires an 08:30 screenshot; it is not a 05:00 forecast');
  if(!['own','bbox'].includes(basis))throw Error('Select a supported NY position reference');
  const values=Object.fromEntries(review.selected.filter(x=>x.kind==='value').map(x=>{const [key,value]=x.value.split('=');return [key,Number(value)];}));
  const required=['price','avr',...NY_FIELDS,...(basis==='bbox'?['prior-high','prior-low']:[])];
  if(required.some(k=>!Number.isFinite(values[k])||values[k]<=0))throw Error('NY needs reviewed 08:30 open, 10-day AVR, and both completed sessions’ high, low and close; BBOX reference also needs prior NY high/low. Missing values cannot be estimated from pixels.');
  const position=session=>{
    const high=values[`ny-${session}-high`],low=values[`ny-${session}-low`],close=values[`ny-${session}-close`];
    if(high<=low||close<low||close>high)throw Error('Invalid completed session range');
    const top=basis==='own'?high:values['prior-high'],bottom=basis==='own'?low:values['prior-low'];
    if(top<=bottom)throw Error('Invalid prior BBOX range');
    const p=(close-bottom)/(top-bottom);
    if(p<0)return ['BELOW'];if(p>1)return ['ABOVE'];
    const q=p<.25?'Q1':p<.5?'Q2':p<.75?'Q3':'Q4';
    if(wide)for(const [i,b] of [.25,.5,.75].entries())if(Math.abs(p-b)<=.05+1e-10)return [`Q${i+1}`,`Q${i+2}`];
    return [q];
  };
  return {price:values.price,avr:values.avr,asia:position('asia'),london:position('london'),basis,wide,sessionDefinition:NY_SESSION_DEFINITION};
}
