import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {OCT19_NQ_SHAPE_CASE, OCT19_NQ_EXPECTED_TAGS} from './chart-shape-case.mjs';

const [imagePath, receiptPath, mode, ...rest] = process.argv.slice(2);
if (!imagePath || !receiptPath || rest.length || (mode !== undefined && mode !== '--supplied-evidence') || !/\.json$/iu.test(receiptPath)) {
  throw new Error('Usage: node live-chart-shape-smoke.mjs OCT19_NQ_IMAGE RECEIPT_JSON [--supplied-evidence]');
}
if (!/\.png$/iu.test(imagePath)) throw new Error('Provide the original PNG for the Oct. 19 NQ case.');
const bytes = await readFile(imagePath);
if (bytes.length > 1_100_000) throw new Error('Image exceeds the smoke test upload limit.');
const fixtureSha256 = createHash('sha256').update(bytes).digest('hex');
if (fixtureSha256 !== 'a93b021378af6f3c8b005d483e96731e4f03574c5dd575d747824af36381709e') {
  throw new Error('The supplied file is not the known Oct. 19 NQ fixture; nothing was uploaded.');
}

// Reproduce the conflicting CL panel selection from the reported example.
const context = {market: 'CL', window: '05:00-08:30', date: null};
const supplied = mode === '--supplied-evidence';
const {ticker, date, cutoff, timezone, intervalMinutes, priorNyHigh, priorNyLow, open1930, sessions} = OCT19_NQ_SHAPE_CASE;
// If needed, isolate screenshot-reading errors from rule application by
// providing the actual candle statistics, without giving the expected labels.
const message = supplied
  ? `Verified chart metadata: ${ticker}, ${date}, ${timezone}, ${intervalMinutes}m. Last completed close ${cutoff}. Prior NY H/L ${priorNyHigh}/${priorNyLow}; 19:30 open ${open1930}. Completed sessions (H/L/C, first extreme): ${sessions.filter(s => s.complete).map(s => `${s.session} ${s.high}/${s.low}/${s.close} ${s.order}`).join('; ')}. NY is in progress. Apply the official shape rules to the completed sessions.`
  : 'Read the chart at its latest completed five-minute close. What SessionPath shape tags can you establish for NTA, Asia, London, and New York? Identify any conflict between the screenshot and selected context, and leave uncertain tags unclassified.';
const start = Date.now();
// One explicitly requested run, no automatic retry. The image is sent only
// to the established SessionPath chart-reading Worker and never saved here.
const response = await fetch('https://sessionpath-assistant.jjj-jason2345.workers.dev/api/chart', {
  method: 'POST',
  headers: {'Content-Type': 'application/json', Origin: 'https://wanhotrading.github.io'},
  body: JSON.stringify({message, context, referenceVersion: 'sessionpath-chart-v2', image: {dataUrl: `data:image/png;base64,${bytes.toString('base64')}`}}),
  signal: AbortSignal.timeout(55_000),
});
const result = await response.json();
const identity = result.chartObservation;
const rows = Array.isArray(result.shapeTags) ? result.shapeTags : [];
const observations = Object.fromEntries(Object.entries(OCT19_NQ_EXPECTED_TAGS).map(([session, expected]) => {
  const row = rows.find(item => item?.session === session);
  const actual = typeof row?.tag === 'string' ? row.tag : null;
  const status = row?.status ?? null;
  const outcome = expected === null
    ? (actual !== null ? 'premature-tag' : status === 'in_progress' ? 'correct' : 'unconfirmed')
    : (actual === null ? 'abstained' : actual === expected ? 'correct' : 'incorrect');
  return [session, {expected, actual, status, outcome}];
}));
const checks = {
  endpointOk: response.ok && result.ok === true && result.action === 'describe_chart',
  newReference: result.referenceVersion === 'sessionpath-chart-v2',
  chartMarketCorrect: identity?.market === OCT19_NQ_SHAPE_CASE.market,
  chartTickerCorrect: typeof identity?.ticker === 'string' && identity.ticker.toUpperCase().split(':').at(-1) === OCT19_NQ_SHAPE_CASE.ticker,
  chartDateCorrect: identity?.date === OCT19_NQ_SHAPE_CASE.date,
  completedCutoffCorrect: identity?.cutoff === OCT19_NQ_SHAPE_CASE.cutoff,
  chartTimezoneCorrect: identity?.timezone === OCT19_NQ_SHAPE_CASE.timezone,
  chartIntervalCorrect: identity?.intervalMinutes === OCT19_NQ_SHAPE_CASE.intervalMinutes,
  allCompletedTagsCorrect: ['NTA', 'ASIA', 'LONDON'].every(session => observations[session].outcome === 'correct'),
  noNyLookahead: observations.NY.outcome !== 'premature-tag',
  nyInProgressIdentified: observations.NY.outcome === 'correct',
};
const passed = Object.values(checks).every(Boolean);
const receipt = {
  case: 'NQ1! 2026-10-19 screenshot at approximately 10:47 NY',
  mode: supplied ? 'supplied-evidence' : 'screenshot-only',
  fixtureSha256,
  status: response.status,
  elapsedMs: Date.now() - start,
  referenceVersion: result.referenceVersion ?? null,
  model: result.model ?? null,
  expected: OCT19_NQ_SHAPE_CASE,
  observations,
  provenance: Object.fromEntries(['archive', 'provisional', 'unverified', 'in_progress'].map(status => [status, rows.filter(item => item?.status === status).length])),
  checks,
  passed,
  // Store analysis only in the local QA receipt; never store image bytes,
  // request body, provider request, or server credentials.
  result,
};
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({status: receipt.status, elapsedMs: receipt.elapsedMs, referenceVersion: receipt.referenceVersion, model: receipt.model, observations, checks, passed}, null, 2));
if (!passed) process.exitCode = checks.endpointOk ? 2 : 1;
