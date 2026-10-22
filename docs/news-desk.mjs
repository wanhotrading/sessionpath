import {loadNews, filterNews, formatNewsTime} from './news-feed.mjs';
import {createNewsAlertState, collectNewsAlerts, serializeNewsAlertState} from './news-alerts.mjs';
import {createNewsWhistle} from './news-whistle.mjs';

const STORAGE_KEY = 'sessionpath-news-filters-v1';
const ALERT_PREFS_KEY = 'sessionpath-news-alert-prefs-v1';
const ALERT_STATE_KEY = 'sessionpath-news-alert-seen-v1';
const REFRESH_MS = 120_000;
const STALE_MS = 20 * 60_000;
const SOURCE_NAMES = {financialjuice: 'FinancialJuice', wallstreetcn: 'WallstreetCN · 华尔街见闻'};
const TOPICS = new Set(['all', 'oil', 'geopolitics']);
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
  const preferences = {alerts: savedPreferences?.alerts !== false, sound: savedPreferences?.sound !== false};
  let alertState = createNewsAlertState(storedJSON(ALERT_STATE_KEY));
  const whistle = createNewsWhistle();
  let toastTimer = null;
  let toastHovered = false;
  let feed = null;
  let controller = null;
  let refreshTimer = null;
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
  trigger.title = 'Crude oil & geopolitical headlines';
  host.prepend(trigger);

  const dialog = element('dialog', 'news-desk');
  dialog.id = 'news-desk';
  dialog.setAttribute('aria-labelledby', 'news-desk-title');
  dialog.setAttribute('aria-describedby', 'news-desk-description');

  const header = element('header', 'news-desk-header');
  const heading = element('div', 'news-desk-heading');
  heading.append(element('span', 'eyebrow', 'SESSIONPATH / NEWS'));
  const title = element('h2', '', 'Oil & geopolitics');
  title.id = 'news-desk-title';
  const description = element('p', 'news-desk-description', 'Public headlines · may be delayed');
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
  for (const [value, label] of [['all', 'All relevant'], ['oil', 'Crude oil'], ['geopolitics', 'Geopolitics']]) {
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
  for (const [value, label] of [['all', 'Both sources'], ...Object.entries(SOURCE_NAMES)]) {
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
  search.placeholder = 'Oil, OPEC, tensions…';
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
  alertControls.append(alertsToggle, soundToggle, testAlert);
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
  const footer = element('p', 'news-desk-footer', 'English / 中文 headline filters · forecasts stay unchanged.');
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
    trigger.title = 'Crude oil & geopolitical headlines' + (preferences.alerts ? ' · alerts on' : '');
    alertHelp.textContent = preferences.alerts
      ? 'Popups follow your filters. Checks every 2 min while this page is visible.' + (preferences.sound && !whistle.ready ? ' Click Test alert to enable sound.' : '')
      : 'Alerts are paused. Open News or refresh to read headlines.';
  }

  async function unlockSound() {
    if (!preferences.sound) return false;
    const ready = await whistle.unlock();
    renderAlertControls();
    return ready;
  }

  function hideToast() {
    clearTimeout(toastTimer);
    toastTimer = null;
    if (typeof toast.hidePopover === 'function' && toast.matches(':popover-open')) toast.hidePopover();
    toast.hidden = true;
  }

  function dismissLater() {
    clearTimeout(toastTimer);
    if (!toastHovered && !toast.contains(document.activeElement)) toastTimer = setTimeout(hideToast, 9000);
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

  function showAlert(items, {test = false} = {}) {
    if (!test && (!preferences.alerts || !items.length || document.hidden)) return;
    const item = items[0];
    toastHeading.textContent = test ? 'Test news alert' : items.length > 1 ? `${items.length} new matching headlines` : 'New matching headline';
    toastHeadline.textContent = test ? 'Your oil & geopolitics alerts are ready.' : item.title;
    const url = test ? null : safeHeadlineUrl(item.url);
    if (url) toastHeadline.href = url; else toastHeadline.removeAttribute('href');
    toastDetail.textContent = test
      ? (whistle.ready && preferences.sound ? 'Listen for the short whistle.' : preferences.sound ? 'Sound is unavailable in this browser. Popups still work.' : 'Whistle is muted. Popups still work.')
      : `${SOURCE_NAMES[item.source] || 'News'} · ${newsTime(item.publishedAt)}${items.length > 1 ? ` · +${items.length - 1} more in News` : ''}`;
    toast.hidden = false;
    positionToast();
    if (preferences.sound) whistle.play();
    dismissLater();
  }

  toastDismiss.addEventListener('click', hideToast);
  toastOpen.addEventListener('click', () => { hideToast(); openNews(); });
  toast.addEventListener('mouseenter', () => { toastHovered = true; clearTimeout(toastTimer); });
  toast.addEventListener('mouseleave', () => { toastHovered = false; dismissLater(); });
  toast.addEventListener('focusin', () => clearTimeout(toastTimer));
  toast.addEventListener('focusout', () => queueMicrotask(dismissLater));
  alertsToggle.addEventListener('click', () => {
    preferences.alerts = !preferences.alerts;
    silenceBaseline();
    savePreferences();
    if (!preferences.alerts) hideToast();
    else unlockSound();
    if (!controller) refreshNews();
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

  function stopRefresh() {
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  function scheduleRefresh() {
    stopRefresh();
    if ((!dialog.open && !preferences.alerts) || document.hidden) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refreshNews();
    }, Math.max(1000, REFRESH_MS - (Date.now() - lastAttempt)));
  }

  function interruptRefresh() {
    stopRefresh();
    if (controller) controller.abort();
    controller = null;
    loading = false;
  }

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
      if (source?.latestAt) card.append(element('span', 'news-source-time', 'Latest match ' + newsTime(source.latestAt)));
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
    refresh.disabled = loading;
    refresh.textContent = loading ? 'Refreshing…' : 'Refresh';
    listArea.setAttribute('aria-busy', String(loading));
    const allFailed = feed?.sources?.length > 0 && feed.sources.every(source => source.status === 'error');
    const partialFailure = feed?.sources?.some(source => source.status === 'error');
    notice.hidden = !failed && !partialFailure;
    notice.textContent = failed || allFailed
      ? 'Headlines could not be refreshed. Any saved headlines below may be out of date.'
      : 'One source is unavailable. Headlines from the other source are still shown.';

    const rawItems = Array.isArray(feed?.items) ? feed.items : [];
    const relevantItems = rawItems.filter(item => Array.isArray(item.categories) && item.categories.some(category => category === 'oil' || category === 'geopolitics'));
    const items = filterNews(relevantItems, filters)
      .filter(item => safeHeadlineUrl(item.url))
      .sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
    const updated = feed?.fetchedAt ? ' · Checked ' + newsTime(feed.fetchedAt) : '';
    const availability = failed || allFailed ? 'Refresh unavailable · ' : partialFailure ? 'One source unavailable · ' : '';
    status.textContent = loading && !feed ? 'Loading relevant headlines…'
      : `${availability}${items.length} ${items.length === 1 ? 'headline' : 'headlines'}${updated}`;
    listArea.replaceChildren();

    if (!feed && loading) {
      emptyState('Checking the news desk', 'Looking for crude oil and geopolitical headlines.');
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
      } else emptyState('No relevant headlines right now', 'This desk only shows crude oil and geopolitical news. Refresh to check again.');
      return;
    }

    const list = element('ol', 'news-headline-list');
    for (const item of items) {
      const row = element('li', 'news-headline');
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
      for (const category of ['oil', 'geopolitics']) if (item.categories.includes(category)) {
        categories.append(element('span', 'news-category news-category-' + category, category === 'oil' ? 'Crude oil' : 'Geopolitics'));
      }
      row.append(meta, link, categories);
      list.append(row);
    }
    listArea.append(list);
  }

  async function refreshNews() {
    if (controller || (!dialog.open && !preferences.alerts) || document.hidden) return;
    stopRefresh();
    const currentController = new AbortController();
    controller = currentController;
    lastAttempt = Date.now();
    loading = true;
    render();
    try {
      const next = await loadNews({signal: currentController.signal});
      if (controller !== currentController || currentController.signal.aborted) return;
      if (!next || !Array.isArray(next.items) || !Array.isArray(next.sources)) throw new Error('Invalid news response');
      // Keep the last successful headlines for a source that temporarily fails.
      // Their source card remains visibly unavailable instead of implying freshness.
      const failedSources = new Set(next.sources.filter(source => source.status === 'error').map(source => source.id));
      const received = new Set(next.items.map(item => item.source + ':' + item.id));
      const retained = (feed?.items || []).filter(item => failedSources.has(item.source) && !received.has(item.source + ':' + item.id));
      feed = {
        ...next,
        items: [...next.items, ...retained],
        sources: next.sources.map(source => source.status === 'error'
          ? {...source, latestAt: source.latestAt || feed?.sources?.find(previous => previous.id === source.id)?.latestAt}
          : source)
      };
      failed = false;
      const receivedAlerts = collectNewsAlerts(alertState, next);
      alertState = receivedAlerts.state;
      saveSeen();
      showAlert(filterNews(receivedAlerts.newItems, filters).filter(item => safeHeadlineUrl(item.url)));
    } catch (error) {
      if (controller !== currentController || currentController.signal.aborted || error?.name === 'AbortError') return;
      failed = true;
    } finally {
      if (controller === currentController) {
        controller = null;
        loading = false;
        render();
        scheduleRefresh();
      }
    }
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
    if (document.hidden) { hideToast(); interruptRefresh(); silenceBaseline(); }
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
  if (preferences.alerts && !document.hidden) refreshNews();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupNewsDesk, {once: true});
else setupNewsDesk();
