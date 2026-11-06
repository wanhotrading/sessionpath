import assert from 'node:assert/strict';
import test from 'node:test';
import {makeChartSessionPathCode, parseSessionPathCode} from '../../../docs/session-path-code.mjs';

const code = 'SPPATH1|NQ|2026-10-19|10:45|UP_FINISH|UP_FINISH|NARROW';
const observation = {
  market: 'NQ', ticker: 'NQ1!', date: '2026-10-19', cutoff: '2026-10-19T10:45',
  timezone: 'America/New_York', intervalMinutes: 5,
};
const archived = [
  {session: 'NTA', tag: 'UP_FINISH', status: 'archive'},
  {session: 'ASIA', tag: 'UP_FINISH', status: 'archive'},
  {session: 'LONDON', tag: 'NARROW', status: 'archive'},
];

test('chart observation controls identity and codes retain NTA, Asia, London order', () => {
  const body = {
    market: 'CL', date: null, chartObservation: observation,
    shapeTags: [archived[2], {session: 'NY', tag: null, status: 'in_progress'}, ...archived.slice(0, 2)],
  };
  assert.equal(makeChartSessionPathCode(body), code);
  assert.deepEqual(parseSessionPathCode(` \n${code}\r\n`), {
    market: 'NQ', date: '2026-10-19', cutoff: '10:45',
    choices: {nta: 'UP_FINISH', asia: 'UP_FINISH', london: 'NARROW'},
  });
});

test('parser accepts CL and ES, a real leap date, and the completed London boundary', () => {
  for (const market of ['CL', 'ES']) {
    const parsed = parseSessionPathCode(`SPPATH1|${market}|2024-02-29|08:30|ORDER_UNRESOLVED|DROP_RECOVERY|RALLY_FADE`);
    assert.deepEqual(parsed, {
      market, date: '2024-02-29', cutoff: '08:30',
      choices: {nta: 'ORDER_UNRESOLVED', asia: 'DROP_RECOVERY', london: 'RALLY_FADE'},
    });
  }
});

test('parser rejects bad versions, markets, dates, cutoffs, labels, and field counts', () => {
  for (const input of [
    null, '', code.replace('SPPATH1', 'SPPATH2'), code.replace('|NQ|', '|GC|'),
    code.replace('|NQ|', '|nq|'), code.replace('2026-10-19', '2026-02-29'),
    code.replace('2026-10-19', '2026-2-09'), code.replace('10:45', '08:25'),
    code.replace('10:45', '10:46'), code.replace('10:45', '24:00'),
    code.replace('10:45', '10:45:00'), code.replace('10:45', '10:45\n'),
    code.replace('NARROW', 'Narrow range'), code.replace('|NARROW', ''), `${code}|NARROW`,
  ]) assert.equal(parseSessionPathCode(input), null, String(input));
});

test('encoder requires an exact market, dated New York cutoff, and five-minute ticker observation', () => {
  for (const changes of [
    {market: 'ES'}, {market: 'GC', ticker: 'GC1!'}, {ticker: null}, {ticker: 'NQ'},
    {date: '2026-02-30', cutoff: '2026-02-30T10:45'}, {cutoff: '2026-10-18T10:45'},
    {cutoff: '2026-10-19T08:25'}, {cutoff: '2026-10-19T08:31'}, {cutoff: '2026-10-19T10:45Z'},
    {timezone: null}, {timezone: 'UTC'}, {intervalMinutes: '5'}, {intervalMinutes: 15},
  ]) {
    assert.equal(makeChartSessionPathCode({chartObservation: {...observation, ...changes}, shapeTags: archived}), '', JSON.stringify(changes));
  }
  for (const [market, ticker] of [['CL', 'NYMEX:MCLZ2026'], ['ES', 'CME_MINI:ES1!']]) {
    const encoded = makeChartSessionPathCode({
      chartObservation: {...observation, market, ticker, cutoff: '2026-10-19T08:30'}, shapeTags: archived,
    });
    assert.equal(parseSessionPathCode(encoded)?.market, market);
  }
});

test('encoder requires exactly one archive tag for each of NTA, Asia, and London', () => {
  for (const shapeTags of [
    null, archived.slice(1), [...archived, archived[0]],
    [...archived, {...archived[0], status: 'provisional'}],
    [...archived.slice(0, 2), {...archived[2], tag: 'OTHER'}],
    ...['provisional', 'unverified', 'in_progress'].map(status => [...archived.slice(0, 2), {...archived[2], status}]),
  ]) assert.equal(makeChartSessionPathCode({chartObservation: observation, shapeTags}), '');
  assert.equal(makeChartSessionPathCode({shapeTags: archived}), '');
  assert.equal(makeChartSessionPathCode(null), '');
});
