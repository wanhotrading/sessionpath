export function animateForecastMeter(element, frames) {
  const doc = element.ownerDocument;
  if (!element.animate || doc.hidden || doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      doc.documentElement.classList.contains('motion-paused') || doc.body.classList.contains('motion-paused')) return;
  return element.animate(frames, { duration: 780, easing: 'cubic-bezier(.22,.7,.2,1)' });
}
