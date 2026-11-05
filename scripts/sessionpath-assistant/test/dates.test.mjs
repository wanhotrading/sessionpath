import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRequest, validateIntent, parseExactForecast, resolveMessageDate, nyToday, validDate, INTENT_SCHEMA} from '../intent.mjs';
import {createAssistantHandler} from '../router.mjs';

const NOW = Date.parse('2026-11-05T07:00:00Z');
const context = {market: 'CL', window: '03:00-05:00'};
function post(message, date = null) {
  return new Request('https://assistant.test/api/chat', {method: 'POST', headers: {'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.9'}, body: JSON.stringify({message, context: date === undefined ? context : {...context, date}})});
}
const ai = intent => Response.json({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(intent)}}]});

test('calendar validation is exact and uses New York day rather than the UTC day', () => {
  assert.equal(nyToday(Date.parse('2026-11-05T03:59:00Z')), '2026-11-04');
  assert.equal(nyToday(Date.parse('2026-11-05T05:00:00Z')), '2026-11-05');
  assert.equal(nyToday(Date.parse('2026-06-03T03:59:00Z')), '2026-06-02');
  assert.equal(nyToday(Date.parse('2026-06-03T04:00:00Z')), '2026-06-03');
  for (const date of ['2024-02-29', '2026-11-05', '2022-01-03']) assert.equal(validDate(date, {now: NOW}), true, date);
  for (const date of ['2026-02-29', '2026-11-31', '2026-13-01', '2026-00-01', '2026-11-06', '2026-1-2', '2026-11-05<script>']) assert.equal(validDate(date, {now: NOW}), false, date);
});

test('English ordinal, full/abbreviated month, ISO and Chinese dates resolve the complete requested date', () => {
  for (const [message, expected] of [
    ['can you fetch the CL 03-05 code of 2nd Nov?', '2026-11-02'],
    ['CL 03-05 code for November 2nd, 2026', '2026-11-02'],
    ['2nd Nov CL 0300-0500 code', '2026-11-02'],
    ['CL November 2nd 03:00-05:00 code', '2026-11-02'],
    ['NQ 05-0830 range on 2026-10-20', '2026-10-20'],
    ['ES 0830-1600 code 2025/01/02', '2025-01-02'],
    ['GC 03-05 range on 3rd March 2025', '2025-03-03'],
    ['CL 03-05 code 11月2日', '2026-11-02'],
    ['請給我CL 03-05的2025年11月2號代碼', '2025-11-02'],
    ['請顯示原油03-05十一月二日的代碼', '2026-11-02'],
    ['黃金05-0830二零二四年二月二十九日代碼', '2024-02-29'],
  ]) {
    const parsed = parseExactForecast(message, {now: NOW});
    assert.equal(parsed?.action, 'forecast', message); assert.equal(parsed.date, expected, message);
  }
});

test('omitted years use the most recent real date not in the future, including leap days', () => {
  for (const [text, date] of [['2nd Nov', '2026-11-02'], ['December 2nd', '2025-12-02'], ['29th February', '2024-02-29'], ['12月31日', '2025-12-31'], ['1月1日', '2026-01-01']]) {
    assert.equal(resolveMessageDate(text, {now: NOW}).date, date, text);
  }
});

test('dates do not become hardcoded examples and polite commands preserve all three windows', async () => {
  const handler = createAssistantHandler({now: () => NOW, fetcher: () => {throw new Error('Should use exact dated parser');}});
  for (const [message, market, window, date] of [
    ['can you fetch the CL 03-05 code of 2nd Nov?', 'CL', '03:00-05:00', '2026-11-02'],
    ['Please show NQ 05-0830 range for 17th September 2024', 'NQ', '05:00-08:30', '2024-09-17'],
    ['GC 0830-1600 code for 2025-06-23', 'GC', '08:30-16:00', '2025-06-23'],
  ]) {
    const response = await handler(post(message), {}); assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual({market: body.market, window: body.window, date: body.date}, {market, window, date});
    assert.equal(body.interpreter, 'rules'); assert.match(body.message, new RegExp(date, 'u'));
    assert.equal(body.code, undefined); assert.equal(body.probability, undefined);
  }
});

test('invalid, future, multiple and ambiguous dates clarify without calling AI or falling back to live', async () => {
  let calls = 0;
  const handler = createAssistantHandler({now: () => NOW, fetcher: () => {calls++; throw new Error('No AI expected');}});
  for (const message of ['CL 03-05 code 2027-11-02', 'CL 03-05 code 31st Nov', 'CL 03-05 code 2026-02-29', 'CL 03-05 tomorrow', 'CL 03-05 code 11/2', 'CL 03-05 code Nov 2, 25', 'CL 03-05 2nd Nov and 3rd Nov', 'CL 03-05 2026-11-02 today']) {
    const response = await handler(post(message, '2026-11-02'), {}); assert.equal(response.status, 200, message);
    const body = await response.json(); assert.equal(body.action, 'clarify', message); assert.equal(body.date, null, message);
  }
  assert.equal(calls, 0);
});

