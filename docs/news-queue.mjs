const STORAGE_KEY = 'sessionpath-news-unread-v1';

export function mountUnreadNews({toast, heading, summary, detail, trigger, unreadButton, newsTime, textFor, sourceNames, safeUrl, onEmpty}) {
  const items = new Map();
  const cards = new Map();
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const controls = make('div', 'news-queue-controls');
  const arrow = (text, label) => {
    const button = make('button', 'news-queue-step', text);
    button.type = 'button';
    button.setAttribute('aria-label', label);
    return button;
  };
  const previous = arrow('↑', 'Previous unread headline');
  const next = arrow('↓', 'Next unread headline');
  const clear = make('button', 'news-queue-clear', 'Mark all read');
  clear.type = 'button';
  controls.append(previous, next, clear);

  const list = make('ol', 'news-unread-carousel');
  list.setAttribute('aria-label', 'Unread headlines');
  list.tabIndex = 0;
  toast.append(controls, list);
  let testing = false;

  function entry(item) {
    const url = safeUrl(item?.url);
    const title = item?.title && textFor(item);
    if (!url || typeof item.id !== 'string' || typeof title !== 'string' || !title.trim()) return null;
    const author = item.sources?.[0]?.author ?? item.author;
    return {
      id: item.id, source: item.source, transport: item.transport,
      title, url, publishedAt: item.publishedAt,
      receivedAt: item.receivedAt,
      author: typeof author === 'string' && /^[a-z0-9_]{1,15}$/i.test(author) ? author : '',
      markets: Array.isArray(item.markets) ? item.markets.filter(market => ['CL', 'NQ', 'ES', 'GC'].includes(market)) : [],
      rationale: String(item.analysis?.rationale ?? item.rationale ?? '').slice(0, 350),
      event: String(item.analysis?.event_type ?? item.event ?? '').slice(0, 90)
    };
  }
  try {
    for (const value of JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]')) {
      const item = entry(value);
      if (item) items.set(item.id, item);
    }
  } catch {}

  function scrollState() {
    const above = list.scrollTop > 2;
    const below = list.scrollHeight - list.clientHeight - list.scrollTop > 2;
    list.classList.toggle('can-scroll-up', above);
    list.classList.toggle('can-scroll-down', below);
    previous.disabled = !above;
    next.disabled = !below;
  }
  function move(direction) {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('motion-paused');
    list.scrollBy({top: direction * Math.max(76, list.clientHeight * .72), behavior: reduced ? 'instant' : 'smooth'});
  }
  previous.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  list.addEventListener('scroll', scrollState, {passive: true});
  if (typeof ResizeObserver === 'function') new ResizeObserver(scrollState).observe(list);

  function save() {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...items.values()])); } catch {}
  }
  function discard(predicate) {
    for (const [id, item] of items) if (predicate(item)) items.delete(id);
    save();
    render();
    if (!items.size && !testing) onEmpty();
  }
  clear.addEventListener('click', () => discard(() => true));

  function card(item) {
    const row = make('li', item.source === 'grok' ? 'news-queue-card news-queue-grok' : 'news-queue-card');
    const top = make('div', 'news-queue-byline');
    const name = item.author ? '@' + item.author : sourceNames[item.source] || 'News';
    if (item.source === 'grok') top.append(make('span', 'news-queue-social', 'Grok on X'));
    top.append(make('span', 'news-queue-author', name));
    const date = make('time', '', newsTime(item.publishedAt));
    if (Number.isFinite(Date.parse(item.publishedAt))) date.dateTime = item.publishedAt;
    top.append(date);
    const link = make('a', 'news-queue-headline', item.title);
    link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.dir = 'auto';
    if (item.source === 'grok') link.title = 'Open the original post on X';
    row.append(top, link);
    if (item.rationale) row.append(make('p', 'news-queue-detail', item.rationale));
    const footer = make('div', 'news-queue-footer');
    const read = make('button', 'news-queue-read', 'Mark read');
    read.type = 'button';
    read.setAttribute('aria-label', 'Mark read: ' + item.title);
    read.addEventListener('click', () => {
      const sibling = row.nextElementSibling || row.previousElementSibling;
      discard(candidate => candidate.id === item.id);
      (sibling?.querySelector('.news-queue-read') || unreadButton.hidden && trigger || unreadButton).focus({preventScroll:true});
    });
    footer.append(make('small', '', item.markets.length ? item.markets.join(' · ') : item.event), read);
    row.append(footer);
    return row;
  }
  function render() {
    const count = items.size;
    trigger.textContent = count ? 'News · ' + count : 'News';
    unreadButton.textContent = 'Unread · ' + count;
    unreadButton.hidden = count === 0;
    if (testing) return;
    heading.textContent = 'News alerts';
    summary.textContent = count === 1 ? '1 unread headline' : count + ' unread headlines';
    detail.textContent = '';
    controls.hidden = list.hidden = count === 0;
    const wasScrolled = list.scrollTop > 2;
    const firstVisible = wasScrolled && [...list.children].find(row => row.getBoundingClientRect().bottom > list.getBoundingClientRect().top);
    const anchorOffset = firstVisible && firstVisible.getBoundingClientRect().top;
    for (const [id, value] of cards) if (!items.has(id)) {
      value.row.remove();
      cards.delete(id);
    }
    const sorted = [...items.values()].sort((a,b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
    sorted.forEach((item, index) => {
      let value = cards.get(item.id);
      if (value?.item !== item) {
        const row = card(item);
        value?.row.replaceWith(row);
        value = {item, row};
        cards.set(item.id, value);
      }
      if (list.children[index] !== value.row) list.insertBefore(value.row, list.children[index] || null);
    });
    if (!wasScrolled) list.scrollTop = 0;
    else if (firstVisible?.isConnected) list.scrollTop += firstVisible.getBoundingClientRect().top - anchorOffset;
    scrollState();
  }
  function enqueue(values) {
    for (const value of values) {
      const item = entry(value);
      if (item) items.set(item.id, item);
    }
    save();
    testing = false;
    render();
  }
  function test(message) {
    testing = true;
    heading.textContent = 'Test news alert';
    summary.textContent = 'Your market catalyst alerts are ready.';
    detail.textContent = message;
    controls.hidden = list.hidden = true;
  }
  function show() {
    if (!testing) return;
    testing = false;
    render();
  }
  render();
  return {enqueue, discard, test, show, hasUnread: () => items.size > 0};
}
