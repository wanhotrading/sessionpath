import {createNewsPoller} from './news-poller.mjs?v=fast-news-20261022';
import {directionLabel} from './news-analysis.mjs?v=fast-news-20261022';
import {NEWS_SOURCES, loadNewsSource, filterNews, formatNewsTime} from './news-feed.mjs?v=fast-news-20261022';
import {createNewsAlertState, collectNewsAlerts, serializeNewsAlertState} from './news-alerts.mjs?v=fast-news-20261022';
import {createNewsWhistle} from './news-whistle.mjs';

const STORAGE_KEY = 'sessionpath-news-filters-v1';
const ALERT_PREFS_KEY = 'sessionpath-news-alert-prefs-v1';
const ALERT_STATE_KEY = 'sessionpath-news-alert-seen-v1';
const REFRESH_MS = 10_000;
const STALE_MS = 20 * 60_000;
const SOURCE_NAMES = Object.fromEntries(NEWS_SOURCES.map(source => [source.id,source.name]));
const TOPICS = new Set(['all', 'oil', 'geopolitics', 'indices', 'trump']);
const SOURCES = new Set(['all', ...Object.keys(SOURCE_NAMES)]);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function readFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      topic: TOPICS.has(saved.topic) ? saved.topic : 'all',
      source: SOURCES.has(saved.source) ? saved.source : 'all',
      search: typeof saved.search === 'string' ? saved.search.slice(0, 160) : ''
    };
  } catch {
    return {topic: 'all', source: 'all', search: ''};
  }
}

function storedJSON(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}

function safeHeadlineUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function newsTime(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Time unavailable';
  try { return formatNewsTime(value); }
  catch {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).format(new Date(value)) + ' ET';
  }
}

