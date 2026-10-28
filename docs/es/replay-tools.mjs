import {archiveInputs,parseSnapshot,runReplay,replaySummary,csv} from './replay-engine.mjs';
import {clockMinute} from './window-engine.mjs';
import {instrument} from './instrument.mjs';
const $=id=>document.getElementById(id);
export function mountReplayTools(state,apply) {
  const button=document.createElement('button');button.type='button';button.className='text-button';button.id='replay-tools';button.textContent='Replay tools';document.querySelector('.replay-picker').append(button);
  const dialog=document.createElement('dialog');dialog.id='replay-tools-dialog';
  dialog.innerHTML=`<div class="dialog-head"><h2>Replay tools</h2><button id="replay-close" aria-label="Close replay tools">×</button></div>
    <p class="compact-note">Load prices without revealing the later outcome. Use the archive’s displayed delivery contract.</p>
    <div class="fields"><label>Trading date<input id="load-date" type="date"></label><label>Snapshot<select id="load-time"><option value="03:00">03:00 → 05:00</option><option value="05:00">05:00 → 08:30</option><option value="08:30">08:30 · NY outlook</option></select></label></div>
    <label class="inline-check"><input id="load-behavior" type="checkbox"> Include the existing last-hour behavior rule</label>
    <div class="button-row"><button id="load-prev" class="quiet">← Day</button><button id="load-archive" class="primary">Fill from archive</button><button id="load-next" class="quiet">Day →</button></div>
    <p id="load-status" class="compact-note" role="status"></p>
    <details class="session-note"><summary>Back up your saved snapshots</summary><p class="compact-note">Use Save snapshot before revealing the outcome. New snapshots include the forecast, selected tags and matching dates. Up to 5,000 are kept in this browser. Saving the same date/time replaces that snapshot; export before revising it.</p><button id="export-snapshots" class="quiet">Export saved snapshots · JSON</button></details>
    <details class="session-note"><summary>Paste a TradingView snapshot</summary><p class="compact-note">Enable “Write snapshot to Pine Logs” in the ${instrument.id} indicator. Copy its ${instrument.snapshotPrefix} line here. Numeric prices transfer together; tags still need your review.</p><label>Snapshot line<textarea id="snapshot-paste" rows="3" spellcheck="false" placeholder="${instrument.snapshotPrefix}|2026-10-09|03:00|…"></textarea></label><button id="apply-snapshot" class="quiet">Apply snapshot</button></details>
    <details class="session-note"><summary>Batch forecast accuracy · CSV</summary><p class="compact-note">Both overnight windows. Five numeric inputs and prior-BBOX location, matching archive autofill; optional existing behavior rule. No tags, earlier checkpoints or trade entries. Every forecast uses earlier dates only. These archive results are research, not an untouched forward test.</p>
    <div class="fields"><label>From<input id="test-from" type="date"></label><label>Through<input id="test-to" type="date"></label><label>Closest cases<select id="test-cases"><option>20</option><option selected>50</option><option>100</option><option>200</option><option>ALL</option></select></label></div>
    <label class="inline-check"><input id="test-behavior" type="checkbox"> Match last-hour behavior too</label>
    <p class="compact-note">Baseline: all earlier complete cases at the same clock. At least 50 matches required (20 when choosing 20). Error = forecast minus actual. No strategy win rate is calculated.</p>
    <div class="button-row"><button id="run-batch" class="primary">Run chronological test</button><button id="export-batch" class="quiet" disabled>Export CSV</button></div><p id="batch-status" class="compact-note" role="status"></p><div id="batch-results"></div></details>`;
  document.body.append(dialog);$('replay-close').onclick=()=>dialog.close();
  $('export-snapshots').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),snapshots:state.checkpoints},null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='SessionPath-saved-snapshots.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const dates=[...new Set(state.days.filter(d=>d.avr>0).map(d=>d.date))].sort();
  $('test-from').value=dates[0];$('test-to').value=dates.at(-1);
  button.onclick=()=>{$('load-date').value=$('replay-toggle').checked?$('trading-date').value:dates.at(-1);$('load-time').value=$('asof').value;dialog.showModal();};
  const status=(text,error=false)=>{$('load-status').textContent=text;$('load-status').classList.toggle('error',error);};
  const use=data=>{apply(data,{includeBehavior:$('load-behavior').checked});status(`${data.contract} · ${data.date} ${String(Math.floor(data.minute/60)).padStart(2,'0')}:${String(data.minute%60).padStart(2,'0')} loaded. Prices filled; previous tags and checkpoints are not carried into this snapshot.`);};
  const load=()=>{try{use(archiveInputs(state.days,state.timeline,$('load-date').value,clockMinute($('load-time').value)));}catch(e){status(e.message,true);}};
  $('load-archive').onclick=load;
  const move=direction=>{const date=$('load-date').value,next=direction>0?dates.find(d=>d>date):dates.findLast(d=>d<date);if(next){$('load-date').value=next;load();}else status('End of the available archive.');};
  $('load-prev').onclick=()=>move(-1);$('load-next').onclick=()=>move(1);
  $('apply-snapshot').onclick=()=>{try{const data=parseSnapshot($('snapshot-paste').value);$('load-date').value=data.date;$('load-time').value=String(Math.floor(data.minute/60)).padStart(2,'0')+':'+String(data.minute%60).padStart(2,'0');use(data);}catch(e){status(e.message,true);}};
  let result=[];
  $('run-batch').onclick=async()=>{
    const controls=['run-batch','export-batch','test-from','test-to','test-cases','test-behavior'];controls.forEach(id=>$(id).disabled=true);result=[];$('batch-results').replaceChildren();
    const options={from:$('test-from').value,to:$('test-to').value,limit:$('test-cases').value,minCases:$('test-cases').value==='20'?20:50,includeBehavior:$('test-behavior').checked,onProgress:(n,total)=>{$('batch-status').textContent=`Scoring ${n} / ${total} dates…`;}};
    try{result=await runReplay(state.days,state.timeline,options);const scored=result.filter(r=>r.status==='scored').length;$('batch-status').textContent=`${scored} windows scored; ${result.length-scored} skipped. Smaller average absolute error is better. Skipped reasons are included in the CSV.`;
      const f=x=>Number.isFinite(x)?x.toFixed(3):'—';
      $('batch-results').innerHTML='<div class="table-wrap"><table><thead><tr><th>Window</th><th>n</th><th>Model U / D error · pt</th><th>Baseline U / D error · pt</th></tr></thead><tbody>'+replaySummary(result).map(s=>`<tr><td>${s.window}</td><td>${s.n}</td><td>${f(s.upMAE)} / ${f(s.downMAE)}</td><td>${f(s.baselineUpMAE)} / ${f(s.baselineDownMAE)}</td></tr>`).join('')+'</tbody></table></div>';
    }catch(e){$('batch-status').textContent=e.message;}finally{controls.filter(id=>id!=='export-batch').forEach(id=>$(id).disabled=false);$('export-batch').disabled=!result.length;}
  };
  $('export-batch').onclick=()=>{const url=URL.createObjectURL(new Blob(['\uFEFF'+csv(result)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='SessionPath-chronological-forecast-test.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
}
