// Display-only conversion. Publisher text remains unchanged for analysis,
// deduplication, corrections, and the exported audit record.
let converter;
let loading;
const cache = new Map();

export async function prepareTraditionalNews(result) {
  if (result?.source?.id !== 'wallstreetcn' || !result.items?.length) return result;
  if (!loading) loading = import('./vendor/opencc-1.4.2/cn2t.mjs').then(module => {
    converter = module.Converter({from:'cn', to:'t'});
  }).catch(() => { loading = null; }); // A missing asset must not disable the news feed.
  await loading;
  return result;
}

export function traditionalNewsText(item, value = item?.title) {
  const text = typeof value === 'string' ? value : '';
  if (item?.source !== 'wallstreetcn' || !converter || !text) return text;
  if (cache.has(text)) return cache.get(text);
  const converted = converter(text);
  cache.set(text,converted);
  if (cache.size > 800) cache.delete(cache.keys().next().value);
  return converted;
}

export function matchesNewsSearch(item, search = '') {
  const query = String(search).trim().toLocaleLowerCase();
  if (!query) return true;
  const original = String(item?.title || '').toLocaleLowerCase();
  return original.includes(query) || traditionalNewsText(item).toLocaleLowerCase().includes(traditionalNewsText(item,query));
}
