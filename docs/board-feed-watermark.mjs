const descriptions = {
  checking: 'Checking',
  connected: 'Connected',
  waiting: 'Waiting for data',
  paused: 'Paused',
  replay: 'Paused in Replay',
  unavailable: 'Unavailable',
};

function makeIndicator(label, host) {
  const doc = host.ownerDocument;
  const item = doc.createElement('span');
  item.className = 'watermark-feed';
  const caption = doc.createElement('span');
  caption.textContent = label;
  const live = doc.createElement('span');
  live.className = 'watermark-feed-description';
  live.setAttribute('role', 'status');
  item.append(caption, live);
  host.append(item);
  return status => {
    if (item.dataset.feedState === status) return;
    item.dataset.feedState = status;
    item.title = label + ' feed · ' + descriptions[status];
    live.textContent = item.title;
  };
}

export function mountFeedWatermark(header) {
  const doc = header.ownerDocument;
  const view = doc.defaultView;
  const feeds = doc.createElement('div');
  feeds.className = 'watermark-feeds';
  header.append(feeds);
  const setData = makeIndicator('Data', feeds);
  const setNews = makeIndicator('News', feeds);
  setData('checking');
  setNews('checking');

  const refreshData = () => {
    const item = doc.getElementById('personal-auto-fill-status');
    const replay = doc.getElementById('replay-toggle')?.checked;
    const state = item?.dataset.connection;
    setData(replay ? 'replay' : Object.hasOwn(descriptions, state) ? state : 'checking');
  };
  const dataObserver = new view.MutationObserver(refreshData);
  const form = doc.getElementById('scenario-form');
  dataObserver.observe(form, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-connection'] });
  doc.getElementById('replay-toggle')?.addEventListener('change', refreshData);
  refreshData();

  const newsStatus = doc.querySelector('.sp-news-ticker')?.dataset.feedState;
  if (Object.hasOwn(descriptions, newsStatus)) setNews(newsStatus);
  doc.addEventListener('sessionpath:news-connection', event => {
    if (Object.hasOwn(descriptions, event.detail)) setNews(event.detail);
  });
}
