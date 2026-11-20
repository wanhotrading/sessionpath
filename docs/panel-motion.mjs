export const MOTION = { duration: 300, easing: 'cubic-bezier(.25,.7,.25,1)' };

export function genieFrames(anchor, { width, height }) {
  const scaleX = Math.min(.35, anchor.width / Math.max(1, width));
  const scaleY = Math.min(.2, anchor.height / Math.max(1, height));
  return [
    {
      clipPath: 'polygon(12% 0%,88% 0%,100% 22%,93% 70%,83% 100%,17% 100%,7% 70%,0% 22%)',
      transform: `scale(${scaleX},${scaleY})`,
      opacity: .4,
    },
    {
      offset: .55,
      clipPath: 'polygon(0% 0%,100% 0%,98% 22%,90% 70%,82% 100%,18% 100%,10% 70%,2% 22%)',
      transform: 'scale(.86,.79)',
      opacity: .96,
    },
    {
      clipPath: 'polygon(0% 0%,100% 0%,100% 22%,100% 70%,100% 100%,0% 100%,0% 70%,0% 22%)',
      transform: 'scale(1)',
      opacity: 1,
    },
  ];
}
