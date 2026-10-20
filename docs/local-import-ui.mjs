import {validateBundle,selectable,makeReview,DICTIONARY_VERSION,cutoffMinute,nyInputsFromReview,NY_SESSION_DEFINITION} from './local-import-core.mjs';
import {REVIEW_KEY,readReviewSnapshot,saveReview} from './local-review-store.mjs';
import {instrument} from './instrument.mjs';
import {flashCopyStatus} from './copy-feedback.mjs';

const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
const $=id=>document.getElementById(id);
export function mountLocalImporter(state,apply){
  const section=el('div');section.id='local-json-reader';
  section.innerHTML='<h3>Use your ChatGPT plan</h3><ol class="compact-note"><li>Run <b>Start-SessionPath.cmd</b> on this Windows computer. Choose your chart, date, cutoff and monthly contract.</li><li>Import the generated <b>sessionpath-import.json</b> below.</li><li>Review, approve and apply the selected observations.</li></ol><label>Local launcher path<input id="local-launcher-path" type="text" readonly></label><button id="copy-local-launcher" class="quiet" type="button">Copy launcher path</button><p id="local-launcher-status" class="compact-note" role="status"></p><p class="compact-note">The local reader sends images through your existing ChatGPT login and uses plan quota; no separate API key is used. The website cannot start the launcher. Importing JSON here makes no AI request.</p><label>Analysis JSON<input id="local-json-file" type="file" accept=".json,application/json"></label><label>Screenshot record<select id="local-json-record" disabled></select></label><div id="local-json-status" role="status" aria-live="polite"></div><div id="local-json-review"></div><button id="local-review-export" class="quiet" type="button">Export approved reviews</button><p class="compact-note">Reviews stay in this browser as a separate annotation layer. Original archive tags and historical probabilities are unchanged. Export a backup before clearing browser data.</p><hr class="subtle-rule">';
  const host=$('chart-assistant');host.insertBefore(section,$('paid-api-reader'));
  section.querySelector('h3').textContent=`Use your ChatGPT plan · ${instrument.id}`;
  if(instrument.id==='NQ'){
    section.querySelector('h3').textContent='NQ snapshot and reviewed JSON imports';
    section.querySelector('ol').innerHTML='<li>For prices from the NQ indicator, use <button id="local-nq-snapshot" class="text-button" type="button">Replay tools</button> and paste its <b>NSPI1</b> snapshot line.</li><li>For screenshot observations, import compatible NQ analysis JSON only after checking its date, decision cutoff and quarterly delivery contract against the original image.</li><li>Review and approve each selected observation before applying it. CL analysis files cannot be imported into NQ.</li>';
    $('local-nq-snapshot').onclick=()=>$('replay-tools')?.click();
    $('local-launcher-path').closest('label').hidden=true;
    $('copy-local-launcher').hidden=true;$('local-launcher-status').hidden=true;
    $('local-launcher-status').nextElementSibling.textContent='The existing Windows screenshot launcher has not been updated for NQ. Use the NQ indicator snapshot or an independently reviewed NQ JSON file. Importing JSON here makes no AI request.';
  }
  $('local-launcher-path').value=String.raw`D:\SessionPath-by-LUI-integration\reader\Start-SessionPath.cmd`;
  $('copy-local-launcher').onclick=async()=>{try{await navigator.clipboard.writeText($('local-launcher-path').value);flashCopyStatus($('local-launcher-status'),'Path copied. Paste into Windows File Explorer to open the launcher.');}catch{$('local-launcher-path').focus();$('local-launcher-path').select();flashCopyStatus($('local-launcher-status'),'Path selected. Press Ctrl+C, then paste into Windows File Explorer.',0);}};
  let bundle=null,active=null,revision=0;
  const status=(text,error=false)=>{$('local-json-status').textContent=text;$('local-json-status').classList.toggle('error',error);};
  const reviews=()=>readReviewSnapshot(localStorage).reviews;
  function render(){
    revision++;active=bundle?.records[Number($('local-json-record').value)];const wrap=$('local-json-review');wrap.replaceChildren();if(!active)return;
    const isNY=active.context.cutoff==='08:30';
    const record=active,currentRevision=revision;
    wrap.append(el('p',`${record.source.filename} · ${record.context.contract} · ${record.context.trading_date} ${record.context.cutoff} New York`));
    const provenance=el('details');provenance.append(el('summary','Source and analysis details'),el('p','SHA-256: '+record.source.sha256),el('p',`${record.source.bytes.toLocaleString()} bytes · ${record.analysis.cli_version} · ${record.analysis.created_at}`),el('p',DICTIONARY_VERSION));wrap.append(provenance);
    wrap.append(el('p',record.report.summary));
    if(isNY)wrap.append(el('p',NY_SESSION_DEFINITION+' · NY import uses reviewed session prices. Tags remain separate annotations; the current NY year/shape filters still apply.'));
    for(const note of record.report.uncertainties)wrap.append(el('p',note));
    for(const t of record.report.tags.filter(t=>t.assessment!=='supported'))wrap.append(el('p',`${t.id}: ${t.assessment} — ${t.evidence}`));
    const choices=selectable(record);
    if(!choices.length){status('No eligible observations to apply. '+record.report.status);return;}
    let storeSnapshot;
    try{storeSnapshot=readReviewSnapshot(localStorage);}catch(e){status(e.message,true);return;}
    for(const choice of choices){
      const card=el('div');card.className='ai-suggestion';const label=el('label'),checkbox=el('input');checkbox.type='checkbox';checkbox.dataset.reviewKey=choice.kind+':'+choice.value;
      label.append(checkbox,document.createTextNode(choice.value));card.append(label,el('p',choice.evidence),el('small',choice.confidence+' confidence'));wrap.append(card);
    }
    const nameLabel=el('label','Reviewer name'),name=el('input');name.id='local-reviewer';name.maxLength=100;nameLabel.append(name);
    const noteLabel=el('label','Review note'),note=el('textarea');note.id='local-review-note';note.maxLength=1000;noteLabel.append(note);
    const confirmLabel=el('label'),confirm=el('input');confirm.type='checkbox';confirm.id='local-review-confirm';confirmLabel.append(confirm,document.createTextNode('I checked the exact screenshot, monthly contract, date, cutoff and selected evidence. No later information was used.'));
    const save=el('button','Approve selected observations');save.type='button';save.id='local-review-save';save.className='primary';
    const use=el('button','Apply approved observations to current inputs');use.type='button';use.id='local-review-apply';use.disabled=true;
    const wideLabel=el('label'),wide=el('input');wide.type='checkbox';wide.checked=true;wide.id='local-ny-wide';
    wideLabel.append(wide,document.createTextNode('Include adjacent quarter within 5 percentage points (NY only)'));
    if(isNY)wrap.append(wideLabel);
    let approved=null,editVersion=0;
    const invalidateApproval=()=>{approved=null;use.disabled=true;editVersion++;};
    wrap.append(nameLabel,noteLabel,confirmLabel,save,use);
    for(const input of wrap.querySelectorAll('input,textarea'))input.addEventListener('input',invalidateApproval);
    save.onclick=async()=>{save.disabled=true;try{
      if(currentRevision!==revision)throw Error('Context changed; review again');
      const keys=[...wrap.querySelectorAll('input[data-review-key]:checked')].map(n=>n.dataset.reviewKey);
      const review=makeReview(record,keys,{confirmed:confirm.checked,reviewer:name.value,note:note.value});
      const submittedEdit=editVersion;
      const saved=await saveReview({storage:localStorage,locks:navigator.locks,review,expectedRaw:storeSnapshot.raw,
        isCurrent:()=>currentRevision===revision&&submittedEdit===editVersion});
      if(currentRevision!==revision||submittedEdit!==editVersion){status('Review saved, but the form changed. Review again before applying.');return;}
      storeSnapshot={raw:saved.raw};approved=saved.review;
      use.disabled=false;
      status('Approved and saved in this browser. Forecast inputs have not changed.');
    }catch(e){if(e.code==='REVIEW_CONFLICT')render();status(e.message,true);}finally{save.disabled=false;}};
    use.onclick=()=>{try{
      if(currentRevision!==revision||!approved)throw Error('Review these observations again');
      if($('trading-date').value!==record.context.trading_date||(!isNY&&$('asof').value!==record.context.cutoff))throw Error('Set the current trading date and decision time to match this record, then review again.');
      if(isNY){
        const next=nyInputsFromReview(approved,{basis:$('ny-basis').value,wide:wide.checked});
        for(const session of ['asia','london'])for(const input of document.querySelectorAll(`[data-ny-session="${session}"]`))input.checked=next[session].includes(input.value);
        $('ny-price').value=next.price;$('ny-avr').value=next.avr;
        $('ny-avr').dispatchEvent(new Event('input',{bubbles:true}));use.disabled=true;
        status('Reviewed 08:30 observations applied to New York outlook. Its existing forecast engine recalculated; original archive unchanged.');return;
      }
      const allowed=new Set(state.tags.filter(t=>Number.isFinite(t.earliestMinute)&&t.earliestMinute<=cutoffMinute(record.context.cutoff)).map(t=>t.id));
      if(approved.selected.some(c=>c.kind==='tag'&&!allowed.has(c.value)))throw Error('The platform dictionary changed; import needs updating.');
      apply(approved.selected.map(({kind,value})=>({kind,value})));use.disabled=true;
      status('Approved observations applied to current inputs. Historical archive unchanged.');
    }catch(e){status(e.message,true);}};
    status('Select observations only after checking the original screenshot.');
  }
  $('local-json-file').onchange=async()=>{
    revision++;const loadRevision=revision;bundle=null;active=null;$('local-json-review').replaceChildren();$('local-json-record').replaceChildren();$('local-json-record').disabled=true;
    try{const file=$('local-json-file').files[0];if(!file)return;if(file.size>2000000)throw Error('Import file exceeds 2 MB');
      const parsed=validateBundle(JSON.parse(await file.text()));if(revision!==loadRevision)return;
      bundle=parsed;
      for(const [i,r]of bundle.records.entries()){const o=el('option',`${i+1}. ${r.context.trading_date} ${r.context.cutoff} · ${r.source.filename}`);o.value=String(i);$('local-json-record').append(o);}
      $('local-json-record').disabled=false;render();
    }catch(e){status('Import rejected: '+e.message,true);}
  };
  $('local-json-record').onchange=render;
  window.addEventListener('storage',event=>{
    if(event.storageArea===localStorage&&(event.key===REVIEW_KEY||event.key===null)){
      render();if(active)status('Reviews changed in another tab. Selection and confirmation were reset.');
    }
  });
  for(const id of ['asof','trading-date','replay-date','replay-toggle','ny-basis'])$(id).addEventListener('change',()=>{render();if(active)status('Session or position reference changed. Selection and review confirmation were reset.');});
  $('local-review-export').onclick=()=>{try{
    const data={schema_version:'sessionpath.review-export.v1',instrument:instrument.id,exported_at:new Date().toISOString(),reviews:reviews()};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download='sessionpath-approved-reviews.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status(`Exported ${data.reviews.length} approved reviews.`);
  }catch(e){status(e.message,true);}};
}
