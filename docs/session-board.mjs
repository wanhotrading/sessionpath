import { mountQuickComparison } from './quick-comparison.mjs?v=mist-comparison-20261119';
import { mountFeedWatermark } from './board-feed-watermark.mjs?v=news-ticker-20261118';
import { cancelForecastTextMotion, revealForecastText } from './forecast-text-motion.mjs?v=market-row-20261118';
import { createSavedCheckpointReader } from './saved-forecast-checkpoints.mjs?v=followup-20261118';
import { archivedResearchBar, contractSymbol } from './followup-observations.mjs?v=2';
import { mountSessionFollowup } from './session-followup.mjs?v=midnight-elf-20261119';

const windows = [
  { cutoff: '03:00', end: '05:00', minute: 180, endMinute: 300 },
  { cutoff: '05:00', end: '08:30', minute: 300, endMinute: 510 },
  { cutoff: '08:30', end: '16:00', minute: 510, endMinute: 960 },
];

const $ = id => document.getElementById(id);
const marketEmblems = {
  CL: './assets/emblems/cl-acrylic-v1.webp',
  NQ: './assets/emblems/nq-acrylic-v1.webp',
  ES: './assets/emblems/es-acrylic-staging.svg',
};

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

export function snapshotFields(snapshot, window, date, preferences, plan) {
  const up = (snapshot.range_high - snapshot.open_1930) / snapshot.avr;
  const down = (snapshot.open_1930 - snapshot.range_low) / snapshot.avr;
  const range = snapshot.range_high - snapshot.range_low;
  return {
    ...preferences, date, beforeDate: date, startMinute: -270, minute: window.minute,
    raw: window.minute, endMinute: window.endMinute, price: snapshot.reference_price, avr: snapshot.avr,
    printed: range / snapshot.avr, up, down, open1930: snapshot.open_1930,
    rangePosition: range > 0 ? (snapshot.reference_price - snapshot.range_low) / range : null,
    q: (snapshot.reference_price - snapshot.prior_low) / (snapshot.prior_high - snapshot.prior_low),
    rangeHigh: snapshot.range_high, rangeLow: snapshot.range_low,
    location: plan.location, behavior: snapshot.last_hour_behavior || plan.behavior,
  };
}

function newCard(window) {
  // The original context reveal uses this scope to keep each shine local.
  const panel = node('article', 'session-board-window forecast-context-grid');
  panel.id = 'window-' + window.cutoff.replace(':', '');
  const heading = node('h2', '', window.cutoff + '–' + window.end);
  const windowHeading = node('div', 'session-board-window-heading');
  const windowTitle = node('div', 'session-board-window-title');
  const period = node('div', 'session-board-window-period');
  period.append(heading);
  windowTitle.append(period);
  const status = node('p', 'session-board-source', 'Awaiting checkpoint');
  status.setAttribute('role', 'status');
  const checks = node('dl', 'session-board-check');
  const price = node('dd', '', '—');
  const avr = node('dd', '', '—');
  for (const [label, value] of [['Decision open', price], ['AVR · points', avr]]) {
    const group = node('div');
    group.append(node('dt', '', label), value);
    checks.append(group);
  }
  windowHeading.append(windowTitle, checks);
  const context = node('aside', 'forecast-context');
  const containment = node('dl', 'session-board-containment');
  const containmentLabel = node('dt', '', 'Stayed within the SessionPath box');
  const containmentValue = node('dd', '', '—');
  const containmentSample = node('small', '');
  containmentValue.setAttribute('aria-live', 'polite');
  containment.append(containmentLabel, containmentValue, containmentSample);
  const exportRow = node('div', 'session-board-export');
  const copy = node('button', 'quiet', 'Copy forecast code');
  copy.type = 'button';
  copy.disabled = true;
  const info = node('span', 'session-board-copy-status');
  info.setAttribute('role', 'status');
  const count = node('span', 'session-board-match-count');
  const fallback = node('textarea');
  fallback.hidden = true;
  fallback.readOnly = true;
  fallback.setAttribute('aria-label', heading.textContent + ' TradingView code');
  exportRow.append(copy, count, info, fallback);
  panel.append(windowHeading, status, containment, context, exportRow);
  panel.hidden = true;
  return { window, panel, windowTitle, period, status, price, avr, context, copy, count, info, fallback, containmentValue, containmentSample, code: '', key: '' };
}

