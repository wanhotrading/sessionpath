export const windows = [
  {label:'18:00–19:30', name:'Evening reopen', start:0,end:18},
  {label:'19:30–03:00', name:'Overnight', start:18,end:108},
  {label:'03:00–05:00', name:'Early London', start:108,end:132},
  {label:'05:00–08:30', name:'Late London', start:132,end:174}
];
export const lastStep = 174;
const encoding = {none:0,upper:1,lower:2,both:3};
const pathStage = {'no-return':1, 'returned-no-repeat':2, 'returned-repeat':3};
const pending = (step, hit) => hit<0 || hit>step;

export function time(step) {
  const min = (1080+step*5)%1440;
  return String(Math.floor(min/60)).padStart(2,'0')+':'+String(min%60).padStart(2,'0');
}

export function currentNYStep(clock) {
  const weekday = new Date(clock.date+'T00:00:00Z').getUTCDay();
  const evening = clock.minute>=1080;
  if (evening ? weekday>=5 : weekday===0 || weekday===6) return null;
  return Math.floor((clock.minute+(evening?-1080:360))/5);
}

export function currentNYSession(clock) {
  if (currentNYStep(clock)===null) return null;
  const date = Date.parse(clock.date+'T00:00:00Z');
  return new Date(date+(clock.minute>=1080?86400000:0)).toISOString().slice(0,10);
}

export function validateStudy(data, market) {
  const distance = val => typeof val==='string' && /^[012]{175}$/.test(val);
  const event = value => Number.isInteger(value)&&value>=-1&&value<=lastStep;
  const series = (value,min,max) => Array.isArray(value)&&value.length===4&&value.every(v=>Number.isInteger(v)&&v>=min&&v<=max);
  const outcome = value => Array.isArray(value)&&value.length===2&&event(value[0])&&distance(value[1]);
  const evening = value => value===null||(Array.isArray(value)&&value.length===3&&value[0]>=1&&value[0]<=18&&Number.isInteger(value[0])&&outcome(value[1])&&outcome(value[2]));
  const path = value => Array.isArray(value) && value.length===2 && series(value[0],0,3) &&
    Number.isInteger(value[1]) && value[1]>=0 && value[1]<=15;
  if (data?.version!==2 || data.market!==market || !Array.isArray(data.dateRange) || data.dateRange.length!==2 ||
      !Array.isArray(data.rows) || !data.rows.length || !data.rows.every(r=>Array.isArray(r)&&r.length===9&&
      series(r[0],0,2)&&series(r[1],0,3)&&series(r[2],-1,lastStep)&&series(r[3],-1,lastStep)&&
      distance(r[4])&&distance(r[5])&&Array.isArray(r[6])&&r[6].length===2&&r[6].every(evening)&&
      Array.isArray(r[7])&&r[7].length===2&&r[7].every(path)&&distance(r[8]))) {
    throw Error('Historical study data could not be verified.');
  }
  return data;
}

const archives = new Map();
export function loadTimingArchive(market) {
  if (!['CL','NQ','ES'].includes(market)) return Promise.reject(Error('This market has no overnight timing study.'));
  if (!archives.has(market)) {
    const request = (async () => {
      if (typeof DecompressionStream !== 'function') throw Error('Use a current browser to load the overnight archive.');
      const response = await fetch(new URL('./'+market.toLowerCase()+'-v2.bin',import.meta.url),{signal:AbortSignal.timeout(15000)});
      if (!response.ok || !response.body) throw Error('The overnight archive is unavailable.');
      const decoded = new Response(response.body.pipeThrough(new DecompressionStream('gzip')));
      return validateStudy(await decoded.json(),market);
    })().catch(error=>{ archives.delete(market);throw error; });
    archives.set(market,request);
  }
  return archives.get(market);
}

function matches(history, pattern) {
  if (pattern==='any') return true;
  if (pattern==='breach') return history!==0;
  if (pattern==='upper-hit') return Boolean(history&1);
  if (pattern==='lower-hit') return Boolean(history&2);
  return history===encoding[pattern];
}

const earliest = (a,b) => a===-1?b:b===-1?a:Math.min(a,b);

