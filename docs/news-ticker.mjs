function make(doc, tag, className, text = '') {
  const el = doc.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}

export function mountNewsTicker(doc = document) {
  const view = doc.defaultView, bar = make(doc, 'section', 'sp-news-ticker');
  bar.setAttribute('aria-label', 'Market headlines');
  bar.dataset.feedState = 'checking';
  const trigger = make(doc, 'button', 'sp-news-open', 'News');
  trigger.type = 'button';
  trigger.id = 'news-desk-toggle';
  const viewport = make(doc, 'div', 'sp-news-viewport');
  const track = make(doc, 'div', 'sp-news-track');
  const headline = make(doc, 'span', 'sp-news-headline', 'Checking headlines…');
  headline.dir = 'auto';
  track.append(headline); viewport.append(track);
  const pause = make(doc, 'button', 'sp-news-pause', 'Ⅱ');
  pause.type = 'button';
  pause.hidden = true;
  const reduced = view.matchMedia('(prefers-reduced-motion: reduce)');
  let signature = '', moving = false, paused = false;
  const clearCopies = () => { while(track.childElementCount>1)track.lastElementChild.remove(); };

  function measure() {
    if (!moving || reduced.matches) { clearCopies(); return; }
    const width = headline.getBoundingClientRect().width, visible = viewport.clientWidth;
    if (!width || !visible) return;
    const needed = Math.min(24, Math.ceil(visible / width) + 1);
    while (track.childElementCount > needed) track.lastElementChild.remove();
    while (track.childElementCount < needed) {
      const copy = headline.cloneNode(true);
      copy.classList.add('sp-news-copy');
      copy.setAttribute('aria-hidden', 'true');
      track.append(copy);
    }
    track.style.setProperty('--sp-news-distance', width + 'px');
    track.style.setProperty('--sp-news-duration', Math.max(5, width / 74).toFixed(2) + 's');
  }

  function renderPause() {
    pause.hidden = !moving || reduced.matches;
    bar.dataset.paused = String(paused);
    pause.textContent = paused ? '▷' : 'Ⅱ';
    const label = paused ? 'Resume news ticker' : 'Pause news ticker';
    pause.setAttribute('aria-label', label);
    pause.setAttribute('aria-pressed', String(paused));
    pause.title = label;
  }

  pause.addEventListener('click', () => { paused = !paused; renderPause(); });
  reduced.addEventListener('change', () => { renderPause(); measure(); });
  bar.append(trigger, viewport, pause);
  doc.body.prepend(bar);
  new view.ResizeObserver(measure).observe(viewport);
  renderPause();

  function update(value, state) {
    if (bar.dataset.feedState !== state) {
      bar.dataset.feedState = state;
      doc.dispatchEvent(new view.CustomEvent('sessionpath:news-connection', {detail: state}));
    }
    const headlines = (Array.isArray(value) ? value : [value]).filter(s => typeof s === 'string' && s.trim()).slice(0, 6);
    const next = headlines.join('    •    ') || ({
      checking: 'Checking headlines…', connected: 'No matching headlines', unavailable: 'News feed unavailable',
    })[state] || 'Checking headlines…';
    if (signature === next && moving === Boolean(headlines.length)) return;
    signature = next;
    moving = headlines.length > 0;
    clearCopies();
    headline.textContent = next;
    viewport.title = next;
    track.dataset.moving = String(moving);
    track.dataset.parity = track.dataset.parity === 'a' ? 'b' : 'a';
    renderPause();
    measure();
  }
  return {trigger, update};
}