function showContainment(card, result) {
  const hasCases = result?.n > 0 && Number.isFinite(result.coverage);
  const value = hasCases ? (100 * result.coverage).toFixed(1) + '%' : '—';
  if (card.containmentValue.dataset.value !== value) {
    card.containmentValue.dataset.value = value;
    card.containmentValue.textContent = value;
  }
  card.containmentSample.textContent = hasCases ? result.inside + '/' + result.n + ' historical windows' : '';
}

export function mountSessionBoard({ market, nyClock, mainInputPlan, archive, historyURL, parseSaved, preferences, estimate, applyArchivedNY, renderContext, clearContext, activeWindowChanged, replayMinute, followup, comparison }) {
  const board = node('section', 'session-board');
  board.id = 'session-board';
  board.setAttribute('aria-label', 'Forecast workspace');
  const actions = node('div', 'session-board-actions');
  const backToday = node('button', 'quiet', 'Back to today');
  backToday.type = 'button';
  backToday.hidden = true;
  backToday.addEventListener('click', () => {
    $('replay-toggle').checked = false;
    $('replay-toggle').dispatchEvent(new Event('change', { bubbles: true }));
  });
  const sample = $('sample-size');
  const label = sample.closest('label');
  label.firstChild.remove();
  label.classList.add('session-board-sample');
  sample.setAttribute('aria-label', 'Overnight sample');
  actions.append(backToday);
  const grid = node('div', 'session-board-grid');
  const cards = windows.map(newCard);
  const paths = $('sessions-section');
  const right = node('div', 'session-board-right');
  const followupPanel = node('section', 'research-followup');
  followupPanel.id = 'research-followup';
  right.append(paths, followupPanel);
  const quickComparison = mountQuickComparison(paths, comparison);
  paths.addEventListener('sessionpath:comparison-filters', quickComparison.refresh);
  grid.append(...cards.map(card => card.panel), right);
  board.append(grid, actions);
  $('workspace').prepend(board);
  const renderFollowup = mountSessionFollowup(followupPanel, {market, loadResearch: followup.loadResearch, historyURL});

  const topbar = document.querySelector('.topbar');
  const brand = topbar.querySelector('.brand');
  brand.href = '#session-board';

  const marketSelect = $('instrument-select');
  const marketPicker = marketSelect.closest('label');
  marketPicker.firstChild.remove();
  marketPicker.classList.add('session-board-market');
  // The picker switches pages and must stay out of the saved analysis inputs.
  marketSelect.removeAttribute('id');
  let emblem = node('span', 'session-board-market-emblem', 'Au');
  if (marketEmblems[market]) {
    emblem = node('img', 'session-board-market-emblem');
    emblem.src = new URL(marketEmblems[market], import.meta.url).href;
    emblem.alt = '';
  }
  emblem.setAttribute('aria-hidden', 'true');
  marketPicker.prepend(emblem);

  const toolsButton = $('workspace-tools-toggle');
  toolsButton.textContent = 'Tools';
  const lowerTools = node('div', 'session-board-utilities');
  lowerTools.append(toolsButton);
  $('projection').append(lowerTools);
  const toolSettings = node('div', 'session-board-tools-settings');
  const playbook = topbar.querySelector('.top-actions a');
  const help = $('method-btn');
  help.textContent = 'Help';
  const showToolsAfterHelp = () => {
    const helpDialog = $('method-dialog');
    helpDialog.addEventListener('close', () => $('workspace-tools-dialog').showModal(), { once: true });
    $('workspace-tools-dialog').close();
  };
  help.addEventListener('click', showToolsAfterHelp, { capture: true });
  toolSettings.append($('motion-toggle'), help);
  if (playbook) toolSettings.append(playbook);
  $('workspace-tools-dialog').append(toolSettings);
  topbar.replaceChildren(brand);
  mountFeedWatermark(topbar);
  document.body.classList.add('session-board-active');
  $('indicator-section').hidden = true;

  let verifiedDate = '';
  let verifiedContract = '';
  const verifiedSnapshots = new Map();
  let queued = false;
  let archiveDate = '';
  let archiveRecords = [];
  let livePacket;
  let exactCloses = new Map();
  let replayFeed;
  let replayPrior;
  let requestedReplay = null;
  let appliedNY = '';
  let nyModel;
  let active;
  let saved = null;
  let lookup = null;
  let lastLookup = {key:'', at:0};
  const findSaved = createSavedCheckpointReader({endpoint:historyURL, market, parse:parseSaved, windows});
  const newer = (a, b) => Boolean(a && (!b || a.date > b.date || a.date === b.date && a.index > b.index));
  function readSaved(clock, expected) {
    const key = clock.date + ':' + expected;
    if (lookup || (lastLookup.key === key && Date.now() - lastLookup.at < 60_000) || document.hidden) return;
    lastLookup = {key, at:Date.now()};
    lookup = findSaved(clock).then(result => {
      if (newer(result, saved) || result && result.date === saved?.date && result.index === saved.index) saved = result;
    }).finally(() => {
      lookup = null;
      scheduleUpdate();
    });
  }
  const nyCard = cards.at(-1);
  function sameNYInputs(snapshot,date) {
    return $('ny-date')?.value === date && $('ny-end')?.value === '960' &&
      [['ny-price', snapshot.reference_price], ['ny-avr', snapshot.avr], ['ny-range-high', snapshot.range_high], ['ny-range-low', snapshot.range_low]]
        .every(([id, value]) => $(id)?.value !== '' && Math.abs(Number($(id)?.value) - value) < 1e-7);
  }
  const estimates = new Map();
  function overnightEstimate(record, index, date) {
    const { snapshot } = record;
    const window = windows[index];
    const settings = preferences(window.minute, date);
    const key = JSON.stringify([date, record.contract, snapshot, settings]);
    if (!estimates.has(key)) {
      const q = snapshotFields(snapshot, window, date, settings, mainInputPlan(snapshot));
      if (estimates.size >= 12) estimates.delete(estimates.keys().next().value);
      estimates.set(key, estimate(q));
    }
    return estimates.get(key);
  }
  function updateFollowup(record, records, index, date, clock, replay) {
    const window = windows[index];
    if (!record) {
      void renderFollowup({record});
      return;
    }
    if (replay && record.contract.endsWith('1!') && replayFeed?.date !== date) {
      const pending = {date};
      replayFeed = pending;
      void findSaved.forDate(date).then(result => {
        Object.assign(pending, result);
        if (replayFeed === pending) scheduleUpdate();
      });
    }
    const historicalFeed = replay ? (replayFeed?.date === date ? replayFeed : null) : (saved?.date === date ? saved : null);
    const knownFeed = historicalFeed?.packet?.source_symbol === record.contract ? historicalFeed.packet : null;
    const packet = !replay && livePacket?.session_date === date && livePacket?.source_symbol === record.contract ? livePacket : knownFeed;
    const matchContract = item => contractSymbol(item?.contract) === contractSymbol(record.contract);
    const priorKey = date + ':' + window.cutoff + ':' + record.contract;
    const prior = [records[index - 1], historicalFeed?.records?.[index - 1], replayPrior?.key === priorKey ? replayPrior.record : null].find(matchContract);
    if (replay && index > 0 && !prior && !record.contract.endsWith('1!') && replayPrior?.key !== priorKey) {
      const pending = {key:priorKey};
      replayPrior = pending;
      void followup.loadPrior({...windows[index - 1], market, date}).then(result => {
        pending.record = result;
        if (replayPrior === pending) scheduleUpdate();
      }).catch(() => {});
    }
    const barAt = record.contract.endsWith('1!') ? null : archivedResearchBar(followup.state.days, followup.state.timeline, {date, contract:record.contract});
    const confirmed = Date.parse(record.snapshot.as_of);
    const exactClose = packet?.endpoint_closes?.[window.cutoff] ?? (!replay ? exactCloses.get(confirmed) : undefined) ??
      (Date.parse(packet?.observed_at) === confirmed ? packet.last_price : null);
    const through = barAt ? (date === clock.date ? clock.minute : window.endMinute) : packet ? nyClock(Date.parse(packet.observed_at)).minute :
      date === clock.date ? clock.minute : window.endMinute;
    let bounds = null, priorBounds = null;
    try {
      if (prior) priorBounds = overnightEstimate(prior, index - 1, date)?.bounds;
      bounds = index < 2 ? overnightEstimate(record, index, date)?.bounds :
        cards[index].code ? followup.bounds(cards[index].code) : null;
    } catch { /* No valid box geometry for this checkpoint. */ }
    void renderFollowup({date, window, record, bounds, priorBounds, through, remoteThrough:packet?.research_through, barAt, exactClose, replay});
  }
  function refreshNYCode() {
    if (nyCard.panel.hidden || !nyCard.key || !nyCard.record) return;
    const snapshot = nyCard.record.snapshot;
    const verifiedInputs = sameNYInputs(snapshot,nyCard.record.date);
    nyCard.code = verifiedInputs && !$('ny-copy')?.disabled ? $('ny-code')?.value || '' : '';
    nyCard.copy.disabled = !nyCard.code;
    const cohortDisplay = $('ny-results')?.querySelector('.ny-cohort strong');
    nyCard.count.textContent = verifiedInputs ? cohortDisplay?.textContent || '' : '';
    const q = nyModel?.query;
    const matchesSnapshot = verifiedInputs && cohortDisplay && q?.date === nyCard.record.date && q.minute === 510 && q.endMinute === 960 &&
      [['price', snapshot.reference_price], ['avr', snapshot.avr], ['rangeHigh', snapshot.range_high], ['rangeLow', snapshot.range_low]]
        .every(([key, value]) => Math.abs(q[key] - value) < 1e-7);
    showContainment(nyCard, matchesSnapshot && q.date === $('trading-date').value ? nyModel.box : null);
    quickComparison.setForecast({ date: nyCard.record.date, minute: 510, dates: matchesSnapshot ? nyModel.box.dates : null });
  }

  function update() {
    queued = false;
    const replay = $('replay-toggle').checked;
    const clock = nyClock();
    const date = replay ? $('trading-date').value : clock.date;
    const ready = document.documentElement.dataset.startup === 'ready';
    backToday.hidden = !replay;
    if (ready && replay && archiveDate !== date) {
      archiveDate = date;
      archiveRecords = windows.map(window => archive({ ...window, market, date }));
    }
    const records = replay ? windows.map((window,index) =>
      requestedReplay?.date === date && requestedReplay.snapshot.cutoff === window.cutoff ? requestedReplay :
        archiveDate === date ? archiveRecords[index] : null) : windows.map(window => {
      const eligible = verifiedDate && (verifiedDate < date || verifiedDate === date && window.minute <= clock.minute);
      const snapshot = eligible ? verifiedSnapshots.get(window.cutoff) : null;
      return snapshot ? { snapshot, contract: verifiedContract, date: verifiedDate, saved: verifiedDate !== date } : null;
    });
    const requested = replay ? windows.findIndex(window => window.minute === replayMinute(date)) : -1;
    const latest = requested >= 0 && records[requested] ? requested : records.findLastIndex(record => Boolean(record));
    const expected = Math.max(0, windows.findLastIndex(window => clock.date === date && clock.minute >= window.minute));
    let choice = latest >= 0 ? {index:latest,date:records[latest].date||date,record:records[latest]} : null;
    if (!replay && saved && (saved.date < date || saved.date === date && windows[saved.index].minute <= clock.minute) && newer(saved, choice)) choice = saved;
    if (ready && !replay && (!choice || choice.date !== date || choice.index < expected)) readSaved(clock, expected);
    const selected = choice?.index ?? expected;
    const forecastDate = choice?.date ?? date;
    const activeKey = forecastDate + ':' + selected + ':' + Boolean(choice);
    if (activeKey !== active || cards[selected].panel.hidden) {
      active = activeKey;
      board.dataset.cutoff = windows[selected].cutoff;
      cards[selected].windowTitle.prepend(marketPicker);
      cards[selected].period.append(label);
      cards.forEach((card, index) => {
        card.panel.hidden = index !== selected;
        if (card.panel.hidden) cancelForecastTextMotion(card.panel);
      });
      activeWindowChanged(choice ? windows[selected].minute : null, forecastDate);
    }
    {
      const index = selected;
      const card = cards[index];
      const { window } = card;
      const record = choice?.record;
      const settings = preferences(window.minute, forecastDate);
      const pending = !replay && clock.date === date && clock.minute < window.minute;
      const key = JSON.stringify([forecastDate, replay, record, settings, ready, pending, !record && Boolean(lookup)]);
      const needsNYInputs = index === 2 && record && !sameNYInputs(record.snapshot,forecastDate);
      if (card.key === key && !needsNYInputs) {
        refreshNYCode();
        updateFollowup(record, records, index, forecastDate, clock, replay);
        return;
      }
      cancelForecastTextMotion(card.panel);
      card.key = key;
      quickComparison.setForecast({ date: forecastDate, minute: window.minute, dates: null });
      card.record = record ? {...record, date:forecastDate} : null;
      card.code = '';
      card.copy.disabled = true;
      card.fallback.hidden = true;
      card.info.textContent = '';
      card.count.textContent = '';
      card.price.textContent = '—';
      card.avr.textContent = '—';
      showContainment(card, null);
      if (!record) {
        card.status.textContent = !ready ? 'Loading research…' : replay ? 'Checkpoint unavailable in archive' : lookup ? 'Loading saved checkpoint…' :
          pending ? 'Opens at ' + window.cutoff + ' NY' : 'Awaiting verified ' + window.cutoff + ' checkpoint';
        clearContext(card.context, !ready ? 'Loading historical observations…' : 'Compression & expansion will appear with this checkpoint.');
        updateFollowup(record, records, index, forecastDate, clock, replay);
        return;
      }
      const s = record.snapshot;
      card.price.textContent = String(s.reference_price);
      card.avr.textContent = Number(s.avr.toFixed(4)).toString();
      card.status.textContent = (replay ? 'Archive' : record.saved ? 'Saved TradingView' : 'TradingView') + ' · ' + record.contract +
        ' · ' + window.cutoff + ' NY' + (record.saved ? ' · ' + forecastDate : '');
      const q = snapshotFields(s, window, forecastDate, settings, mainInputPlan(s));
      void renderContext(card.context, q, { reveal: () => revealForecastText(card.panel) });
      if (index < 2) {
        try {
          const result = overnightEstimate(record, index, forecastDate);
          card.code = result.code;
          quickComparison.setForecast({ date: forecastDate, minute: window.minute, dates: result.dates });
          if (result.count) card.count.textContent = result.count.toLocaleString() + ' matched cases';
          showContainment(card, result);
        } catch { card.info.textContent = 'Forecast code unavailable'; }
        card.copy.disabled = !card.code;
      } else if (needsNYInputs || !record.forwarded && (replay || record.saved)) {
        const nyKey = JSON.stringify([forecastDate, replay, Boolean(record.saved), s]);
        if (nyKey !== appliedNY || !sameNYInputs(s,forecastDate)) {
          appliedNY = nyKey;
          applyArchivedNY(s, forecastDate, {verified:!replay || record.forwarded, saved:Boolean(record.saved)});
        }
      }
    }
    refreshNYCode();
    updateFollowup(choice?.record, records, selected, forecastDate, clock, replay);
  }

  function scheduleUpdate() {
    if (queued) return;
    queued = true;
    queueMicrotask(update);
  }

  document.addEventListener('sessionpath:verified-checkpoints', event => {
    if (event.detail.market !== market) return;
    livePacket = event.detail;
    const stamp = Date.parse(livePacket.observed_at);
    if (livePacket.snapshots.some(s => Date.parse(s.as_of) === stamp) && Number.isFinite(livePacket.last_price)) {
      exactCloses.set(stamp, livePacket.last_price);
      if (exactCloses.size > 6) exactCloses.delete(exactCloses.keys().next().value);
    }
    if (verifiedDate !== event.detail.session_date) {
      const index = windows.findLastIndex(window => verifiedSnapshots.has(window.cutoff));
      if (index >= 0 && verifiedDate < event.detail.session_date) {
        const previous = {index,date:verifiedDate,record:{date:verifiedDate,contract:verifiedContract,
          snapshot:verifiedSnapshots.get(windows[index].cutoff),saved:true}};
        if (newer(previous,saved)) saved = previous;
      }
      verifiedDate = event.detail.session_date;
      verifiedSnapshots.clear();
    }
    verifiedContract = event.detail.source_symbol;
    for (const snapshot of event.detail.snapshots) verifiedSnapshots.set(snapshot.cutoff, snapshot);
    scheduleUpdate();
  });
  document.addEventListener('sessionpath:verified-replay-checkpoint', event => {
    const {date,contract,snapshot} = event.detail || {};
    if (event.detail?.market !== market || !$('replay-toggle').checked || $('trading-date').value !== date ||
        !windows.some(window => window.cutoff === snapshot?.cutoff)) return;
    requestedReplay = {date,contract,snapshot,forwarded:true};
    scheduleUpdate();
  });
  document.addEventListener('sessionpath:forecast-export', event => {
    if (event.detail?.model?.query?.minute !== 510) return;
    nyModel = event.detail.model;
    refreshNYCode();
    scheduleUpdate();
  });
  document.addEventListener('change', scheduleUpdate, true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleUpdate(); });
  new MutationObserver(scheduleUpdate).observe(document.documentElement, { attributes: true, attributeFilter: ['data-startup'] });
  new MutationObserver(refreshNYCode).observe($('ny-reference'), { subtree: true, childList: true });
  const clockTimer = setInterval(scheduleUpdate, 30_000);
  window.addEventListener('pagehide', () => clearInterval(clockTimer), { once: true });
  for (const card of cards) {
    card.copy.addEventListener('click', async () => {
      if (!card.code) return;
      try {
        await navigator.clipboard.writeText(card.code);
        card.info.textContent = 'Copied';
      } catch {
        card.fallback.hidden = false;
        card.fallback.value = card.code;
        card.fallback.select();
        card.info.textContent = 'Code selected';
      }
    });
  }
  scheduleUpdate();
}
