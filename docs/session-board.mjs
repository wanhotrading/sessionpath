const windows = [
  { cutoff: '03:00', end: '05:00', minute: 180, endMinute: 300 },
  { cutoff: '05:00', end: '08:30', minute: 300, endMinute: 510 },
  { cutoff: '08:30', end: '16:00', minute: 510, endMinute: 960 },
];

const $ = id => document.getElementById(id);

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function snapshotFields(snapshot, window, date, preferences, plan) {
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
  const context = node('aside', 'forecast-context');
  const containment = node('dl', 'session-board-containment');
  const containmentLabel = node('dt', '', 'Stayed within the mean U/D box');
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
  panel.append(heading, status, checks, containment, context, exportRow);
  panel.hidden = true;
  return { window, panel, status, price, avr, context, copy, count, info, fallback, containmentValue, containmentSample, code: '', key: '' };
}

function showContainment(card, result) {
  const hasCases = result?.n > 0 && Number.isFinite(result.coverage);
  card.containmentValue.textContent = hasCases ? (100 * result.coverage).toFixed(1) + '%' : '—';
  card.containmentSample.textContent = hasCases ? result.inside + '/' + result.n + ' historical windows' : '';
}

export function mountSessionBoard({ market, nyClock, mainInputPlan, archive, preferences, estimate, applyArchivedNY, renderContext, clearContext, activeWindowChanged, replayMinute }) {
  const board = node('section', 'session-board');
  board.id = 'session-board';
  board.setAttribute('aria-labelledby', 'session-board-title');
  const header = node('div', 'session-board-header');
  const intro = node('div');
  const title = node('h1', '', 'Session forecasts');
  title.id = 'session-board-title';
  const dateLabel = node('p', 'session-board-date');
  intro.append(title, dateLabel);
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
  label.firstChild.textContent = 'Overnight sample';
  actions.append(backToday, label);
  header.append(intro, actions);
  const grid = node('div', 'session-board-grid');
  const cards = windows.map(newCard);
  const paths = $('sessions-section');
  grid.append(...cards.map(card => card.panel), paths);
  board.append(header, grid);
  $('workspace').prepend(board);

  // Keep the original Auto-fill action and feedback connected to its existing handlers.
  const placeAutoFill = () => {
    const row = $('personal-auto-fill-row');
    if (!row) return false;
    actions.prepend(row);
    return true;
  };
  if (!placeAutoFill()) {
    const observer = new MutationObserver(() => {
      if (placeAutoFill()) observer.disconnect();
    });
    observer.observe($('scenario-form'), { childList: true });
  }

  const nav = document.querySelector('.topbar nav');
  const tools = $('workspace-tools-toggle');
  tools.textContent = 'Tools';
  nav.replaceChildren(...[['Forecasts', 'session-board'], ['BBOX return', 'bbox-return-details'], ['Paths', 'sessions-section']].map(([text, id]) => {
    const link = node('a', '', text);
    link.href = '#' + id;
    if (id === 'bbox-return-details') link.addEventListener('click', () => { $(id).open = true; });
    return link;
  }), tools);
  document.querySelector('.topbar .brand').href = '#session-board';
  document.body.classList.add('session-board-active');
  $('indicator-section').hidden = true;

  let verifiedDate = '';
  let verifiedContract = '';
  const verifiedSnapshots = new Map();
  let queued = false;
  let archiveDate = '';
  let archiveRecords = [];
  let appliedNY = '';
  let nyModel;
  let active;
  const nyCard = cards.at(-1);
  function refreshNYCode() {
    if (nyCard.panel.hidden || !nyCard.key || !nyCard.record) return;
    const snapshot = nyCard.record.snapshot;
    const verifiedInputs = $('ny-date')?.value === $('trading-date').value && $('ny-end')?.value === '960' &&
      [['ny-price', snapshot.reference_price], ['ny-avr', snapshot.avr], ['ny-range-high', snapshot.range_high], ['ny-range-low', snapshot.range_low]]
        .every(([id, value]) => Math.abs(Number($(id)?.value) - value) < 1e-7);
    nyCard.code = verifiedInputs && !$('ny-copy')?.disabled ? $('ny-code')?.value || '' : '';
    nyCard.copy.disabled = !nyCard.code;
    const cohortDisplay = $('ny-results')?.querySelector('.ny-cohort strong');
    nyCard.count.textContent = verifiedInputs ? cohortDisplay?.textContent || '' : '';
    const q = nyModel?.query;
    const matchingModel = verifiedInputs && cohortDisplay && q?.date === $('trading-date').value && q.minute === 510 && q.endMinute === 960 &&
      [['price', snapshot.reference_price], ['avr', snapshot.avr], ['rangeHigh', snapshot.range_high], ['rangeLow', snapshot.range_low]]
        .every(([key, value]) => Math.abs(q[key] - value) < 1e-7);
    showContainment(nyCard, matchingModel ? nyModel.box : null);
  }

  function update() {
    queued = false;
    const date = $('trading-date').value;
    const replay = $('replay-toggle').checked;
    const clock = nyClock();
    const ready = document.documentElement.dataset.startup === 'ready';
    const live = !replay && verifiedDate === date;
    backToday.hidden = !replay;
    dateLabel.textContent = [market, date, 'New York time', replay ? 'Replay' : 'Today'].filter(Boolean).join(' · ');
    if (ready && replay && archiveDate !== date) {
      archiveDate = date;
      archiveRecords = windows.map(window => archive({ ...window, market, date }));
    }
    const records = replay ? (archiveDate === date ? archiveRecords : []) : windows.map(({ cutoff }) => {
      const snapshot = live ? verifiedSnapshots.get(cutoff) : null;
      return snapshot ? { snapshot, contract: verifiedContract } : null;
    });
    const requested = replay ? windows.findIndex(window => window.minute === replayMinute(date)) : -1;
    const latest = requested >= 0 && records[requested] ? requested : records.findLastIndex(record => Boolean(record));
    const expected = Math.max(0, windows.findLastIndex(window => clock.date === date && clock.minute >= window.minute));
    const selected = latest >= 0 ? latest : expected;
    const activeKey = date + ':' + selected + ':' + (latest >= 0);
    if (activeKey !== active || cards[selected].panel.hidden) {
      active = activeKey;
      board.dataset.cutoff = windows[selected].cutoff;
      cards.forEach((card, index) => { card.panel.hidden = index !== selected; });
      activeWindowChanged(latest >= 0 ? windows[selected].minute : null, date);
    }
    {
      const index = selected;
      const card = cards[index];
      const { window } = card;
      const record = records[index];
      const settings = preferences(window.minute, date);
      const pending = !replay && clock.date === date && clock.minute < window.minute;
      const key = JSON.stringify([date, replay, record, settings, ready, pending]);
      if (card.key === key) { refreshNYCode(); return; }
      card.key = key;
      card.record = record;
      card.code = '';
      card.copy.disabled = true;
      card.fallback.hidden = true;
      card.info.textContent = '';
      card.count.textContent = '';
      card.price.textContent = '—';
      card.avr.textContent = '—';
      showContainment(card, null);
      if (!record) {
        card.status.textContent = !ready ? 'Loading research…' : replay ? 'Checkpoint unavailable in archive' :
          pending ? 'Opens at ' + window.cutoff + ' NY' : 'Awaiting verified ' + window.cutoff + ' checkpoint';
        clearContext(card.context, !ready ? 'Loading historical observations…' : 'Compression & expansion will appear with this checkpoint.');
        return;
      }
      const s = record.snapshot;
      card.price.textContent = String(s.reference_price);
      card.avr.textContent = Number(s.avr.toFixed(4)).toString();
      card.status.textContent = (replay ? 'Archive' : 'TradingView') + ' · ' + record.contract + ' · ' + window.cutoff + ' NY';
      const q = snapshotFields(s, window, date, settings, mainInputPlan(s));
      void renderContext(card.context, q);
      if (index < 2) {
        try {
          const result = estimate(q);
          card.code = result.code;
          if (result.count) card.count.textContent = result.count.toLocaleString() + ' matched cases';
          showContainment(card, result);
        } catch { card.info.textContent = 'Forecast code unavailable'; }
        card.copy.disabled = !card.code;
      } else if (replay && date !== appliedNY) {
        appliedNY = date;
        applyArchivedNY(s, date);
      }
    }
    if (!replay) appliedNY = '';
    refreshNYCode();
  }

  function scheduleUpdate() {
    if (queued) return;
    queued = true;
    queueMicrotask(update);
  }

  document.addEventListener('sessionpath:verified-checkpoints', event => {
    if (event.detail.market !== market) return;
    if (verifiedDate !== event.detail.session_date) {
      verifiedDate = event.detail.session_date;
      verifiedSnapshots.clear();
    }
    verifiedContract = event.detail.source_symbol;
    for (const snapshot of event.detail.snapshots) verifiedSnapshots.set(snapshot.cutoff, snapshot);
    scheduleUpdate();
  });
  document.addEventListener('sessionpath:forecast-export', event => {
    if (event.detail?.model?.query?.minute !== 510) return;
    nyModel = event.detail.model;
    refreshNYCode();
  });
  document.addEventListener('change', scheduleUpdate, true);
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
