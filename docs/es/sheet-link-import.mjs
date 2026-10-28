/** Read-only helpers for a Google Sheets / CSV screenshot-link import. No network or DOM access. */
export const MAX_SHEET_ROWS = 10000;
const MAX_CSV_CHARS = 24 * 1024 * 1024;
const MAX_URL_CHARS = 8192;
const LETTERS = /^[A-Z]{1,3}$/;

export function columnIndex(column) {
  const text = String(column ?? '').trim().toUpperCase();
  if (!LETTERS.test(text)) throw new Error('Choose one column from A to ZZZ.');
  return [...text].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

export function parseColumnRange(input = 'A') {
  const text = String(input).trim().toUpperCase().replaceAll('$', '');
  const match = text.match(/^([A-Z]{1,3})(?:(\d+):([A-Z]{1,3})(\d*)|:([A-Z]{1,3}))?$/);
  if (!match) throw new Error('Choose one column, such as A, or a range such as A2:A1000.');
  const [, column, startText, endColumn, endText, fullColumn] = match;
  if ((endColumn || fullColumn || column) !== column) throw new Error('Import one screenshot-link column at a time.');
  const startRow = startText ? Number(startText) : 1;
  const endRow = endText ? Number(endText) : startRow + MAX_SHEET_ROWS - 1;
  if (!Number.isSafeInteger(startRow) || !Number.isSafeInteger(endRow) || startRow < 1 || endRow < startRow) {
    throw new Error('Use valid positive row numbers in ascending order.');
  }
  if (endRow - startRow + 1 > MAX_SHEET_ROWS) throw new Error('Import at most 10,000 rows at a time.');
  return { column, columnIndex: columnIndex(column), startRow, endRow, range: `${column}${startRow}:${column}${endRow}` };
}

/** Return only Google-owned CSV export URLs. A canonical URL does not imply public permission. */
export function parseGoogleSheetURL(input, columnOrRange = 'A') {
  let url;
  try { url = new URL(String(input).trim()); } catch { throw new Error('Enter a complete Google Sheets link.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || url.port || url.username || url.password) {
    throw new Error('Use an HTTPS Google Sheets link from docs.google.com.');
  }
  const ordinary = url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/(?:edit|view|preview|export|gviz\/tq))?\/?$/);
  const published = url.pathname.match(/^\/spreadsheets\/d\/e\/([A-Za-z0-9_-]+)\/(?:pub|pubhtml)\/?$/);
  if (!ordinary && !published) throw new Error('This is not a supported Google Sheets link.');
  const id = (ordinary || published)[1];
  const fragment = new URLSearchParams(url.hash.slice(1));
  const gid = fragment.get('gid') ?? url.searchParams.get('gid') ?? '0';
  if (!/^\d{1,20}$/.test(gid)) throw new Error('The sheet tab ID must be a non-negative number.');
  const selection = parseColumnRange(columnOrRange);
  const base = `https://docs.google.com/spreadsheets/d/${published ? 'e/' : ''}${id}`;
  const primary = new URL(`${base}/${published ? 'pub' : 'gviz/tq'}`);
  primary.searchParams.set(published ? 'output' : 'tqx', published ? 'csv' : 'out:csv');
  primary.searchParams.set('gid', gid);
  primary.searchParams.set('range', selection.range);
  if (published) primary.searchParams.set('single', 'true');
  const exportURL = published ? new URL(primary) : new URL(`${base}/export`);
  if (!published) {
    exportURL.searchParams.set('format', 'csv');
    exportURL.searchParams.set('gid', gid);
    exportURL.searchParams.set('range', selection.range);
  }
  return {
    id, gid, published: Boolean(published), ...selection,
    sourceURL: url.href, csvURL: primary.href, primaryCSVURL: primary.href,
    fallbackCSVURLs: exportURL.href === primary.href ? [] : [exportURL.href],
    exportURL: exportURL.href,
  };
}

/** RFC-style CSV parser. Quoted commas, doubled quotes and embedded line breaks are preserved. */
export function parseCSV(value) {
  if (typeof value !== 'string') throw new Error('The imported CSV must be text.');
  if (value.length > MAX_CSV_CHARS) throw new Error('This CSV is too large. Export a single column with at most 10,000 rows.');
  const text = value.replace(/^\uFEFF/, '');
  if (/^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b|<script\b)/i.test(text)) {
    throw new Error('Google returned a sign-in or web page instead of CSV. Use a publicly readable sheet or import a CSV file.');
  }
  if (!text) return [];
  const rows = [];
  let row = [], field = '', quoted = false, afterQuote = false, rowStarted = false;
  const endField = () => { row.push(field); field = ''; afterQuote = false; rowStarted = true; };
  const endRow = () => { endField(); rows.push(row); row = []; rowStarted = false; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') { quoted = false; afterQuote = true; }
      else field += ch;
      continue;
    }
    if (ch === ',') { endField(); continue; }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow(); continue;
    }
    if (afterQuote) {
      if (ch === ' ' || ch === '\t') continue;
      throw new Error('The CSV has text after a closing quote. Export it again as CSV.');
    }
    if (ch === '"') {
      if (field !== '') throw new Error('The CSV has an unexpected quote. Export it again as CSV.');
      quoted = true; rowStarted = true; continue;
    }
    field += ch; rowStarted = true;
  }
  if (quoted) throw new Error('The CSV ends inside a quoted cell. Export the complete CSV again.');
  if (rowStarted || row.length || field !== '' || afterQuote) endRow();
  return rows;
}

function publicHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || /(?:^|\.)(?:localhost|local|lan|internal|test|invalid|example)$/.test(host)) return false;
  if (host.startsWith('[')) return false; // Public IPv6 is unnecessary for screenshot links; reject ambiguous local addresses.
  if (/^\d+(?:\.\d+){3}$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
        (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19))) return false;
  }
  return true;
}

export function safeScreenshotURL(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > MAX_URL_CHARS || /[\u0000-\u0020\u007f]/.test(text)) return null;
  let url;
  try { url = new URL(text); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || !publicHost(url.hostname)) return null;
  return url.href;
}

function hyperlinkCell(value) {
  const text = String(value ?? '').trim();
  if (!/^=?HYPERLINK\s*\(/i.test(text)) return { urlText: text, label: '' };
  const match = text.match(/^=?HYPERLINK\s*\(\s*"((?:[^"]|"")*)"\s*(?:[,;]\s*"((?:[^"]|"")*)"\s*)?\)$/i);
  return match ? { urlText: match[1].replaceAll('""', '"'), label: (match[2] || '').replaceAll('""', '"') } : null;
}

function linkPresentation(urlText, label) {
  const url = new URL(urlText);
  const driveFile = url.hostname === 'drive.google.com' && (
    url.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1] ||
    (/^\/(?:open|uc|thumbnail)$/.test(url.pathname) ? url.searchParams.get('id') : null)
  );
  const driveID = driveFile && /^[A-Za-z0-9_-]+$/.test(driveFile) ? driveFile : null;
  let filename = url.pathname.split('/').filter(Boolean).at(-1) || url.hostname;
  try { filename = decodeURIComponent(filename); } catch { /* Retain valid URL text when a filename has unusual encoding. */ }
  const kind = driveID ? 'drive' : /\.(?:png|jpe?g|webp|gif|avif|bmp)$/i.test(url.pathname) ? 'image' : 'link';
  const name = String(label || filename).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 250);
  const dateText = `${name} ${url.pathname}`.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1] || '';
  const date = dateText && !Number.isNaN(Date.parse(dateText)) && new Date(dateText).toISOString().slice(0, 10) === dateText ? dateText : '';
  const contract = `${name} ${url.pathname}`.match(/(?:^|[^a-z0-9])((?:(?:MCL|CL)[FGHJKMNQUVXZ]|(?:MES|ES)[HMUZ])\d{4})(?=$|[^a-z0-9])/i)?.[1]?.toUpperCase() || '';
  return {
    url: urlText, imageUrl: driveID ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveID)}&sz=w2000` : kind === 'image' ? urlText : null,
    label: name, name, kind, date, contract,
    ...(driveID ? { driveId: driveID } : {}),
  };
}

/**
 * Import a column from CSV. For a ranged Google export, use column A and pass its original startRow.
 * For a full-sheet CSV, pass the desired column (A...ZZZ). Rich-text link labels alone have no recoverable URL.
 * Returned labels are untrusted text: render with textContent, never innerHTML.
 */
export function screenshotLinksFromCSV(csv, { column = 'A', startRow = 1, skipRows = 0, maxRows = MAX_SHEET_ROWS } = {}) {
  const selectedColumn = columnIndex(column);
  if (!Number.isSafeInteger(startRow) || startRow < 1) throw new Error('Use a positive starting row.');
  if (!Number.isSafeInteger(skipRows) || skipRows < 0 || skipRows > 1000000) throw new Error('Use a valid first row.');
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > MAX_SHEET_ROWS) throw new Error('Import at most 10,000 rows at a time.');
  const rows = parseCSV(csv), seen = new Set(), items = [];
  let duplicateCount = 0, rejectedCount = 0, nonLinkCount = 0;
  for (let index = 0; index < Math.min(Math.max(0, rows.length - skipRows), maxRows); index++) {
    const raw = rows[index + skipRows][selectedColumn] || '';
    if (!raw.trim()) continue;
    const cell = hyperlinkCell(raw);
    const url = cell && safeScreenshotURL(cell.urlText);
    if (!url) {
      if (/^(?:=?HYPERLINK\s*\(|[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw.trim())) rejectedCount++;
      else nonLinkCount++;
      continue;
    }
    const preview = linkPresentation(url, cell.label);
    const dedupeKey = preview.driveId ? `drive:${preview.driveId}` : url;
    if (seen.has(dedupeKey)) { duplicateCount++; continue; }
    seen.add(dedupeKey);
    items.push({ ...preview, row: startRow + index, column: String(column).trim().toUpperCase() });
  }
  return { items, rowCount: Math.min(Math.max(0, rows.length - skipRows), maxRows), duplicateCount, rejectedCount, nonLinkCount, truncated: rows.length - skipRows > maxRows };
}

/** Existing screenshot-review log compatible identity, independent of sheet row order or source. */
export async function screenshotLinkID(url, cryptoImpl = globalThis.crypto) {
  const safeURL = safeScreenshotURL(url);
  if (!safeURL) throw new Error('Cannot identify an unsafe screenshot URL.');
  if (!cryptoImpl?.subtle?.digest) throw new Error('Screenshot imports require a secure browser connection.');
  const bytes = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(safeURL));
  return 'local:' + [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
