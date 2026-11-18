const launchURL = new URL('./',import.meta.url);
function mount() {
  const grid=document.querySelector('#workspace-tools-dialog .workflow-tool-grid');
  const market=document.body.dataset.instrument;
  if (!grid||!market) return false;
  if (!['CL','NQ','ES'].includes(market)) return true;
  if (grid.querySelector('#bbox-timing-tool')) return true;
  const card=document.createElement('article');
  card.className='workflow-tool-card';
  card.id='bbox-timing-tool';
  const title=document.createElement('h3');
  title.textContent='Overnight breach timing';
  const note=document.createElement('p');
  note.textContent='Track how BBOX breach and evening high or low probabilities change through the night.';
  const action=document.createElement('a');
  action.className='quiet';
  action.textContent='Open breach timing';
  launchURL.searchParams.set('instrument',market);
  action.href=launchURL.href;
  card.append(title,note,action);
  grid.prepend(card);
  return true;
}
if (!mount()) {
  const observer=new MutationObserver(()=>{
    if (mount()) observer.disconnect();
  });
  observer.observe(document.body,{childList:true,attributes:true,attributeFilter:['data-instrument']});
}