test('context dates are optional for legacy clients, strictly validated when present and inherited by exact commands', async () => {
  assert.equal(validateRequest({message: 'CL 03-05', context}, {now: NOW}).context.date, null);
  assert.equal(validateRequest({message: 'CL 03-05', context: {...context, date: '2026-11-02'}}, {now: NOW}).context.date, '2026-11-02');
  for (const date of ['2026-11-06', '2026-02-29', '11/2', 123]) assert.equal(validateRequest({message: 'CL 03-05', context: {...context, date}}, {now: NOW}), null);
  const handler = createAssistantHandler({now: () => NOW});
  const inherited = await (await handler(post('NQ 05-0830', '2026-11-02'), {})).json();
  assert.equal(inherited.date, '2026-11-02');
  for (const phrase of ['today', 'now', '今天', '現在']) {
    const body = await (await handler(post(`CL 03-05 ${phrase}`, '2026-11-02'), {})).json();
    assert.equal(body.action, 'forecast'); assert.equal(body.date, null, phrase);
  }
  const yesterday = await (await handler(post('CL 03-05 yesterday', '2026-11-02'), {})).json();
  assert.equal(yesterday.date, '2026-11-04');
});

test('old cached clients cannot accidentally treat a historical request as today when they drop response.date', async () => {
  let calls = 0;
  const handler = createAssistantHandler({now: () => NOW, fetcher: () => {calls++; throw new Error('Legacy historical requests must stop before AI');}});
  const legacy = message => new Request('https://assistant.test/api/chat', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({message, context})});
  assert.equal(validateRequest({message: 'CL 03-05', context}, {now: NOW}).supportsHistorical, false);
  assert.equal(validateRequest({message: 'CL 03-05', context: {...context, date: null}}, {now: NOW}).supportsHistorical, true);
  for (const message of ['can you fetch the CL 03-05 code of 2nd Nov?', 'CL 03-05 2024-02-29', '請給我CL 03-05的11月2日代碼', 'CL 03-05 yesterday']) {
    const response = await handler(legacy(message), {});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.action, 'clarify'); assert.equal(body.date, null); assert.match(body.message, /Reload SessionPath/u);
    // The old UI ignores date, but must still obey action:clarify and therefore
    // cannot call its live forecast adapter for this response.
    const {date: _discarded, ...oldClientIntent} = body;
    assert.notEqual(oldClientIntent.action, 'forecast');
  }
  const live = await (await handler(legacy('CL 03-05 range'), {})).json();
  assert.equal(live.action, 'forecast'); assert.equal(live.date, null);
  assert.equal(calls, 0);
});

test('AI must preserve deterministic resolved date, while legacy intents without date inherit it', async () => {
  let requestBody;
  const historical = {...context, action: 'explain', concept: 'containment', date: '2026-11-02'};
  const env = {OPENROUTER_API_KEY: 'fake-test-key', ASSISTANT_QUOTA: {getByName: () => ({reserve: async () => ({allowed: true})})}};
  const handler = createAssistantHandler({now: () => NOW, fetcher: async (_url, init) => {requestBody = JSON.parse(init.body); return ai(historical);}});
  const response = await handler(post('Explain containment for CL 03-05 on 2nd Nov'), env);
  assert.equal(response.status, 200); assert.equal((await response.json()).date, '2026-11-02');
  const modelInput = JSON.parse(requestBody.messages[1].content);
  assert.equal(modelInput.resolved_date, '2026-11-02'); assert.equal(modelInput.new_york_today, '2026-11-05');
  assert.equal(modelInput.supportsHistorical, undefined); assert.equal(modelInput.current_context.supportsHistorical, undefined);
  assert.ok(INTENT_SCHEMA.required.includes('date'));
  assert.equal(validateIntent({...context, action: 'forecast', concept: null}, {now: NOW, defaultDate: '2026-11-02'}).date, '2026-11-02');
  for (const date of [null, '2026-10-20', '2027-01-01']) {
    const bad = createAssistantHandler({now: () => NOW, fetcher: async () => ai({...historical, date})});
    const rejected = await bad(post('Explain containment for CL 03-05 on 2nd Nov'), env);
    assert.equal(rejected.status, 503); assert.equal((await rejected.json()).error.code, 'INVALID_AI_RESPONSE');
  }
});