export function setupNewsDesk() {
  if (document.getElementById('news-desk-toggle')) return;
  const host = document.querySelector('.top-actions');
  if (!host) return;

  const filters = readFilters();
  const savedPreferences = storedJSON(ALERT_PREFS_KEY);
  const preferences = {alerts: savedPreferences?.alerts !== false, sound: savedPreferences?.sound === true};
  let alertState = createNewsAlertState(storedJSON(ALERT_STATE_KEY));
  const whistle = createNewsWhistle();
  let toastTimer = null;
  let toastHovered = false;
  let persistentToast = false;
  let queuedAlerts = [];
  const storedAudit = storedJSON('sessionpath-news-audit-v1');
  let audit = Array.isArray(storedAudit) ? storedAudit.filter(entry => entry.analysis?.source_name !== 'abcnews').slice(-300) : [];
  let feed = null;
  let poller = null;
  let activeItem = null;
  let lastWhistleAt = 0;
  let lastListSignature = null;
  let lastAttempt = 0;
  let loading = false;
  let failed = false;
  let backdropPointerDown = false;

  const trigger = element('button', 'quiet news-desk-toggle', 'News');
  trigger.id = 'news-desk-toggle';
  trigger.type = 'button';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', 'news-desk');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.title = 'Oil, US indices & policy headlines';
  host.prepend(trigger);

  const dialog = element('dialog', 'news-desk');
  dialog.id = 'news-desk';
  dialog.setAttribute('aria-labelledby', 'news-desk-title');
  dialog.setAttribute('aria-describedby', 'news-desk-description');

  const header = element('header', 'news-desk-header');
  const heading = element('div', 'news-desk-heading');
  heading.append(element('span', 'eyebrow', 'SESSIONPATH / NEWS'));
  const title = element('h2', '', 'Market catalysts');
  title.id = 'news-desk-title';
  const description = element('p', 'news-desk-description', 'Oil · US indices · Trump policy | Public feeds, not real-time');
  description.id = 'news-desk-description';
  heading.append(title, description);
  const close = element('button', 'news-desk-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close news');
  header.append(heading, close);

  const controls = element('div', 'news-desk-controls');
  const topics = element('div', 'news-topic-pills');
  topics.setAttribute('role', 'group');
  topics.setAttribute('aria-label', 'Headline topics');
  const topicButtons = new Map();
  for (const [value, label] of [['all', 'All relevant'], ['oil', 'Crude oil'], ['geopolitics', 'Geopolitics'], ['indices', 'US indices'], ['trump', 'Trump policy']]) {
    const button = element('button', 'news-topic-pill', label);
    button.type = 'button';
    button.dataset.topic = value;
    button.setAttribute('aria-pressed', String(value === filters.topic));
    button.addEventListener('click', () => {
      filters.topic = value;
      topicButtons.forEach((node, topic) => node.setAttribute('aria-pressed', String(topic === value)));
      saveFilters();
      render();
    });
    topicButtons.set(value, button);
    topics.append(button);
  }

  const fields = element('div', 'news-desk-fields');
  const sourceLabel = element('label', '', 'Source');
  const sourceSelect = element('select');
  sourceSelect.id = 'news-source';
  for (const [value, label] of [['all', 'All sources'], ...Object.entries(SOURCE_NAMES)]) {
    const option = element('option', '', label);
    option.value = value;
    sourceSelect.append(option);
  }
  sourceSelect.value = filters.source;
  sourceLabel.append(sourceSelect);
  const searchLabel = element('label', '', 'Find a headline');
  const search = element('input');
  search.id = 'news-search';
  search.type = 'search';
  search.placeholder = 'Oil, CPI, tariffs…';
  search.maxLength = 160;
  search.value = filters.search;
  search.autocomplete = 'off';
  searchLabel.append(search);
  fields.append(sourceLabel, searchLabel);
  const alertControls = element('div', 'news-alert-controls');
  const alertsToggle = element('button', 'news-alert-control');
  alertsToggle.type = 'button';
  alertsToggle.id = 'news-alerts-toggle';
  const soundToggle = element('button', 'news-alert-control');
  soundToggle.type = 'button';
  soundToggle.id = 'news-sound-toggle';
  const testAlert = element('button', 'news-alert-control', 'Test alert');
  testAlert.type = 'button';
  const alertHelp = element('p', 'news-alert-help');
  alertHelp.id = 'news-alert-help';
  for (const button of [alertsToggle, soundToggle, testAlert]) button.setAttribute('aria-describedby', alertHelp.id);
  const exportLog = element('button', 'news-alert-control', 'Export alert log');
  exportLog.type = 'button';
  exportLog.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({format:'sessionpath-news-audit-v1', records:audit.filter(entry => entry.analysis?.source_name !== 'abcnews')}, null, 2)], {type:'application/json'}));
    const link = element('a'); link.href = url; link.download = 'SessionPath-news-alert-log.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  alertControls.append(alertsToggle, soundToggle, testAlert, exportLog);
  controls.append(topics, fields, alertControls, alertHelp);

  const sourceStatus = element('div', 'news-source-status');
  sourceStatus.setAttribute('aria-label', 'Source freshness');
  const toolbar = element('div', 'news-desk-toolbar');
  const status = element('p', 'news-desk-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const refresh = element('button', 'quiet news-refresh', 'Refresh');
  refresh.type = 'button';
  toolbar.append(status, refresh);
  const notice = element('p', 'news-desk-notice');
  notice.hidden = true;
  const listArea = element('div', 'news-desk-list-area');
  listArea.setAttribute('aria-label', 'Filtered headlines');
  const footer = element('p', 'news-desk-footer', 'Rule-based interpretation · not a trading signal. Original statements and live speech are not independently monitored.');
  dialog.append(header, controls, sourceStatus, toolbar, notice, listArea, footer);
  document.body.append(dialog);

  // A manual popover sits above open dialogs without stealing keyboard focus.
  const toast = element('aside', 'news-alert-toast');
  toast.id = 'news-alert-toast';
  toast.hidden = true;
  toast.setAttribute('popover', 'manual');
  const toastMessage = element('div', 'news-alert-message');
  toastMessage.setAttribute('role', 'status');
  toastMessage.setAttribute('aria-live', 'polite');
  toastMessage.setAttribute('aria-atomic', 'true');
  const toastHeading = element('strong', 'news-alert-heading');
  const toastHeadline = element('a', 'news-alert-headline');
  toastHeadline.target = '_blank';
  toastHeadline.rel = 'noopener noreferrer';
  toastHeadline.dir = 'auto';
  const toastDetail = element('p', 'news-alert-detail');
  toastMessage.append(toastHeading, toastHeadline, toastDetail);
  const toastActions = element('div', 'news-alert-actions');
  const toastOpen = element('button', '', 'Open news');
  toastOpen.type = 'button';
  const toastDismiss = element('button', '', 'Dismiss');
  toastDismiss.type = 'button';
  toastDismiss.setAttribute('aria-label', 'Dismiss news alert');
  toastActions.append(toastOpen, toastDismiss);
  toast.append(toastMessage, toastActions);
  document.body.append(toast);
  const modalOrder = [...document.querySelectorAll('dialog[open]')];

  function savePreferences() {
    try { localStorage.setItem(ALERT_PREFS_KEY, JSON.stringify(preferences)); } catch {}
    renderAlertControls();
  }

  function saveSeen() {
    try { localStorage.setItem(ALERT_STATE_KEY, JSON.stringify(serializeNewsAlertState(alertState))); } catch {}
  }

  function silenceBaseline() {
    alertState = createNewsAlertState(serializeNewsAlertState(alertState));
  }

  function renderAlertControls() {
    alertsToggle.textContent = preferences.alerts ? 'Alerts on' : 'Alerts off';
    alertsToggle.setAttribute('aria-pressed', String(preferences.alerts));
    soundToggle.textContent = preferences.sound ? 'Whistle on' : 'Whistle muted';
    soundToggle.setAttribute('aria-pressed', String(preferences.sound));
    trigger.classList.toggle('has-news-alerts', preferences.alerts);
    trigger.title = 'Oil, US indices & policy headlines' + (preferences.alerts ? ' · alerts on' : '');
    alertHelp.textContent = preferences.alerts
      ? 'Fast checks: 10s · CNBC: 30s · ABC: 60s while visible. New alerts appear and whistle immediately when received; publishers may be delayed.' + (preferences.sound && !whistle.ready ? ' Click Test alert to enable sound.' : '')
      : 'Alerts are paused. Open News or refresh to read headlines.';
  }

  async function unlockSound() {
    if (!preferences.sound) return false;
    const ready = await whistle.unlock();
    renderAlertControls();
    return ready;
  }

  function hideToast() {
    persistentToast = false;
    clearTimeout(toastTimer);
    toastTimer = null;
    if (typeof toast.hidePopover === 'function' && toast.matches(':popover-open')) toast.hidePopover();
    toast.hidden = true;
  }

  function dismissLater() {
    clearTimeout(toastTimer);
    if (!persistentToast && !toastHovered && !toast.contains(document.activeElement)) toastTimer = setTimeout(nextQueuedAlert, 9000);
  }

  function positionToast() {
    if (toast.hidden) return;
    // A visible popover outside a modal is still inert. Keep it inside the
    // active dialog so its links and dismiss button remain usable.
    const focusedModal = document.activeElement?.closest?.('dialog[open]');
    const toastHost = focusedModal || modalOrder.filter(node => node.open).at(-1) || document.body;
    const popovers = typeof toast.showPopover === 'function';
    if (toast.parentElement !== toastHost) {
      if (popovers && toast.matches(':popover-open')) toast.hidePopover();
      toastHost.append(toast);
    }
    if (popovers) {
      try { if (!toast.matches(':popover-open')) toast.showPopover(); } catch {}
    }
  }

  function nextQueuedAlert() {
    hideToast(); activeItem = null;
    if (queuedAlerts.length) { const pending = queuedAlerts; queuedAlerts = []; showAlert(pending, {replay:true}); }
  }
  function showAlert(items, {test = false, replay = false} = {}) {
    if (!test && (!preferences.alerts || !items.length || document.hidden)) return;
    const ordered = [...items].sort((a,b) => (a.analysis?.priority || 'P2').localeCompare(b.analysis?.priority || 'P2'));
    const item = ordered[0];
    if (!test) {
      if (!replay && !toast.hidden && activeItem && activeItem.id !== item.id) queuedAlerts.push(activeItem);
      queuedAlerts.push(...ordered.slice(1));
      // Keep unresolved major alerts, with bounded deduplication by story version.
      queuedAlerts = [...new Map(queuedAlerts.filter(previous => previous.id !== item.id).map(previous => [previous.id,previous])).values()].slice(-50);
      activeItem = item;
    }
    persistentToast = !test && item?.analysis?.priority === 'P1';
    toastHeading.textContent = test ? 'Test news alert' : `${item.analysis?.priority || 'P2'} · ${item.analysis?.event_type || 'New matching headline'}${queuedAlerts.length ? ` · ${queuedAlerts.length} earlier alerts` : ''}`;
    toastHeadline.textContent = test ? 'Your market catalyst alerts are ready.' : item.title;
    const url = test ? null : safeHeadlineUrl(item.url);
    if (url) toastHeadline.href = url; else toastHeadline.removeAttribute('href');
    toastDetail.textContent = test
      ? (whistle.ready && preferences.sound ? 'Listen for the short whistle.' : preferences.sound ? 'Sound is unavailable in this browser. Popups still work.' : 'Whistle is muted. Popups still work.')
      : `${item.analysis ? directionLabel(item.analysis.direction) + ' · ' + item.analysis.rationale + ' ' : ''}${SOURCE_NAMES[item.source] || 'News'} · ${newsTime(item.publishedAt)}${ordered.length>1 ? ` · +${ordered.length-1} new in News` : ''}`;
    toast.hidden = false;
    positionToast();
    if (preferences.sound && !replay && (test || Date.now()-lastWhistleAt >= 3000)) { if (whistle.play()) lastWhistleAt = Date.now(); }
    dismissLater();
  }
  toastDismiss.addEventListener('click', nextQueuedAlert);
  toastOpen.addEventListener('click', () => { queuedAlerts=[]; activeItem=null; hideToast(); openNews(); });
  toast.addEventListener('mouseenter', () => { toastHovered = true; clearTimeout(toastTimer); });
  toast.addEventListener('mouseleave', () => { toastHovered = false; dismissLater(); });
  toast.addEventListener('focusin', () => clearTimeout(toastTimer));
  toast.addEventListener('focusout', () => queueMicrotask(dismissLater));
  alertsToggle.addEventListener('click', () => {
    preferences.alerts = !preferences.alerts;
    silenceBaseline();
    savePreferences();
    if (!preferences.alerts) { queuedAlerts = []; hideToast(); }
    else unlockSound();
    refreshNews();
  });
  soundToggle.addEventListener('click', () => {
    preferences.sound = !preferences.sound;
    savePreferences();
    if (preferences.sound) unlockSound();
  });
  testAlert.addEventListener('click', async () => {
    await unlockSound();
    showAlert([], {test: true});
  });
  // A normal user interaction unlocks browser audio; no microphone is used.
  function gestureSound(event) {
    if (!preferences.alerts || !preferences.sound || whistle.ready) return;
    if (event.type === 'keydown' && !['Enter', ' ', 'Tab'].includes(event.key)) return;
    unlockSound();
  }
  document.addEventListener('pointerdown', gestureSound, {passive: true});
  document.addEventListener('keydown', gestureSound);
  const modalObserver = new MutationObserver(records => {
    for (const record of records) if (record.target.tagName === 'DIALOG') {
      const index = modalOrder.indexOf(record.target);
      if (index !== -1) modalOrder.splice(index, 1);
      if (record.target.open) modalOrder.push(record.target);
    }
    if (!toast.hidden) positionToast();
  });
  modalObserver.observe(document.body, {subtree: true, attributes: true, attributeFilter: ['open']});
  renderAlertControls();

  function saveFilters() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(filters)); } catch {}
  }

  function scheduleRefresh() {
    if (!document.hidden && (dialog.open || preferences.alerts)) poller?.start();
    else poller?.stop();
  }
  function interruptRefresh() { poller?.stop(); loading = false; }
  function renderSources() {
    sourceStatus.replaceChildren();
    for (const [id, name] of Object.entries(SOURCE_NAMES)) {
      const source = feed?.sources?.find(entry => entry.id === id);
      const checkedMs = Date.parse(source?.fetchedAt || '');
      const old = Number.isFinite(checkedMs) && Date.now() - checkedMs > STALE_MS;
      const unavailable = source?.status === 'error';
      const stale = old || unavailable || failed;
      const card = element('div', 'news-source-card' + (stale ? ' is-stale' : ''));
      card.append(element('span', 'news-source-name', name));
      let label;
      if (unavailable || failed) label = 'Refresh unavailable';
      else if (!source) label = loading ? 'Checking…' : 'Not checked yet';
      else if (old) label = 'Last checked over 20 min ago';
      else label = source.status === 'ok' ? 'Connected' : 'Not available';
      card.append(element('span', 'news-source-state', label));
      if (unavailable && source.error) card.title=source.error;
      card.append(element('span','news-source-time',`Checks every ${(NEWS_SOURCES.find(entry => entry.id === id)?.pollMs || 10000)/1000}s`));
      if (source?.latestAt) card.append(element('span', 'news-source-time', 'Latest match ' + newsTime(source.latestAt)));
      if (source?.fetchedAt) card.append(element('span','news-source-time','Checked '+new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(source.fetchedAt))+' ET'));
      sourceStatus.append(card);
    }
  }

  function emptyState(titleText, detailText, retry = false) {
    const empty = element('div', 'news-desk-empty');
    empty.append(element('h3', '', titleText), element('p', '', detailText));
    if (retry) {
      const button = element('button', 'quiet', 'Try again');
      button.type = 'button';
      button.disabled = loading;
      button.addEventListener('click', refreshNews);
      empty.append(button);
    }
    listArea.append(empty);
  }

  function render() {
    renderSources();
    refresh.disabled = poller?.snapshot().pending.length === NEWS_SOURCES.length;
    refresh.textContent = refresh.disabled ? 'Checking…' : 'Refresh';
    listArea.setAttribute('aria-busy', String(loading));
    const allFailed = feed?.sources?.length > 0 && feed.sources.every(source => source.status === 'error');
    const partialFailure = feed?.sources?.some(source => source.status === 'error');
    notice.hidden = !failed && !partialFailure;
    notice.textContent = failed || allFailed
      ? 'Headlines could not be refreshed. Any saved headlines below may be out of date.'
      : 'Some sources are unavailable. Headlines from connected sources are still shown.';

    const rawItems = (Array.isArray(feed?.items) ? feed.items : []).filter(item => item.source !== 'abcnews' || Date.parse(item.publishedAt) >= Date.now()-7*86400000);
    const relevantItems = rawItems.filter(item => Array.isArray(item.categories) && item.categories.some(category => ['oil', 'geopolitics', 'indices', 'trump'].includes(category)));
    const items = filterNews(relevantItems, filters)
      .filter(item => safeHeadlineUrl(item.url))
      .sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
    const updated = feed?.fetchedAt ? ' · Checked ' + newsTime(feed.fetchedAt) : '';
    const availability = failed || allFailed ? 'Refresh unavailable · ' : partialFailure ? 'Some sources unavailable · ' : '';
    status.textContent = loading && !feed ? 'Loading relevant headlines…'
      : `${availability}${items.length} ${items.length === 1 ? 'headline' : 'headlines'}${updated}`;
    const signature = JSON.stringify([items.map(item=>[item.id,item.title,item.analysis?.event_version]),filters,Boolean(feed),failed,allFailed]);
    if (lastListSignature === signature) return;
    lastListSignature = signature;
    const oldScroll = listArea.scrollTop;
    const expanded = new Set([...listArea.querySelectorAll('li[data-story-id]')].filter(row=>row.querySelector('details[open]')).map(row=>row.dataset.storyId));
    listArea.replaceChildren();

    if (!feed && loading) {
      emptyState('Checking the news desk', 'Looking for oil, geopolitical, US-index and Trump-policy headlines.');
      return;
    }
    if (!items.length) {
      if (failed || allFailed) emptyState('News is temporarily unavailable', 'Try again in a moment. Your forecast inputs are unchanged.', true);
      else if (filters.search || filters.topic !== 'all' || filters.source !== 'all') {
        emptyState('No matching headlines', 'Try another keyword, topic or source.');
        const clear = element('button', 'quiet news-clear-filters', 'Clear filters');
        clear.type = 'button';
        clear.addEventListener('click', () => {
          Object.assign(filters, {topic: 'all', source: 'all', search: ''});
          sourceSelect.value = 'all';
          search.value = '';
          topicButtons.forEach((node, topic) => node.setAttribute('aria-pressed', String(topic === 'all')));
          saveFilters();
          render();
        });
        listArea.firstElementChild.append(clear);
      } else emptyState('No relevant headlines right now', 'This desk shows oil, geopolitical, US-index and Trump-policy news. Refresh to check again.');
      return;
    }

    const list = element('ol', 'news-headline-list');
    for (const item of items) {
      const row = element('li', 'news-headline'); row.dataset.storyId = item.id;
      const meta = element('div', 'news-headline-meta');
      meta.append(element('span', 'news-headline-source', SOURCE_NAMES[item.source] || 'News source'));
      const time = element('time', 'news-headline-time', newsTime(item.publishedAt));
      if (Number.isFinite(Date.parse(item.publishedAt))) time.dateTime = item.publishedAt;
      meta.append(time);
      const link = element('a', 'news-headline-link', item.title || 'Open headline');
      link.href = safeHeadlineUrl(item.url);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.dir = 'auto';
      const arrow = element('span', 'news-headline-arrow', '↗');
      arrow.setAttribute('aria-hidden', 'true');
      link.append(arrow);
      const categories = element('div', 'news-headline-categories');
      for (const category of ['oil', 'geopolitics', 'indices', 'trump']) if (item.categories.includes(category)) {
        categories.append(element('span', 'news-category news-category-' + category, ({oil:'Crude oil',geopolitics:'Geopolitics',indices:'US indices',trump:'Trump policy'})[category]));
      }
      row.append(meta, link, categories);
      const a = item.analysis;
      if (a) {
        const summary = element('div', 'news-event-summary');
        summary.dataset.priority = a.priority;
        summary.append(element('strong', '', `${a.priority} · ${a.event_type}`), element('span', '', `${directionLabel(a.direction)} · ${a.policy_status}${a.delayed ? ' · Delayed' : ''}`), element('p', '', a.rationale));
        if (a.numbers) summary.append(element('p', 'news-event-numbers', `Actual ${a.numbers.actual} / expected ${a.numbers.consensus ?? 'unavailable'} / surprise ${a.numbers.surprise ?? 'unavailable'} ${a.numbers.unit}`));
        const details = element('details', 'news-event-details'); details.open = expanded.has(item.id);
        details.append(element('summary', '', 'Evidence & uncertainty'));
        for (const value of [`Assets: ${Object.entries(a.direction_by_asset).map(([asset, direction]) => asset + ': ' + directionLabel(direction)).join('; ')}`, `Source: ${a.source_authenticity}`, `Evidence: ${a.evidence_excerpt}`, `Received: ${newsTime(a.received_at_utc)}`, `Version: ${a.event_version || 1} · ${a.novelty || 'Publisher headline'}`, `Missing: ${a.missing_fields.join('; ')}`, ...a.invalidation_checks, ...(a.previous_headlines || []).map(v => 'Previous wording: ' + v)]) details.append(element('p', '', value));
        if (item.source === 'abcnews') summary.append(element('p','','Headlines supplied by ABCNEWS.com. Copyright © ABC, Inc.'));
        row.append(summary, details);
      }
      list.append(row);
    }
    listArea.append(list); listArea.scrollTop = oldScroll;
  }

  function receiveSource(result) {
    const id = result.source.id;
    const next = {items:result.items,sources:[result.source],fetchedAt:result.source.fetchedAt};
    const retained = (feed?.items || []).filter(item => item.source !== id || result.source.status !== 'ok');
    const receivedAlerts = collectNewsAlerts(alertState, next);
    alertState = receivedAlerts.state; saveSeen();
    const reports = new Map((feed?.sources || []).map(source=>[source.id,source])); reports.set(id,result.source);
    feed = {items:[...receivedAlerts.items,...retained], sources:[...reports.values()], fetchedAt:next.fetchedAt};
    failed=false;
    const matchedAlerts = filterNews(receivedAlerts.newItems, filters).filter(item=>safeHeadlineUrl(item.url));
    const eligible = new Set(matchedAlerts.map(item=>item.id));
    for (const item of receivedAlerts.items) {
      if (item.source === 'abcnews') continue; // Publisher permits current display, not a permanent archive.
      const previous = audit.findLast(entry=>entry.story_id === item.id);
      if (previous?.headline === item.title) continue;
      audit.push({story_id:item.id,headline:item.title,recorded_at_utc:new Date().toISOString(),analysis:item.analysis,popup_eligible:preferences.alerts && eligible.has(item.id),decision:eligible.has(item.id)?'Eligible for popup':'Silent baseline, duplicate, stale, feed-only or filtered'});
    }
    audit=audit.slice(-300);try{localStorage.setItem('sessionpath-news-audit-v1',JSON.stringify(audit));}catch{}
    render(); showAlert(matchedAlerts);
  }
  function refreshNews() {
    if (document.hidden || (!dialog.open && !preferences.alerts)) return;
    lastAttempt=Date.now(); poller?.start(); poller?.refresh();
  }
  function openNews() {
    unlockSound();
    for (const openDialog of document.querySelectorAll('dialog[open]')) if (openDialog !== dialog) openDialog.close();
    if (!dialog.open) dialog.showModal();
    trigger.setAttribute('aria-expanded', 'true');
    render();
    close.focus({preventScroll: true});
    if (!feed || Date.now() - lastAttempt >= REFRESH_MS) refreshNews();
    else scheduleRefresh();
  }
  trigger.addEventListener('click', openNews);
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    trigger.setAttribute('aria-expanded', 'false');
    positionToast();
    if (preferences.alerts) scheduleRefresh(); else interruptRefresh();
  });
  // The backdrop's event target is the dialog itself. Use its rectangle so a
  // click on the drawer's padding does not accidentally close the drawer.
  function isBackdrop(event) {
    if (event.target !== dialog) return false;
    const rect = dialog.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  }
  dialog.addEventListener('pointerdown', event => { backdropPointerDown = isBackdrop(event); });
  dialog.addEventListener('click', event => {
    if (backdropPointerDown && isBackdrop(event)) dialog.close();
    backdropPointerDown = false;
  });
  sourceSelect.addEventListener('change', () => { filters.source = sourceSelect.value; saveFilters(); render(); });
  search.addEventListener('input', () => { filters.search = search.value; saveFilters(); render(); });
  refresh.addEventListener('click', refreshNews);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { queuedAlerts = []; hideToast(); interruptRefresh(); silenceBaseline(); }
    else if (dialog.open || preferences.alerts) {
      render();
      if (!feed || Date.now() - lastAttempt >= REFRESH_MS) refreshNews();
      else scheduleRefresh();
    }
  });
  window.addEventListener('pagehide', () => { hideToast(); interruptRefresh(); silenceBaseline(); });
  window.addEventListener('pageshow', event => {
    if (event.persisted && (dialog.open || preferences.alerts)) refreshNews();
  });
  poller = createNewsPoller({sources:NEWS_SOURCES,loadSource:loadNewsSource,onResult:receiveSource,onActivity:pending=>{
    loading=pending.length>0;
    refresh.disabled=pending.length===NEWS_SOURCES.length; refresh.textContent=refresh.disabled?'Checking…':'Refresh';
    listArea.setAttribute('aria-busy',String(loading));
  }});
  if (preferences.alerts && !document.hidden) refreshNews();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupNewsDesk, {once: true});
else setupNewsDesk();