export function prepareScenario(data, options) {
  if (options.mode==='evening') {
    const side = options.edge==='lower'?1:0;
    const first = options.anchor==='first';
    const exactSignal = /^bar-(?:[1-9]|1[0-8])$/.test(options.signalBar) ? Number(options.signalBar.slice(4)) : null;
    const paths = data.rows.flatMap(r=>{
      const observation = r[6][side];
      if (!observation) return [];
      if (options.eveningOpen==='inside' && r[0][0]!==0) return [];
      if (options.eveningOpen==='past-edge' && r[0][0]!==side+1) return [];
      if (options.eveningOpen==='opposite' && r[0][0]!==2-side) return [];
      if (options.signalBar==='first'&&observation[0]!==1) return [];
      if (options.signalBar==='later'&&observation[0]===1) return [];
      if (exactSignal!==null&&observation[0]!==exactSignal) return [];
      const [hit,distance] = observation[first?1:2];
      const start = first?observation[0]:18;
      return [{start,hit,distance:step=>Number(distance[step])}];
    });
    return {start:first?(exactSignal ?? (options.signalBar==='later'?2:1)):18,end:lastStep,paths};
  }
  const {window:index, startPosition, history, pattern, edge} = options;
  const {start,end}=windows[index];
  const paths=data.rows.flatMap(r=>{
    const [open,flags,upper,lower,uDistances,dDistances,,edgePaths,closePositions]=r;
    if (startPosition!=='any'&&open[index]!==Number(startPosition)) return [];
    const earlier = flags.slice(0,index);
    if (index&&history==='none'&&earlier.some(Boolean)) return [];
    if (index&&history==='breach'&&!earlier.some(Boolean)) return [];
    if (history==='custom'&&!earlier.every((value,j)=>matches(value,pattern[j]??'any'))) return [];
    if (index && Object.hasOwn(pathStage,options.priorPath)) {
      const [stages,repeats] = edgePaths[options.traceEdge==='lower'?1:0];
      if (stages[index-1]!==pathStage[options.priorPath]) return [];
      const required=options.repeatWindow;
      if (options.priorPath==='returned-repeat' && Number.isInteger(required) &&
          (required<0 || required>=index || !(repeats & (1<<required)))) return [];
    }
    const u=upper[index], d=lower[index];
    const hit=edge==='upper'?u:edge==='lower'?d:edge==='both'?u===-1||d===-1?-1:Math.max(u,d):earliest(u,d);
    const progress=step=>Number(!pending(step,u))+2*Number(!pending(step,d));
    const distance=step=>{
      if (edge==='upper') return Number(uDistances[step]);
      if (edge==='lower') return Number(dDistances[step]);
      const visited=progress(step);
      if (visited===1) return Number(dDistances[step]);
      if (visited===2) return Number(uDistances[step]);
      return Math.min(Number(uDistances[step]),Number(dDistances[step]));
    };
    const position=step=>step===start?open[index]:Number(closePositions[step]);
    return [{start,hit,distance,progress,position}];
  });
  return {start,end,paths};
}

function estimate(k,n) {
  if (!n) return {k,n,p:null,lo:null,hi:null};
  const p=k/n,z=1.95996398454,denom=1+z*z/n;
  const mid=(p+z*z/(2*n))/denom, width=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/denom;
  return {k,n,p,lo:Math.max(0,mid-width),hi:Math.min(1,mid+width)};
}

export function remaining(scenario, step, {distance='any',progress='any',position='any'}={}) {
  let n=0,k=0;
  for (const path of scenario.paths) {
    if (path.start>step || !pending(step,path.hit)) continue;
    if (distance!=='any' && path.distance(step)!==Number(distance)) continue;
    if (progress!=='any' && path.progress?.(step)!==Number(progress)) continue;
    if (position!=='any' && path.position?.(step)!==Number(position)) continue;
    n++;
    if (path.hit!==-1 && path.hit<=scenario.end) k++;
  }
  return estimate(k,n);
}

export function fromAnchor(scenario) {
  return estimate(scenario.paths.filter(path=>path.hit>=0&&path.hit<=scenario.end).length,scenario.paths.length);
}

export function curve(scenario, filters) {
  return Array.from({length:scenario.end-scenario.start+1},(_,i)=>{
    const step=scenario.start+i;
    return {step,...remaining(scenario,step,filters)};
  });
}
