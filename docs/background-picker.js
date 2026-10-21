// Choose once per page opening. Only this image is requested, not the collection.
(() => {
  const backgrounds = Array.from({length: 11}, (_, i) => `assets/backgrounds/snowy-sunset-v${i + 1}.webp`);
  let previous = -1;
  try { previous = Number(localStorage.getItem('sessionpath-last-background') ?? -1); } catch {}
  const choices = backgrounds.map((_, i) => i).filter(i => i !== previous);
  const selected = choices[Math.floor(Math.random() * choices.length)];
  const root = document.documentElement;
  root.style.setProperty('--session-background', `url("${backgrounds[selected]}")`);
  root.dataset.background = String(selected + 1);
  try { localStorage.setItem('sessionpath-last-background', String(selected)); } catch {}
  const image = new Image();
  image.onerror = () => {
    root.style.setProperty('--session-background', `url("${backgrounds[0]}")`);
    root.dataset.background = '1';
  };
  image.src = backgrounds[selected];
})();
