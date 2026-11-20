import { genieFrames, MOTION } from '../panel-motion.mjs';

export function attachStudyDialog(link) {
  if (typeof HTMLDialogElement === 'undefined') return;
  const doc = link.ownerDocument;
  const panel = doc.createElement('dialog');
  panel.className = 'ot-study-dialog';
  panel.id = 'overnight-study-dialog';
  panel.setAttribute('aria-label', 'Overnight breach timing study');
  panel.innerHTML = '<div class="ot-study-toolbar"><strong>Explore study</strong><button type="button" class="quiet" aria-label="Close study">×</button></div>';
  const close = panel.querySelector('button');
  link.setAttribute('aria-haspopup', 'dialog');
  link.setAttribute('aria-controls', panel.id);
  link.setAttribute('aria-expanded', 'false');
  doc.body.append(panel);
  const stateKey = 'sessionpathOvernightStudy';
  const canAnimate = () => typeof panel.animate === 'function' &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches && !doc.body.classList.contains('motion-paused');
  let animation, frames, frame, closing = false;

  function openPanel() {
    if (panel.open && !closing) return;
    closing = false;
    animation?.cancel();
    const anchor = link.getBoundingClientRect();
    if (!panel.open) panel.showModal();
    if (!frame) {
      frame = doc.createElement('iframe');
      frame.title = 'Overnight breach timing filters and chart';
      frame.addEventListener('load', () => {
        const inside = frame?.contentDocument;
        inside?.getElementById('back')?.addEventListener('click', event => {
          event.preventDefault();
          requestClose();
        });
        inside?.addEventListener('keydown', event => {
          if (event.key === 'Escape' && !event.defaultPrevented) {
            event.preventDefault();
            requestClose();
          }
        });
      });
      frame.src = link.href;
      panel.append(frame);
    }
    link.setAttribute('aria-expanded', 'true');
    close.focus({ preventScroll: true });
    const bounds = panel.getBoundingClientRect();
    panel.style.transformOrigin = (anchor.left + anchor.width / 2 - bounds.left) + 'px ' +
      (anchor.top + anchor.height / 2 - bounds.top) + 'px';
    frames = genieFrames(anchor, bounds);
    if (canAnimate()) animation = panel.animate(frames, MOTION);
  }

  function closePanel() {
    if (!panel.open || closing) return;
    closing = true;
    function finish() {
      if (!closing) return;
      panel.close();
      frame?.remove();
      frame = null;
      animation = null;
      link.setAttribute('aria-expanded', 'false');
      link.focus({ preventScroll: true });
      closing = false;
    }
    if (!canAnimate()) return finish();
    if (animation?.playState === 'running') animation.reverse();
    else animation = panel.animate(frames, { ...MOTION, direction: 'reverse' });
    animation.onfinish = finish;
  }

  function requestClose() {
    if (closing) return;
    if (history.state?.[stateKey]) history.back();
    closePanel();
  }
  link.addEventListener('click', event => {
    if (event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (!history.state?.[stateKey]) history.pushState({ ...history.state, [stateKey]: true }, '', location.href);
    openPanel();
  });
  close.addEventListener('click', requestClose);
  panel.addEventListener('cancel', event => { event.preventDefault(); requestClose(); });
  window.addEventListener('popstate', () => history.state?.[stateKey] ? openPanel() : closePanel());
  if (history.state?.[stateKey]) openPanel();
}
