export const REVIEW_STATUSES = ['unreviewed', 'good', 'redo'];
export const REVIEW_CHECKS = [
  ['left', 'Previous trading day 09:30 is at the left edge'],
  ['right', 'Current day 16:00 is at the right edge'],
  ['boxes', 'All three forecast boxes have complete borders'],
  ['readable', 'Candles, prices and the AVR summary are readable'],
];

export function fileMetadata(name,market=instrument.id) {
  const date = String(name).match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';
  const validDate = date && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  const pattern=market==='NQ'?/(?:^|[^a-z0-9])((?:MNQ|NQ)[HMUZ]\d{4})(?=$|[^a-z0-9])/i:/(?:^|[^a-z0-9])((?:MCL|CL)[FGHJKMNQUVXZ]\d{4})(?=$|[^a-z0-9])/i;
  return { date: validDate ? date : '', contract: String(name).match(pattern)?.[1]?.toUpperCase() || '' };
}

export function filterScreenshots(items, reviews, query = '', status = '') {
  const needle = query.trim().toLowerCase();
  return items.filter(item => (!needle || [item.date, item.contract, item.name].join(' ').toLowerCase().includes(needle)) &&
    (!status || (reviews[item.id]?.status || 'unreviewed') === status));
}

export function validateReviewLog(value,market=instrument.id) {
  if (!value || value.version !== 1 || !Array.isArray(value.reviews) || value.reviews.length > 20000) throw Error('Choose a SessionPath screenshot review log.');
  if(value.instrument&&value.instrument!==market)throw Error('This review log belongs to '+value.instrument+'. Switch markets before importing it.');
  const result = {};
  for (const record of value.reviews) {
    if (!record || typeof record.id !== 'string' || record.id.length > 250 || !/^(archive:\d+:[a-zA-Z0-9._/-]+|local:[a-f0-9]{64})$/.test(record.id) || !REVIEW_STATUSES.includes(record.status)) throw Error('This review log contains an invalid record.');
    const recordedMarket=/^(?:MNQ|NQ)/i.test(record.contract||'')?'NQ':/^(?:MCL|CL)/i.test(record.contract||'')?'CL':null;
    if(recordedMarket&&recordedMarket!==market)throw Error('This review record belongs to another market. Switch markets before importing it.');
    if(market==='NQ'&&!value.instrument&&!recordedMarket)throw Error('Legacy review log has no NQ identity. Export a market-labelled backup first.');
    const checks = Object.fromEntries(REVIEW_CHECKS.map(([key]) => [key, record.checks?.[key] === true]));
    if (record.status === 'good' && !Object.values(checks).every(Boolean)) throw Error('A good capture must have all four checks confirmed.');
    result[record.id] = {
      id: record.id, status: record.status, checks,
      name: String(record.name || '').slice(0, 250), date: String(record.date || '').slice(0, 10),
      contract: String(record.contract || '').slice(0, 20), notes: String(record.notes || '').slice(0, 5000),
      updatedAt: String(record.updatedAt || '').slice(0, 30),
    };
  }
  return result;
}

export function reviewCSV(reviews) {
  const quote = value => {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const rows = [['Date', 'Contract', 'Screenshot', 'Review', ...REVIEW_CHECKS.map(([, label]) => label), 'Notes', 'Reviewed at']];
  for (const r of Object.values(reviews).sort((a, b) => (a.date + a.name).localeCompare(b.date + b.name))) rows.push([
    r.date, r.contract, r.name, r.status === 'redo' ? 'Needs redo' : r.status === 'good' ? 'Good' : 'Unreviewed',
    ...REVIEW_CHECKS.map(([key]) => r.checks?.[key] ? 'Yes' : 'No'), r.notes, r.updatedAt,
  ]);
  return rows.map(row => row.map(quote).join(',')).join('\r\n');
}
import {instrument} from './instrument.mjs';

