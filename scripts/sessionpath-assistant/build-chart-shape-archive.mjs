import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseNativeCSV} from './build-history.mjs';
import {nyTimeToEpoch} from '../data-service/full-context/lib/context-calculations.mjs';
import {classifySessionShape} from './chart-vision.mjs';

const MARKETS_ARCHIVE = Object.freeze({CL:'data/days.json',NQ:'data/nq/days.json',ES:'es/data/es/days.json',GC:'gc/data/gc/days.json'});
const PHASES = ['NTA','ASIA','LONDON','NY'];
const TAGS = new Set(['DOWN_FINISH','DOWN_THEN_BOUNCE','DROP_RECOVERY','UP_FINISH','UP_THEN_PULLBACK','RALLY_FADE','NARROW','ORDER_UNRESOLVED']);
const JSON_FILE = new URL('chart-shape-native-nq.json', import.meta.url);
const dateNY = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0,10);

export function buildNativeNQShapeIndex(bars) {
  const index = Object.create(null), byTime = new Map(bars.map(bar => [bar.time, bar]));
  const dates = [...new Set(bars.map(bar => dateNY.format(bar.time*1000)))];
  function segment(date, begin, end, slots) {
    const start = nyTimeToEpoch(date,begin), finish = nyTimeToEpoch(date,end);
    if (finish - start !== slots * 300) return null;
    return take(start,slots);
  }
  function take(start, count) {
    const rows = Array.from({length:count},(_,i) => byTime.get(start+i*300));
    return rows.every(Boolean) ? rows : null;
  }
  function label(rows, bboxWidth) {
    if (!rows?.length) return null;
    const high=Math.max(...rows.map(r=>r.high)), low=Math.min(...rows.map(r=>r.low));
    const hi=rows.findIndex(r=>r.high===high), lo=rows.findIndex(r=>r.low===low);
    return classifySessionShape({high,low,close:rows.at(-1).close,order:hi<lo?'high_first':hi>lo?'low_first':'same_bar',bboxWidth});
  }
  for (const date of dates) {
    if ([0,6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())) continue;
    const eve=shift(date,-1), start=nyTimeToEpoch(eve,'19:30'), asia=take(start,78);
    if (!asia) continue;
    let prior=null, priorDate;
    for (let gap=1;gap<=7&&!prior;gap++) {
      priorDate=shift(date,-gap);
      prior=segment(priorDate,'09:30','16:00',78);
    }
    if (!prior) continue;
    const high=Math.max(...prior.map(r=>r.high)), low=Math.min(...prior.map(r=>r.low));
    if (!(high>low)) continue;
    const preNta=segment(priorDate,'16:00','17:00',12), postNta=segment(eve,'18:00','19:30',18);
    const rows=[preNta&&postNta?[...preNta,...postNta]:null,asia,segment(date,'03:00','08:30',66),segment(date,'09:30','16:00',78)];
    index[`NQ|NQ1!|${date}`]=[high,low,asia[0].open,...rows.map(r=>label(r,high-low))];
  }
  return index;
}

export async function buildChartShapeArchive() {
  const groups=await Promise.all(Object.entries(MARKETS_ARCHIVE).map(async ([market,path])=>[market,JSON.parse(await readFile(new URL(`../../docs/${path}`,import.meta.url),'utf8'))]));
  const index=Object.create(null);
  for (const [market,days] of groups) for (const day of days) {
    if (!Number.isFinite(day.open1930) || !Number.isFinite(day.priorHigh) || !Number.isFinite(day.priorLow) || day.priorHigh<=day.priorLow || !/^[A-Z0-9]+$/.test(day.contract) || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)) continue;
    const tags=PHASES.map(phase=>{
      const tag=day.phaseTags?.find(t=>t.startsWith(`${phase}:`))?.split(':')[1];
      return TAGS.has(tag)?tag:null;
    });
    if (tags.some(Boolean)) index[`${market}|${day.contract}|${day.date}`]=[day.priorHigh,day.priorLow,day.open1930,...tags];
  }
  const supplemental=JSON.parse(await readFile(JSON_FILE,'utf8'));
  for (const [key,row] of Object.entries(supplemental)) {
    if (!/^NQ\|NQ1!\|\d{4}-\d{2}-\d{2}$/.test(key)||!Array.isArray(row)||row.length!==7||!row.slice(0,3).every(Number.isFinite)||!(row[0]>row[1])||!row.slice(3).every(tag=>tag===null||TAGS.has(tag))) throw new Error('Invalid supplemental NQ chart-shape archive');
    index[key]=row;
  }
  return index;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  if (!process.argv[2]) throw new Error('Provide a verified native TradingView NQ1! five-minute CSV.');
  const index=buildNativeNQShapeIndex(parseNativeCSV(await readFile(process.argv[2])));
  if (!Object.keys(index).length) throw new Error('The input lacks complete NQ sessions.');
  await writeFile(JSON_FILE,JSON.stringify(index,null,2)+'\n');
  console.log(`Saved ${Object.keys(index).length} NQ shape records; no raw candles included.`);
}
