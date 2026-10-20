import { REVIEW_CHECKS, fileMetadata, filterScreenshots, validateReviewLog, reviewCSV } from './screenshot-review-core.mjs';
import {instrument,storageKey} from './instrument.mjs';
import { parseGoogleSheetURL, parseColumnRange, screenshotLinksFromCSV, screenshotLinkID, safeScreenshotURL } from './sheet-link-import.mjs';

const STORAGE = storageKey('sessionpath-screenshot-reviews-v1');
const $ = id => document.getElementById(id);
const labelStatus = status => ({ good: 'Good', redo: 'Needs redo', unreviewed: 'Unreviewed' }[status] || 'Unreviewed');

export function mountScreenshotReview(research) {
  const card = document.createElement('article');
  card.className = 'workflow-tool-card';
  card.innerHTML = `<h3>Screenshot review</h3><p>Review archive charts or a screenshot-link column from Google Sheets.</p><button id="open-screenshot-review" class="quiet" type="button">Open screenshot review</button>`;
  $('screenshot-tool-slot').replaceChildren(card);

  const dialog = document.createElement('dialog'); dialog.id = 'screenshot-review-dialog';
  dialog.setAttribute('aria-labelledby', 'review-heading');
  dialog.innerHTML = `<header class="review-head"><div><div class="eyebrow">SESSIONPATH / TOOLS</div><h2 id="review-heading">Screenshot review</h2></div>
    <div class="review-head-actions"><button id="review-export" class="quiet">Export reviews</button><button id="review-fullscreen" class="quiet">Fullscreen</button><button id="review-close" class="quiet" aria-label="Close screenshot review">×</button></div></header>
    <div class="review-controls">
      <label>Source<select id="review-source"><option value="archive">Archive charts</option><option value="sheet">Sheet links</option><option value="local">Your screenshots</option></select></label>
      <label class="review-file-label">Add screenshots<input id="review-files" type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label="Add screenshots"></label>
      <label>Find a chart<input id="review-search" type="search" placeholder="Date, contract or filename"></label>
      <label>Review<select id="review-filter"><option value="">All captures</option><option value="unreviewed">Unreviewed</option><option value="good">Good</option><option value="redo">Needs redo</option></select></label>
      <button id="review-backup-open" class="quiet">Import review log</button><input id="review-log-file" type="file" accept="application/json,.json" aria-label="Import review log" hidden>
    </div>
    <details id="review-sheet-options" class="review-sheet-options"><summary>Import a screenshot-link column</summary>
      <div class="review-sheet-import"><label class="review-sheet-url">Google Sheets link<input id="review-sheet-url" type="url" placeholder="https://docs.google.com/spreadsheets/d/…" autocomplete="off" spellcheck="false"></label>
      <label class="review-sheet-column">Column / range<input id="review-sheet-column" type="text" value="A" placeholder="A or A2:A1000" maxlength="36" autocomplete="off" spellcheck="false"></label>
      <button id="review-sheet-load" class="primary" type="button">Load column</button>
      <label class="review-file-label">Import CSV<input id="review-sheet-csv" type="file" accept="text/csv,.csv" aria-label="Import screenshot link CSV"></label></div>
      <p class="compact-note">Use a public sheet with actual HTTPS links in its cells. For a private sheet, download CSV and import it here. Label-only hyperlinks may not include their URLs.</p>
      <details class="review-paste-options"><summary>Or paste links</summary><label>One HTTPS link per line<textarea id="review-sheet-paste" rows="3" maxlength="1000000" placeholder="https://…/screenshot.png"></textarea></label><button id="review-sheet-paste-load" class="quiet" type="button">Import pasted links</button></details>
      <p id="review-sheet-status" class="compact-note" role="status" aria-live="polite">The sheet is read only. Imported links stay in this browser tab.</p>
    </details>
    <div class="review-layout"><aside class="review-sidebar"><p id="review-counts" class="compact-note"></p><div id="review-list" aria-label="Screenshot list"></div><p id="review-list-page" class="compact-note"></p></aside>
    <div class="review-workbench"><div class="review-chart-toolbar">
      <button id="review-prev" class="quiet" aria-label="Previous review screenshot">←</button><div class="review-chart-title"><strong id="review-title">Choose a screenshot</strong><span id="review-dimensions"></span></div><button id="review-next" class="quiet" aria-label="Next review screenshot">→</button>
      <button id="review-focus" class="quiet">Focus chart</button><button id="review-fit" class="quiet">Fit</button><button id="review-actual" class="quiet">100%</button><button id="review-minus" class="quiet" aria-label="Zoom out">−</button><output id="review-zoom-label">Fit</output><button id="review-plus" class="quiet" aria-label="Zoom in">+</button>
      <a id="review-open-link" class="quiet review-open-link" target="_blank" rel="noopener noreferrer" hidden>Open original ↗</a><button id="review-open-next-link" class="quiet" type="button" hidden>Open next link ↗</button>
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
  let reviews = {}, items = [], files = [], sheetFiles = [], publicArchive = [], visible = [], index = 0, reference = null, showReference = false, zoom = 'fit', loadVersion = 0;
  let archivePromise = null, sheetImportVersion = 0, sheetController = null;
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
    const legacy = (research.days || []).flatMap(day => { const asset = research.galleryIndex?.[day.index]; return asset?.src ? [{ id: 'archive:' + day.index + ':' + (asset.sha256 || asset.src), name: asset.sourceFile || day.date + '_' + day.contract + '.png', date: day.date, contract: day.contract, src: asset.src, url: new URL(asset.src, document.baseURI).href, view: asset.view || 'overview', width: asset.width, height: asset.height }] : []; });
    const nativeKeys = new Set(publicArchive.map(item => `${item.date}|${item.view}`));
    const nativeURLs = new Set(publicArchive.map(item => new URL(item.src, document.baseURI).href));
    return [...legacy.filter(item => !nativeKeys.has(`${item.date}|${item.view}`) && !nativeURLs.has(item.url)), ...publicArchive].sort((a,b) => (a.date + (a.view === 'overview' ? '0' : '1') + a.name).localeCompare(b.date + (b.view === 'overview' ? '0' : '1') + b.name));
  }
  async function ensurePublicArchive() {
    if (archivePromise) return archivePromise;
    archivePromise = (async () => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(new URL('data/public-screenshots.json', document.baseURI), { credentials: 'omit', signal: controller.signal });
        if (!response.ok) throw Error('Public screenshot archive is unavailable.');
        const text = await readTextLimited(response, 12 * 1024 * 1024);
        const manifest = JSON.parse(text), source = manifest?.[instrument.id];
        if (manifest?.version !== 1 || !Array.isArray(source) || source.length > 20000) throw Error('Public archive index is invalid.');
        const seen = new Set();
        const parsed = source.flatMap(item => {
          if (!item || item.instrument !== instrument.id || !/^[a-f0-9]{64}$/.test(item.sha256 || '') || !/^\d{4}-\d{2}-\d{2}$/.test(item.date || '') || !['overview','detail'].includes(item.view)) return [];
          if (typeof item.src !== 'string' || !new RegExp(`^charts/captures/${instrument.id}/[A-Za-z0-9._-]+\\.png$`).test(item.src)) return [];
          const url = new URL(item.src, document.baseURI).href; if (seen.has(url)) return []; seen.add(url);
          return [{ id: 'local:' + item.sha256, name: String(item.sourceFile || item.name || item.date + '.png').slice(0,250), date: item.date, contract: String(item.contract || '').slice(0,20), view: item.view, src: url, url, width: item.width, height: item.height }];
        });
        if (source.length && !parsed.length) throw Error('Public archive contains no supported screenshots.');
        publicArchive = parsed;
        if (dialog.open && $('review-source').value === 'archive') { const keep = current()?.id; refresh(keep); message(`${publicArchive.length.toLocaleString()} public archive screenshots available.`); }
      } catch {
        if (dialog.open) message('Public screenshot index could not be loaded. Existing charts and your imports are still available; reload to retry.');
      } finally { clearTimeout(timer); }
    })();
    return archivePromise;
  }
  function renderList() {
    const counts = { good: 0, redo: 0, unreviewed: 0 }; for (const item of items) counts[reviews[item.id]?.status || 'unreviewed']++;
    $('review-counts').textContent = `${items.length.toLocaleString()} screenshots · ${counts.good} good · ${counts.redo} redo · ${counts.unreviewed} unreviewed`;
    const start = Math.floor(index / 50) * 50;
    const fragment = document.createDocumentFragment();
    visible.slice(start, start + 50).forEach((item, offset) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'review-list-item'; button.classList.toggle('selected', start + offset === index); button.setAttribute('aria-current', start + offset === index ? 'true' : 'false');
      const title = document.createElement('strong'); title.textContent = item.date || item.name; const detail = document.createElement('span'); detail.textContent = [item.contract, item.view, item.row ? 'Row ' + item.row : '', labelStatus(reviews[item.id]?.status)].filter(Boolean).join(' · '); button.append(title, detail); button.onclick = () => { index = start + offset; renderCurrent(); }; fragment.append(button);
    }); $('review-list').replaceChildren(fragment);
    $('review-list-page').textContent = visible.length ? `${index + 1} / ${visible.length} matching screenshots` : 'No screenshots match these filters.';
    $('review-prev').disabled = index <= 0; $('review-next').disabled = index >= visible.length - 1;
  }
  function refresh(keep = current()?.id) {
    items = $('review-source').value === 'archive' ? archiveItems() : $('review-source').value === 'sheet' ? sheetFiles : files;
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
    const hasPreview = Boolean(active?.src);
    $('review-empty').hidden = hasPreview; image.hidden = !hasPreview;
    $('review-empty').querySelector('b').textContent = active ? 'This link opens in a new tab.' : 'See the whole chart. Then look closer.';
    $('review-empty').querySelector('p').textContent = active ? 'Use Open original to view it. Image links and public Drive files can also preview here.' : 'Choose an archive chart, import a sheet column, or add your screenshots.';
    if (hasPreview) { image.src = active.src; image.alt = (showReference ? 'Reference: ' : 'Screenshot: ') + active.name; image.referrerPolicy = 'no-referrer'; } else image.removeAttribute('src');
    const compare = Boolean(reference && $('review-compare').checked && !showReference);
    $('review-reference-pane').hidden = !compare; $('review-canvases').classList.toggle('comparing', compare);
    if (reference?.src) { $('review-reference-image').src = reference.src; $('review-reference-image').alt = 'Reference: ' + reference.name; $('review-reference-image').referrerPolicy = 'no-referrer'; }
    $('review-main-caption').textContent = showReference ? 'Reference · ' + reference.name : 'Screenshot';
    $('review-switch').textContent = showReference ? 'Show screenshot' : 'Show reference';
    changeZoom('fit');
  }
  function renderCurrent() {
    const item = current(), saved = record(); showReference = false;
    $('review-title').textContent = item ? [item.date, item.contract, item.view].filter(Boolean).join(' · ') || item.name : 'Choose a screenshot';
    $('review-title').title = item?.name || ''; $('review-dimensions').textContent = item?.width ? `${item.width} × ${item.height} pixels · original proportions` : item?.name || '';
    for (const [key] of REVIEW_CHECKS) $('review-check-' + key).checked = saved?.checks?.[key] === true;
    $('review-notes').value = saved?.notes || '';
    for (const id of ['review-good', 'review-redo', 'review-unmark', 'review-set-reference', 'review-notes', ...REVIEW_CHECKS.map(([key]) => 'review-check-' + key)]) $(id).disabled = !item;
    $('review-set-reference').disabled = !item?.src;
    const externalURL = item?.url && safeScreenshotURL(item.url);
    $('review-open-link').hidden = !externalURL;
    if (externalURL) $('review-open-link').href = externalURL; else $('review-open-link').removeAttribute('href');
    $('review-open-next-link').hidden = $('review-source').value !== 'sheet';
    $('review-open-next-link').disabled = !visible[index + 1]?.url;
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
  const sheetStatus = (text, error = false) => { $('review-sheet-status').textContent = text; $('review-sheet-status').classList.toggle('review-import-error', error); message(text); };
  const sheetBusy = busy => { for (const id of ['review-sheet-load','review-sheet-paste-load','review-sheet-csv']) $(id).disabled = busy; $('review-sheet-load').textContent = busy ? 'Loading…' : 'Load column'; };
  async function readTextLimited(response, limit) {
    if (Number(response.headers?.get('content-length') || 0) > limit) throw Error('The requested CSV or archive index is too large.');
    if (!response.body?.getReader) {
      const text = await response.text();
      if (new TextEncoder().encode(text).length > limit) throw Error('The requested CSV or archive index is too large.');
      return text;
    }
    const reader = response.body.getReader(), decoder = new TextDecoder(); let bytes = 0, text = '';
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > limit) { await reader.cancel(); throw Error('The requested CSV or archive index is too large.'); }
        text += decoder.decode(chunk.value, { stream: true });
      }
      return text + decoder.decode();
    } finally { reader.releaseLock(); }
  }
  async function useLinkCSV(csv, options, version) {
    const result = screenshotLinksFromCSV(csv, options);
    let otherMarket = 0;
    const matching = result.items.filter(item => {
      const market = /^(?:MNQ|NQ)/.test(item.contract) ? 'NQ' : /^(?:MCL|CL)/.test(item.contract) ? 'CL' : null;
      if (market && market !== instrument.id) { otherMarket++; return false; } return true;
    });
    if (!matching.length) throw Error(otherMarket ? `These links belong to the other market. Switch to ${instrument.id === 'CL' ? 'NQ' : 'CL'} before importing them.` : 'No readable HTTPS links found in this column. Label-only hyperlinks may lose their URL in CSV; paste the actual links instead.');
    const imported = await Promise.all(matching.map(async item => ({ ...item, id: await screenshotLinkID(item.url), src: item.imageUrl || '', name: item.label || item.url })));
    if (version !== sheetImportVersion) return;
    sheetFiles = imported;
    $('review-source').value = 'sheet'; $('review-search').value = ''; $('review-filter').value = ''; refresh();
    const skipped = result.duplicateCount + result.rejectedCount + otherMarket;
    sheetStatus(`${imported.length.toLocaleString()} links imported${skipped ? '; ' + skipped + ' duplicate, unsafe or other-market links skipped' : ''}${result.truncated ? '; row limit reached' : ''}. Use arrows to review, or Open next link to open one original at a time.`);
  }
  async function fetchSheet() {
    const version = ++sheetImportVersion; sheetController?.abort(); const controller = new AbortController(); sheetController = controller;
    sheetBusy(true); sheetStatus('Reading the selected Google Sheets column…');
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const sheet = parseGoogleSheetURL($('review-sheet-url').value, $('review-sheet-column').value);
      let loaded = false;
      for (const url of [sheet.csvURL, ...sheet.fallbackCSVURLs]) {
        if (controller.signal.aborted) break;
        try {
          const response = await fetch(url, { credentials: 'omit', signal: controller.signal, referrerPolicy: 'no-referrer' });
          if (!response.ok) continue;
          const text = await readTextLimited(response, 24 * 1024 * 1024);
          await useLinkCSV(text, { column: 'A', startRow: sheet.startRow, maxRows: sheet.endRow - sheet.startRow + 1 }, version);
          loaded = true; break;
        } catch (error) { if (controller.signal.aborted) break; }
      }
      if (!loaded) throw Error('Google Sheets could not be read. The sheet may be private, missing link URLs, or blocked by the browser. Import its CSV or paste actual links; your existing screenshots are unchanged.');
    } catch (error) { if (version === sheetImportVersion) sheetStatus(error.message, true); }
    finally { clearTimeout(timer); if (sheetController === controller) sheetController = null; if (version === sheetImportVersion) sheetBusy(false); }
  }
  async function importCSVFile(file) {
    if (!file) return;
    const version = ++sheetImportVersion; sheetController?.abort(); sheetBusy(true);
    try {
      if (file.size > 24 * 1024 * 1024) throw Error('Choose a CSV file smaller than 24 MB.');
      const range = parseColumnRange($('review-sheet-column').value);
      await useLinkCSV(await file.text(), { column: range.column, skipRows: range.startRow - 1, startRow: range.startRow, maxRows: range.endRow - range.startRow + 1 }, version);
    } catch (error) { if (version === sheetImportVersion) sheetStatus(error.message + ' Existing screenshots are unchanged.', true); }
    finally { if (version === sheetImportVersion) sheetBusy(false); }
  }
  function download(content, type, name) { const url = URL.createObjectURL(new Blob([content], { type })), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  $('open-screenshot-review').onclick = () => { for(const open of document.querySelectorAll('dialog[open]'))if(open!==dialog)open.close();dialog.showModal(); refresh(); ensurePublicArchive(); if (research.query?.date) { const target = visible.findIndex(item => item.date === research.query.date); if (target >= 0) { index = target; renderCurrent(); } } if (!persistenceOK) message('Browser storage is unavailable. Export your review log to keep a backup.'); };
  $('tools-open-replay').onclick = () => { if ($('replay-tools')) { $('workspace-tools-dialog').close();$('replay-tools').click(); } };
  $('review-close').onclick = () => dialog.close(); dialog.addEventListener('close', () => { if (document.fullscreenElement === dialog) document.exitFullscreen().catch(() => {}); });
  $('review-prev').onclick = () => move(-1); $('review-next').onclick = () => move(1);
  $('review-fit').onclick = () => changeZoom('fit'); $('review-actual').onclick = () => changeZoom(1); $('review-plus').onclick = () => stepZoom(1); $('review-minus').onclick = () => stepZoom(-1);
  $('review-focus').onclick = () => { const focused = dialog.classList.toggle('review-focus'); $('review-focus').textContent = focused ? 'Show controls' : 'Focus chart'; applyZoom(); };
  $('review-image').onload = () => { const image = $('review-image'); if (!showReference && current()) $('review-dimensions').textContent = `${image.naturalWidth} × ${image.naturalHeight} pixels · original proportions`; applyZoom(); };
  $('review-image').onerror = () => { $('review-image').hidden = true; $('review-empty').hidden = false; $('review-empty').querySelector('b').textContent = 'Image preview unavailable.'; $('review-empty').querySelector('p').textContent = 'Use Open original to view the source. A private Drive image still requires its owner’s permission.'; message('Image preview failed. Open the original link or choose another capture.'); }; $('review-reference-image').onload = applyZoom;
  $('review-reference-image').onerror = () => { $('review-reference-pane').hidden = true; $('review-canvases').classList.remove('comparing'); message('Reference preview failed. Choose a public image or an image file.'); };
  for (const id of ['review-source', 'review-filter']) $(id).onchange = () => { if (id === 'review-source' && $('review-source').value === 'sheet') $('review-sheet-options').open = true; refresh(); }; $('review-search').oninput = () => refresh();
  $('review-sheet-load').onclick = fetchSheet;
  $('review-sheet-csv').onchange = async () => { const file = $('review-sheet-csv').files[0]; $('review-sheet-csv').value = ''; await importCSVFile(file); };
  $('review-sheet-paste-load').onclick = async () => {
    const version = ++sheetImportVersion; sheetController?.abort(); sheetBusy(true);
    try { const csv = $('review-sheet-paste').value.split(/\r?\n/).filter(line => line.trim()).map(line => '"' + line.replaceAll('"','""') + '"').join('\n'); await useLinkCSV(csv, { column: 'A' }, version); }
    catch (error) { if (version === sheetImportVersion) sheetStatus(error.message + ' Existing screenshots are unchanged.', true); }
    finally { if (version === sheetImportVersion) sheetBusy(false); }
  };
  $('review-open-next-link').onclick = () => {
    const next = visible[index + 1], url = next?.url && safeScreenshotURL(next.url); if (!url) return;
    const opened = window.open('about:blank', '_blank');
    if (!opened) { message('Your browser blocked the new tab. Allow popups for this site or use Open original.'); return; }
    try { opened.opener = null; opened.location.replace(url); move(1); message('Opened one original link in a new tab.'); }
    catch { opened.close(); message('The link could not be opened. Your current position is unchanged.'); }
  };
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
