import {quantile,mean,deriveRows,selectMatches,clockLabel,wilson} from './window-engine.mjs';

export const sessions=[
 {id:'NTA',name:'NTA · NY to Asia',time:'Prior NY 16:00–19:29*',end:-270},
 {id:'ASIA',name:'Asia',time:'19:30–01:59 next day',end:120},
 {id:'LONDON',name:'London',time:'03:00–08:29',end:510},
 {id:'NY',name:'New York',time:'09:30–15:59',end:960},
];
export const shapes=[
 ['DOWN_FINISH','Down finish'],['DOWN_THEN_BOUNCE','Down then bounce'],['DROP_RECOVERY','Trend down, then recover'],
 ['UP_FINISH','Up finish'],['UP_THEN_PULLBACK','Up then pullback'],['RALLY_FADE','Trend up, then fade'],
 ['NARROW','Narrow range'],['ORDER_UNRESOLVED','Order unresolved'],
];
export const shapeName=id=>shapes.find(s=>s[0]===id)?.[1]||id;
export function enrichResearch(days,tags,extra){
 const added=[];
 for(const [id,label] of [['NTA_EXIT_UP','Up only'],['NTA_EXIT_DOWN','Down only'],['NTA_EXIT_BOTH','Both sides'],['NTA_STAY_INSIDE','Stayed inside']])added.push({id,label,group:'NTA · prior 16:00–19:29',definition:`${label} relative to the prior NY BBOX. Any wick outside counts. ${extra.ntaDefinition}`,earliestMinute:-270,knownWhen:'19:30 anchor'});
 for(let m=570;m<960;m+=30)added.push({id:`GAP_30_${m}`,label:`${clockLabel(m)}–${clockLabel(m+29)}`,group:'Gap fill · 30-minute buckets',definition:`First gap-edge touch in a bar opening between ${clockLabel(m)} and ${clockLabel(m+30)} (end excluded). Confirmed only when that five-minute bar closes.`,earliestMinute:m+5,knownWhen:'Actual first-fill bar close'});
 added.push({id:'GAP_NOT_FILLED',label:'Not filled by 16:00',group:'Gap fill · 30-minute buckets',definition:'Opening gap remained unfilled through the complete NY session.',earliestMinute:960,knownWhen:'16:00'});
 const enhanced=days.map(d=>{
  const e=extra.days[d.index],tags=[...d.tags],knownTags=[...d.knownTags];
  if(e?.ntaTag){tags.push(e.ntaTag);knownTags.push({tag:e.ntaTag,minute:-270});}
  if(Number.isFinite(d.events?.gapFill)){const id=`GAP_30_${Math.floor(d.events.gapFill/30)*30}`;tags.push(id);knownTags.push({tag:id,minute:d.events.gapFill+5});}
  else if(e?.phaseComplete.NY&&d.tags.some(t=>t==='GAP_UG'||t==='GAP_DG')){tags.push('GAP_NOT_FILLED');knownTags.push({tag:'GAP_NOT_FILLED',minute:960});}
  return {...d,tags,knownTags,phaseComplete:e?.phaseComplete||{},nta:e};
 });
 const filtered=tags.filter(t=>!['Session shape','Data quality','Gap fill'].includes(t.group));
 const order=g=>g.startsWith('NTA')?0:g==='Asia'?1:g==='AVR'?2:g.startsWith('Gap fill')?8:4;
 return {days:enhanced,tags:[...filtered,...added].sort((a,b)=>order(a.group)-order(b.group)||a.group.localeCompare(b.group))};
}
export function sessionProbabilities(days,chosen={},year=''){
 const previous=[];
 return sessions.map(s=>{
  const eligible=days.filter(d=>(!year||String(d.year)===String(year))&&d.phaseComplete?.[s.id]&&previous.every(p=>d.phaseComplete?.[p.id]&&d.phaseTags.includes(`${p.id}:${p.value}`)));
  const measured=eligible.filter(d=>shapes.some(([id])=>d.phaseTags.includes(`${s.id}:${id}`)));
  const bins=shapes.map(([id,label])=>{const count=measured.filter(d=>d.phaseTags.includes(`${s.id}:${id}`)).length;return {id,label,count,p:measured.length?count/measured.length:null};});
  const result={session:s,n:measured.length,bins,conditions:[...previous]};
  if(chosen[s.id])previous.push({id:s.id,value:chosen[s.id]});
  return result;
 });
}
export function boxEstimate(days,timeline,query,endMinute,preparedRows=null){
 if(endMinute<=query.minute)return null;
 const selection=selectMatches(days,preparedRows??deriveRows(days,timeline,query.minute,endMinute),query);
 const matches=selection.matches;if(!matches.length)return null;
 const up=mean(matches.map(m=>m.row.nextHighAvr)),down=mean(matches.map(m=>-m.row.nextLowAvr));
 const inside=matches.filter(m=>m.row.nextHighAvr<=up+1e-9&&-m.row.nextLowAvr<=down+1e-9).length;
 const touchUp=matches.filter(m=>m.row.nextHighAvr>=up-1e-9).length,touchDown=matches.filter(m=>-m.row.nextLowAvr>=down-1e-9).length;
 const upValues=matches.map(m=>m.row.nextHighAvr),downValues=matches.map(m=>-m.row.nextLowAvr);
 // Each observation contributes, including zero extra range. The original
 // cutoff high/low is read by deriveRows before any outcome candle is inspected.
 const extensionUpAvr=mean(matches.map(m=>m.row.extensionUpAvr)),extensionDownAvr=mean(matches.map(m=>m.row.extensionDownAvr));
 return {extensionUpAvr,extensionDownAvr,extensionUpPoints:query.avr>0?extensionUpAvr*query.avr:null,extensionDownPoints:query.avr>0?extensionDownAvr*query.avr:null,upMaxPoints:query.avr>0?Math.max(...upValues)*query.avr:null,downMaxPoints:query.avr>0?Math.max(...downValues)*query.avr:null,upMedianPoints:query.avr>0?quantile(upValues,.5)*query.avr:null,downMedianPoints:query.avr>0?quantile(downValues,.5)*query.avr:null,n:matches.length,up,down,upPoints:query.avr>0?up*query.avr:null,downPoints:query.avr>0?down*query.avr:null,inside,coverage:inside/matches.length,interval:wilson(inside,matches.length),touchUp:touchUp/matches.length,touchDown:touchDown/matches.length,minute:query.minute,endMinute,dates:matches.map(m=>m.day.date)};
}
export function nyTimestamp(date,minute){
 const desired=Date.parse(date+'T00:00:00Z')+minute*60000;
 const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 let guess=desired+5*3600000;
 for(let i=0;i<3;i++){const p=Object.fromEntries(formatter.formatToParts(guess).map(x=>[x.type,x.value]));const local=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);guess+=desired-local;}
 return guess;
}
export function makePine(box,q){
 if(!box||!Number.isFinite(q.price)||!(q.avr>0))throw new Error('Enter current price and a positive AVR before exporting.');
 const begin=nyTimestamp(q.date,q.minute),end=nyTimestamp(q.date,box.endMinute);
 const f=v=>Number(v).toFixed(6),pc=v=>(100*v).toFixed(1)+'%';
 const safe=s=>JSON.stringify(String(s));
 const text=`Average U +${box.upPoints.toFixed(2)} / D -${box.downPoints.toFixed(2)} pt\nHistorical containment ${pc(box.coverage)} (${box.inside}/${box.n})\n${clockLabel(q.minute)}-${clockLabel(box.endMinute)} New York | fixed research snapshot`;
 return `//@version=6
// Session Path: export from the 2022-01-03 to 2026-09-25 explicit-contract CL archive.
// Observed range and numeric matching always start at the previous-evening 19:30 anchor.
// Tags: ${(q.tags||[]).join(', ')||'none'}; ${q.observations?.length||0} earlier checkpoints.
// Historical containment = BOTH extremes stayed inside this sample's mean U/D box.
// In-sample descriptive frequency, not validated probability or a trade win rate.
// Fixed date, time, price and sample. Re-export from the site when conditions change.
// Official drawing reference: https://www.tradingview.com/pine-script-docs/visuals/lines-and-boxes/
indicator("Session Path - matched U/D box", overlay = true, max_boxes_count = 2, max_lines_count = 1, max_labels_count = 1)
if not timeframe.isminutes or timeframe.multiplier != 5
    runtime.error("Use a standard 5-minute candlestick chart. A 60-minute box spans 12 candles.")
if syminfo.root != "CL" and syminfo.root != "MCL"
    runtime.error("This export uses CL research. Apply it to a CL or MCL futures chart.")
int anchorTime = ${begin}
int finishTime = ${end}
float anchorPrice = ${f(q.price)}
float upside = ${f(box.upPoints)}
float downside = ${f(box.downPoints)}
var box upperBox = na
var box lowerBox = na
var line anchorLine = na
var label info = na
if barstate.islast
    box.delete(upperBox)
    box.delete(lowerBox)
    line.delete(anchorLine)
    label.delete(info)
    upperBox := box.new(left = anchorTime, top = anchorPrice + upside, right = finishTime, bottom = anchorPrice, xloc = xloc.bar_time, border_color = color.teal, bgcolor = color.new(color.teal, 85))
    lowerBox := box.new(left = anchorTime, top = anchorPrice, right = finishTime, bottom = anchorPrice - downside, xloc = xloc.bar_time, border_color = color.maroon, bgcolor = color.new(color.red, 88))
    anchorLine := line.new(x1 = anchorTime, y1 = anchorPrice, x2 = finishTime, y2 = anchorPrice, xloc = xloc.bar_time, color = color.silver, style = line.style_dashed)
    info := label.new(x = anchorTime, y = anchorPrice + upside, text = ${safe(text)}, xloc = xloc.bar_time, style = label.style_label_down, color = color.new(color.navy, 10), textcolor = color.white, size = size.small)
var table legend = table.new(position.top_right, 1, 3)
if barstate.islast
    table.cell(legend, 0, 0, ${safe('Session Path | '+q.date+' | '+clockLabel(q.minute)+' NY')}, text_color = color.white, bgcolor = color.navy)
    table.cell(legend, 0, 1, ${safe('U touch '+pc(box.touchUp)+' | D touch '+pc(box.touchDown)+' | n='+box.n)}, text_color = color.white, bgcolor = color.navy)
    table.cell(legend, 0, 2, "Fixed snapshot - re-export after changing conditions", text_color = color.yellow, bgcolor = color.navy)
`;
}
