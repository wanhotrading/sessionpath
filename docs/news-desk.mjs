import {loadNews, filterNews, formatNewsTime} from './news-feed.mjs';

const STORAGE_KEY = 'sessionpath-news-filters-v1';
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
  controls.append(topics, fields);

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

  function saveFilters() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(filters)); } catch {}
  }

  function stopRefresh() {
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  function scheduleRefresh() {
    stopRefresh();
    if (!dialog.open || document.hidden) return;
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
    if (controller || !dialog.open || document.hidden) return;
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

  trigger.addEventListener('click', () => {
    for (const openDialog of document.querySelectorAll('dialog[open]')) if (openDialog !== dialog) openDialog.close();
    if (!dialog.open) dialog.showModal();
    trigger.setAttribute('aria-expanded', 'true');
    render();
    close.focus({preventScroll: true});
    if (!feed || Date.now() - lastAttempt >= REFRESH_MS) refreshNews();
    else scheduleRefresh();
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    trigger.setAttribute('aria-expanded', 'false');
    interruptRefresh();
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
    if (document.hidden) interruptRefresh();
    else if (dialog.open) {
      render();
      if (!feed || Date.now() - lastAttempt >= REFRESH_MS) refreshNews();
      else scheduleRefresh();
    }
  });
  window.addEventListener('pagehide', interruptRefresh);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupNewsDesk, {once: true});
else setupNewsDesk();
