import { REVIEW_CHECKS, fileMetadata, filterScreenshots, validateReviewLog, reviewCSV } from './screenshot-review-core.mjs';
import {instrument,storageKey} from './instrument.mjs';

const STORAGE = storageKey('sessionpath-screenshot-reviews-v1');
const $ = id => document.getElementById(id);
const labelStatus = status => ({ good: 'Good', redo: 'Needs redo', unreviewed: 'Unreviewed' }[status] || 'Unreviewed');

export function mountScreenshotReview(research) {
  const card = document.createElement('article');
  card.className = 'workflow-tool-card';
  card.innerHTML = `<h3>Screenshot review</h3><p>Zoom into charts, compare a reference and save framing checks.</p><button id="open-screenshot-review" class="quiet" type="button">Open screenshot review</button>`;
  $('screenshot-tool-slot').replaceChildren(card);

  const dialog = document.createElement('dialog'); dialog.id = 'screenshot-review-dialog';
  dialog.setAttribute('aria-labelledby', 'review-heading');
  dialog.innerHTML = `<header class="review-head"><div><div class="eyebrow">SESSIONPATH / TOOLS</div><h2 id="review-heading">Screenshot review</h2></div>
    <div class="review-head-actions"><button id="review-export" class="quiet">Export reviews</button><button id="review-fullscreen" class="quiet">Fullscreen</button><button id="review-close" class="quiet" aria-label="Close screenshot review">×</button></div></header>
    <div class="review-controls">
      <label>Source<select id="review-source"><option value="archive">Archive charts</option><option value="local">Your screenshots</option></select></label>
      <label class="review-file-label">Add screenshots<input id="review-files" type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label="Add screenshots"></label>
      <label>Find a chart<input id="review-search" type="search" placeholder="Date, contract or filename"></label>
      <label>Review<select id="review-filter"><option value="">All captures</option><option value="unreviewed">Unreviewed</option><option value="good">Good</option><option value="redo">Needs redo</option></select></label>
      <button id="review-backup-open" class="quiet">Import review log</button><input id="review-log-file" type="file" accept="application/json,.json" aria-label="Import review log" hidden>
    </div>
    <div class="review-layout"><aside class="review-sidebar"><p id="review-counts" class="compact-note"></p><div id="review-list" aria-label="Screenshot list"></div><p id="review-list-page" class="compact-note"></p></aside>
    <div class="review-workbench"><div class="review-chart-toolbar">
      <button id="review-prev" class="quiet" aria-label="Previous review screenshot">←</button><div class="review-chart-title"><strong id="review-title">Choose a screenshot</strong><span id="review-dimensions"></span></div><button id="review-next" class="quiet" aria-label="Next review screenshot">→</button>
      <button id="review-focus" class="quiet">Focus chart</button><button id="review-fit" class="quiet">Fit</button><button id="review-actual" class="quiet">100%</button><button id="review-minus" class="quiet" aria-label="Zoom out">−</button><output id="review-zoom-label">Fit</output><button id="review-plus" class="quiet" aria-label="Zoom in">+</button>
    </div>
    <details id="review-reference-options"><summary>Reference comparison</summary><div class="review-reference-controls"><button id="review-set-reference" class="quiet">Use this as reference</button><label class="review-file-label">Choose reference<input id="review-reference-file" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Choose reference screenshot"></label>
      <label class="inline-check"><input id="review-compare" type="checkbox" disabled> Compare side by side</label><button id="review-switch" class="quiet" disabled>Show reference</button><button id="review-clear-reference" class="text-button" hidden>Clear reference</button><span id="review-reference-name" class="compact-note">No reference selected</span></div></details>
    <div id="review-canvases"><div class="review-picture"><span id="review-main-caption" class="review-picture-caption">Screenshot</span><div id="review-stage" class="review-stage" tabindex="0" aria-label="Screenshot image; drag to pan when zoomed"><div class="review-image-space"><img id="review-image" alt="" draggable="false"></div><div id="review-empty"><b>See the whole chart. Then look closer.</b><p>Choose an archive chart or add your screenshots. Image proportions are preserved at every zoom level.</p></div></div></div>
      <div id="review-reference-pane" class="review-picture" hidden><span class="review-picture-caption">Reference</span><div id="review-reference-stage" class="review-stage" tabindex="0" aria-label="Reference image; drag to pan when zoomed"><div class="review-image-space"><img id="review-reference-image" alt="Reference chart" draggable="false"></div></div></div></div>
    <div class="review-footer"><details id="review-check-options"><summary>Framing checks & notes</summary><div class="review-check-content"><div class="review-checks">${REVIEW_CHECKS.map(([key, label]) => `<label><input id="review-check-${key}" type="checkbox">${label}</label>`).join('')}</div><div class="review-verdict"><label>Review notes<textarea id="review-notes" rows="2" maxlength="5000" placeholder="Clipped box, unreadable prices, wrong framing…"></textarea></label></div></div></details>
      <div class="review-verdict-actions"><span id="review-verdict-status" class="review-verdict-pill">Unreviewed</span><button id="review-good" class="primary">Good & next</button><button id="review-redo" class="quiet">Redo & next</button><button id="review-unmark" class="text-button">Reset review</button></div></div>
    </div></div><div class="review-bottom"><span id="review-message" role="status" aria-live="polite">← / → next chart · + / − zoom · F fit · 1 actual size · drag to pan</span><span>Image files stay on this device. Export reviews to keep a backup.</span></div>
    <dialog id="review-export-dialog" aria-labelledby="review-export-heading"><div class="dialog-head"><h2 id="review-export-heading">Export reviews</h2><button id="review-export-close" class="quiet" aria-label="Close review export">×</button></div><p>Save a JSON backup to restore reviews later, or a CSV to use with your sheet.</p><div class="button-row"><button id="review-export-json" class="primary">Download JSON</button><button id="review-export-csv" class="quiet">Download CSV</button></div></dialog>`;
  document.body.insertBefore(dialog,$('chart-reader-dialog'));
  let reviews = {}, items = [], files = [], visible = [], index = 0, reference = null, showReference = false, zoom = 'fit', loadVersion = 0;
  let persistenceOK = true;
  try { const saved = localStorage.getItem(STORAGE); if (saved) reviews = validateReviewLog(JSON.parse(saved)); } catch { persistenceOK = false; }
  const current = () => visible[index];
  const message = text => { $('review-message').textContent = text; };
  function persist() {
    try { localStorage.setItem(STORAGE, JSON.stringify({ version: 1, instrument:instrument.id, reviews: Object.values(reviews) })); persistenceOK = true; }
    catch { persistenceOK = false; message('Reviews could not be saved in this browser. Export a backup before closing.'); }
  }
  function record(item = current()) {
    if (!item) return null;
    return reviews[item.id] || { id: item.id, name: item.name, date: item.date, contract: item.contract, status: 'unreviewed', checks: {}, notes: '' };
  }
  function saveDraft() {
    const item = current(); if (!item) return;
    reviews[item.id] = { ...record(item), checks: Object.fromEntries(REVIEW_CHECKS.map(([key]) => [key, $('review-check-' + key).checked])), notes: $('review-notes').value, updatedAt: new Date().toISOString() };
    if (reviews[item.id].status === 'good' && !Object.values(reviews[item.id].checks).every(Boolean)) reviews[item.id].status = 'unreviewed';
    persist(); updateVerdict(); renderList();
  }
  function updateVerdict() {
    const status = record()?.status || 'unreviewed'; $('review-verdict-status').textContent = labelStatus(status); $('review-verdict-status').dataset.status = status;
  }
  function archiveItems() {
    return (research.days || []).flatMap(day => { const asset = research.galleryIndex?.[day.index]; return asset?.src ? [{ id: 'archive:' + day.index + ':' + (asset.sha256 || asset.src), name: asset.sourceFile || day.date + '_' + day.contract + '.png', date: day.date, contract: day.contract, src: asset.src, width: asset.width, height: asset.height }] : []; });
  }
  function renderList() {
    const counts = { good: 0, redo: 0, unreviewed: 0 }; for (const item of items) counts[reviews[item.id]?.status || 'unreviewed']++;
    $('review-counts').textContent = `${items.length.toLocaleString()} screenshots · ${counts.good} good · ${counts.redo} redo · ${counts.unreviewed} unreviewed`;
    const start = Math.floor(index / 50) * 50;
    const fragment = document.createDocumentFragment();
    visible.slice(start, start + 50).forEach((item, offset) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'review-list-item'; button.classList.toggle('selected', start + offset === index); button.setAttribute('aria-current', start + offset === index ? 'true' : 'false');
      const title = document.createElement('strong'); title.textContent = item.date || item.name; const detail = document.createElement('span'); detail.textContent = [item.contract, labelStatus(reviews[item.id]?.status)].filter(Boolean).join(' · '); button.append(title, detail); button.onclick = () => { index = start + offset; renderCurrent(); }; fragment.append(button);
    }); $('review-list').replaceChildren(fragment);
    $('review-list-page').textContent = visible.length ? `${index + 1} / ${visible.length} matching screenshots` : 'No screenshots match these filters.';
    $('review-prev').disabled = index <= 0; $('review-next').disabled = index >= visible.length - 1;
  }
  function refresh(keep = current()?.id) {
    items = $('review-source').value === 'archive' ? archiveItems() : files;
    visible = filterScreenshots(items, reviews, $('review-search').value, $('review-filter').value);
    const found = visible.findIndex(item => item.id === keep); index = Math.max(0, found); renderCurrent();
  }
  function applyZoom() {
    for (const [imageID, stageID] of [['review-image', 'review-stage'], ['review-reference-image', 'review-reference-stage']]) {
      const image = $(imageID), stage = $(stageID); if (!image.naturalWidth || stage.closest('[hidden]')) continue;
      const fit = Math.min((stage.clientWidth - 24) / image.naturalWidth, (stage.clientHeight - 24) / image.naturalHeight, 1);
      const scale = zoom === 'fit' ? Math.max(.01, fit) : zoom;
      image.style.width = Math.round(image.naturalWidth * scale) + 'px'; image.style.height = 'auto';
      stage.classList.toggle('can-pan', scale > fit + .01);
    }
    $('review-zoom-label').textContent = zoom === 'fit' ? 'Fit' : Math.round(zoom * 100) + '%';
  }
  function changeZoom(value) {
    zoom = value; for (const id of ['review-stage', 'review-reference-stage']) { $(id).scrollTop = 0; $(id).scrollLeft = 0; } applyZoom();
  }
  function stepZoom(direction) {
    const image = $('review-image'), stage = $('review-stage');
    const scale = zoom === 'fit' && image.naturalWidth ? parseFloat(image.style.width) / image.naturalWidth : Number(zoom) || 1;
    changeZoom(Math.min(4, Math.max(.1, scale * (direction > 0 ? 1.25 : .8))));
  }
  function renderImages() {
    const item = current(), image = $('review-image'), active = showReference ? reference : item;
    $('review-empty').hidden = Boolean(active); image.hidden = !active;
    if (active) { image.src = active.src; image.alt = (showReference ? 'Reference: ' : 'Screenshot: ') + active.name; } else image.removeAttribute('src');
    const compare = Boolean(reference && $('review-compare').checked && !showReference);
    $('review-reference-pane').hidden = !compare; $('review-canvases').classList.toggle('comparing', compare);
    if (reference) { $('review-reference-image').src = reference.src; $('review-reference-image').alt = 'Reference: ' + reference.name; }
    $('review-main-caption').textContent = showReference ? 'Reference · ' + reference.name : 'Screenshot';
    $('review-switch').textContent = showReference ? 'Show screenshot' : 'Show reference';
    changeZoom('fit');
  }
  function renderCurrent() {
    const item = current(), saved = record(); showReference = false;
    $('review-title').textContent = item ? [item.date, item.contract].filter(Boolean).join(' · ') || item.name : 'Choose a screenshot';
    $('review-title').title = item?.name || ''; $('review-dimensions').textContent = item?.width ? `${item.width} × ${item.height} pixels · original proportions` : item?.name || '';
    for (const [key] of REVIEW_CHECKS) $('review-check-' + key).checked = saved?.checks?.[key] === true;
    $('review-notes').value = saved?.notes || '';
    for (const id of ['review-good', 'review-redo', 'review-unmark', 'review-set-reference', 'review-notes', ...REVIEW_CHECKS.map(([key]) => 'review-check-' + key)]) $(id).disabled = !item;
    updateVerdict(); renderList(); renderImages();
  }
  function move(delta) { if (!visible.length) return; index = Math.max(0, Math.min(visible.length - 1, index + delta)); renderCurrent(); }
  function verdict(status) {
    const item = current(); if (!item) return;
    saveDraft(); if (status === 'good' && !REVIEW_CHECKS.every(([key]) => reviews[item.id].checks[key])) { $('review-check-options').open = true; message('Confirm all four framing and readability checks before marking a capture good.'); return; }
    reviews[item.id].status = status; persist();
    const nextID = visible[index + 1]?.id; refresh(nextID || item.id);
    if (persistenceOK) message(`${item.date || item.name}: ${labelStatus(status)} saved. Reviews are separate from the research sheet.`);
  }
  function setReference(item) {
    if (reference?.ownedURL) URL.revokeObjectURL(reference.src);
    reference = item; showReference = false; $('review-compare').disabled = !item; $('review-switch').disabled = !item; $('review-clear-reference').hidden = !item;
    $('review-reference-name').textContent = item ? 'Reference: ' + item.name : 'No reference selected';
    if (!item) { $('review-compare').checked = false; $('review-reference-image').removeAttribute('src'); }
    renderImages();
  }
  async function chooseFiles(selected, asReference = false) {
    const version = ++loadVersion; let accepted = 0, rejected = 0;
    message('Opening screenshots…');
    for (const file of Array.from(selected || [])) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) { rejected++; continue; }
      const src = URL.createObjectURL(file);
      try {
        const image = new Image(); image.src = src; await image.decode();
        if (image.naturalWidth * image.naturalHeight > 60000000) throw Error('Too large');
        const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer()); const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
        const item = { id: 'local:' + hash, name: file.name, ...fileMetadata(file.name), src, width: image.naturalWidth, height: image.naturalHeight, ownedURL: true };
        if (version !== loadVersion) { URL.revokeObjectURL(src); return; }
        if (asReference) { setReference(item); accepted++; break; }
        if (files.some(existing => existing.id === item.id)) URL.revokeObjectURL(src); else { files.push(item); accepted++; }
      } catch { URL.revokeObjectURL(src); rejected++; }
    }
    if (!asReference) { files.sort((a, b) => (a.date + a.name).localeCompare(b.date + b.name)); $('review-source').value = 'local'; $('review-search').value = ''; $('review-filter').value = ''; refresh(); }
    message(`${accepted} ${asReference ? 'reference' : 'screenshot(s)'} opened${rejected ? `; ${rejected} unsupported or oversized file(s) skipped` : ''}. Your image files stay on this device.`);
  }
  function download(content, type, name) { const url = URL.createObjectURL(new Blob([content], { type })), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  $('open-screenshot-review').onclick = () => { for(const open of document.querySelectorAll('dialog[open]'))if(open!==dialog)open.close();dialog.showModal(); refresh(); if (research.query?.date) { const target = visible.findIndex(item => item.date === research.query.date); if (target >= 0) { index = target; renderCurrent(); } } if (!persistenceOK) message('Browser storage is unavailable. Export your review log to keep a backup.'); };
  $('tools-open-replay').onclick = () => { if ($('replay-tools')) { $('workspace-tools-dialog').close();$('replay-tools').click(); } };
  $('review-close').onclick = () => dialog.close(); dialog.addEventListener('close', () => { if (document.fullscreenElement === dialog) document.exitFullscreen().catch(() => {}); });
  $('review-prev').onclick = () => move(-1); $('review-next').onclick = () => move(1);
  $('review-fit').onclick = () => changeZoom('fit'); $('review-actual').onclick = () => changeZoom(1); $('review-plus').onclick = () => stepZoom(1); $('review-minus').onclick = () => stepZoom(-1);
  $('review-focus').onclick = () => { const focused = dialog.classList.toggle('review-focus'); $('review-focus').textContent = focused ? 'Show controls' : 'Focus chart'; applyZoom(); };
  $('review-image').onload = () => { const image = $('review-image'); if (!showReference && current()) $('review-dimensions').textContent = `${image.naturalWidth} × ${image.naturalHeight} pixels · original proportions`; applyZoom(); };
  $('review-image').onerror = () => message('This chart could not be opened. Try another capture or add its image file.'); $('review-reference-image').onload = applyZoom;
  for (const id of ['review-source', 'review-filter']) $(id).onchange = () => refresh(); $('review-search').oninput = () => refresh();
  $('review-files').onchange = () => { chooseFiles($('review-files').files); $('review-files').value = ''; };
  $('review-reference-file').onchange = () => { chooseFiles($('review-reference-file').files, true); $('review-reference-file').value = ''; };
  $('review-set-reference').onclick = () => { const item = current(); if (item) setReference({ ...item, ownedURL: false }); };
  $('review-clear-reference').onclick = () => setReference(null); $('review-compare').onchange = () => { showReference = false; renderImages(); }; $('review-switch').onclick = () => { showReference = !showReference; renderImages(); };
  $('review-notes').oninput = saveDraft; for (const [key] of REVIEW_CHECKS) $('review-check-' + key).onchange = saveDraft;
  $('review-good').onclick = () => verdict('good'); $('review-redo').onclick = () => verdict('redo'); $('review-unmark').onclick = () => { const item = current(); if (!item) return; delete reviews[item.id]; persist(); refresh(item.id); };
  $('review-export').onclick = () => $('review-export-dialog').showModal(); $('review-export-close').onclick = () => $('review-export-dialog').close();
  $('review-export-json').onclick = () => download(JSON.stringify({ version: 1, instrument:instrument.id, exportedAt: new Date().toISOString(), reviews: Object.values(reviews) }, null, 2), 'application/json', `SessionPath-${instrument.id}-screenshot-reviews.json`);
  $('review-export-csv').onclick = () => download('\ufeff' + reviewCSV(reviews), 'text/csv;charset=utf-8', 'SessionPath-screenshot-reviews.csv');
  $('review-backup-open').onclick = () => $('review-log-file').click(); $('review-log-file').onchange = async () => { try { const file = $('review-log-file').files[0]; if (!file || file.size > 10 * 1024 * 1024) throw Error('Choose a review log under 10 MB.'); const imported = validateReviewLog(JSON.parse(await file.text())); Object.assign(reviews, imported); persist(); refresh(); message(`${Object.keys(imported).length} saved reviews restored.`); } catch (error) { message(error.message); } finally { $('review-log-file').value = ''; } };
  $('review-fullscreen').onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await dialog.requestFullscreen(); } catch { message('Fullscreen is unavailable here. The review window is already using the available screen.'); } };
  document.addEventListener('fullscreenchange', () => { $('review-fullscreen').textContent = document.fullscreenElement === dialog ? 'Exit fullscreen' : 'Fullscreen'; applyZoom(); });
  new ResizeObserver(applyZoom).observe($('review-canvases'));
  dialog.addEventListener('keydown', event => { if (event.target.closest('input,textarea,select') || $('review-export-dialog').open) return; const action = { ArrowLeft: () => move(-1), ArrowRight: () => move(1), '+': () => stepZoom(1), '=': () => stepZoom(1), '-': () => stepZoom(-1), f: () => changeZoom('fit'), F: () => changeZoom('fit'), '1': () => changeZoom(1) }[event.key]; if (action) { event.preventDefault(); action(); } });
  for (const id of ['review-stage', 'review-reference-stage']) {
    const stage = $(id); let pan = null;
    stage.addEventListener('pointerdown', event => { if (event.button !== 0 || !stage.classList.contains('can-pan')) return; pan = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop }; stage.setPointerCapture(event.pointerId); stage.classList.add('panning'); event.preventDefault(); });
    stage.addEventListener('pointermove', event => { if (pan) { stage.scrollLeft = pan.left + pan.x - event.clientX; stage.scrollTop = pan.top + pan.y - event.clientY; } });
    const end = () => { pan = null; stage.classList.remove('panning'); }; stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
    stage.addEventListener('wheel', event => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); stepZoom(event.deltaY < 0 ? 1 : -1); } }, { passive: false });
    for (const name of ['dragover', 'drop']) stage.addEventListener(name, event => { event.preventDefault(); if (name === 'drop') chooseFiles(event.dataTransfer.files); });
  }
}
