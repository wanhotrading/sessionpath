import { reveal } from './forecast-motion.mjs';

const duration = 600;
const characterGap = 50;
const active = new WeakMap();
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const selectors = [
  '.session-board-check dd, .session-board-containment dd',
  '.context-heading h3, .context-state strong, .context-state > span',
  '.context-metric > strong, .context-target > b',
];

export function cancelForecastTextMotion(panel) {
  active.get(panel)?.();
}

function readableText(target) {
  return Array.from(target.childNodes).flatMap(child => {
    if (child.nodeType === 3) return child.textContent.trim() ? [child] : [];
    return child.nodeType === 1 && child.matches('.probability-value') ? readableText(child) : [];
  });
}

function wrapCharacters(text, doc) {
  const wrapper = doc.createElement('span');
  const accessible = doc.createElement('span');
  accessible.className = 'forecast-text-readable';
  accessible.textContent = text;
  const visual = doc.createElement('span');
  visual.setAttribute('aria-hidden', 'true');
  const chars = [];
  for (const token of text.split(/(\s+)/u).filter(Boolean)) {
    if (/^\s+$/u.test(token)) {
      visual.append(token);
      continue;
    }
    const word = doc.createElement('span');
    word.className = 'forecast-text-word';
    const letters = segmenter ? Array.from(segmenter.segment(token), item => item.segment) : Array.from(token);
    for (const letter of letters) {
      const span = doc.createElement('span');
      span.className = 'forecast-text-char';
      span.textContent = letter;
      word.append(span);
      chars.push(span);
    }
    visual.append(word);
  }
  wrapper.append(accessible, visual);
  return { wrapper, chars };
}

export function revealForecastText(panel) {
  cancelForecastTextMotion(panel);
  const doc = panel.ownerDocument;
  const view = doc.defaultView;
  const reduced = view.matchMedia('(prefers-reduced-motion: reduce)');
  const paused = () => reduced.matches || panel.hidden || !panel.isConnected || doc.hidden ||
    doc.body.classList.contains('motion-paused') ||
    doc.documentElement.classList.contains('motion-paused');
  if (paused() || typeof panel.animate !== 'function') return;
  if (doc.documentElement.dataset.loadingCover) {
    const observer = new view.MutationObserver(() => {
      if (doc.documentElement.dataset.loadingCover) return;
      revealForecastText(panel);
    });
    active.set(panel, () => {
      observer.disconnect();
      active.delete(panel);
    });
    observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-loading-cover'] });
    return;
  }
  const keyframes = [
    { transform: 'translateX(50px)', filter: 'blur(10px)', opacity: 0 },
    { transform: 'translateX(0)', filter: 'blur(0)', opacity: 1 },
  ];
  const replacements = [];
  const animations = [];
  let total = duration;
  for (const [group, selector] of selectors.entries()) {
    const nodes = Array.from(panel.querySelectorAll(selector));
    for (const target of nodes) {
      const bounds = target.getBoundingClientRect();
      if (bounds.bottom <= 0 || bounds.top >= view.innerHeight) continue;
      let index = 0;
      for (const source of readableText(target)) {
        if (source.textContent.trim() === '—') continue;
        const { wrapper, chars } = wrapCharacters(source.textContent, doc);
        source.replaceWith(wrapper);
        replacements.push([wrapper, source]);
        for (const char of chars) {
          const delay = group * 110 + index++ * characterGap;
          animations.push(char.animate(keyframes, { duration, delay, fill: 'backwards', easing: 'ease' }));
          total = Math.max(total, delay + duration);
        }
      }
    }
  }
  if (!animations.length) return;

  function stop() {
    view.clearTimeout(timer);
    active.delete(panel);
    for (const animation of animations) animation.cancel();
    for (const [wrapper, source] of replacements) wrapper.replaceWith(source);
  }
  const timer = view.setTimeout(() => {
    stop();
    if (!paused()) reveal(panel, []);
  }, total);
  active.set(panel, stop);
}
