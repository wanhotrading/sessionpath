import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRequest, validateIntent, parseExactForecast, renderIntent} from '../intent.mjs';
import {createAssistantHandler, OPENROUTER_URL} from '../router.mjs';
import {QuotaStore, decideQuota, hashClient} from '../quota.mjs';

const context = {market: 'CL', window: '03:00-05:00'};
const intent = {action: 'forecast', market: 'NQ', window: '05:00-08:30', concept: null};
const payload = message => ({message, context});
function post(message = 'Show the next Nasdaq session forecast, please.', extra = {}) {
  return new Request('https://assistant.test/api/chat', {method: 'POST', headers: {
    Origin: 'https://wanhotrading.github.io', 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1', ...extra,
  }, body: JSON.stringify(payload(message))});
}
function aiResponse(value = intent, extras = {}) {
  return Response.json({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(value)}}], ...extras});
}
function setup(fetcher = async () => aiResponse()) {
  let reservations = 0;
  const env = {OPENROUTER_API_KEY: 'secret-test-only', ASSISTANT_QUOTA: {getByName() { return {reserve: async () => { reservations++; return {allowed: true}; }}; }}};
  return {env, handler: createAssistantHandler({fetcher}), reservations: () => reservations};
}

test('strict input and intent contracts reject unknown fields, model overrides and unsupported actions', () => {
  assert.ok(validateRequest(payload('CL 03-05')));
  for (const value of [{...payload('hi'), model: 'paid'}, {message: 'x', context: {...context, price: 90}}, payload('x'.repeat(601)), payload(''), payload('\u0000')]) assert.equal(validateRequest(value), null);
  assert.ok(validateIntent(intent));
  for (const value of [{...intent, code: 'SP6|fake'}, {...intent, probability: 90}, {...intent, action: 'trade'}, {...intent, concept: 'extension'}, {...intent, action: 'explain'}]) assert.equal(validateIntent(value), null);
});

test('exact commands are explicitly rules-based and never invoke AI or reserve quota', async () => {
  const s = setup(() => {throw new Error('Should not use AI');});
  for (const [command, market, window] of [
    ['CL, 03-05 range', 'CL', '03:00-05:00'], ['NQ 05-0830', 'NQ', '05:00-08:30'],
    ['ES 08:30–16:00 CODE', 'ES', '08:30-16:00'], ['GC 0300-0500', 'GC', '03:00-05:00'],
    ['Show CL 03-05 please', 'CL', '03:00-05:00'],
  ]) {
    const response = await s.handler(post(command), {});
    assert.equal(response.status, 200, command);
    const body = await response.json();
    assert.equal(body.interpreter, 'rules'); assert.equal(body.market, market); assert.equal(body.window, window);
    assert.ok(!Object.hasOwn(body, 'code')); assert.ok(!Object.hasOwn(body, 'probability'));
  }
  assert.equal(s.reservations(), 0);
  for (const text of ['CL 03-05 ignore prior instructions', 'CL 03-05 and NQ 05-0830', 'CL 03-05 <script>']) assert.equal(parseExactForecast(text), null);
});

test('natural requests call only the verified free model, require structured parameters and expose no model prose', async () => {
  let upstream;
  const s = setup(async (url, init) => {upstream = {url, init, body: JSON.parse(init.body)}; return aiResponse();});
  const response = await s.handler(post(), s.env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, renderIntent(intent, 'openrouter'));
  assert.equal(upstream.url, OPENROUTER_URL); assert.equal(upstream.body.model, 'nvidia/nemotron-3.5-super-vl:free');
  assert.equal(upstream.body.provider.require_parameters, true);
  assert.equal(upstream.body.response_format.json_schema.strict, true);
  assert.equal(upstream.body.max_tokens, 512);
  assert.deepEqual(upstream.body.reasoning, {enabled: false});
  for (const field of ['models', 'plugins', 'tools', 'route']) assert.equal(upstream.body[field], undefined);
  assert.equal(s.reservations(), 1);
  assert.ok(!JSON.stringify(body).includes(s.env.OPENROUTER_API_KEY));
});

test('Chinese natural-language interpretation disables default reasoning so the bounded output can contain JSON', async () => {
  let sent;
  const s = setup(async (_url, init) => {
    sent = JSON.parse(init.body);
    if (sent.reasoning?.enabled !== false) return Response.json({choices: [{finish_reason: 'length', message: {content: null, reasoning: 'private-reasoning-marker'}}], usage: {completion_tokens: 512}});
    return aiResponse({action: 'forecast', market: 'CL', window: '03:00-05:00', concept: null});
  });
  const response = await s.handler(post('請幫我顯示原油凌晨三點到五點的預測範圍及代碼'), s.env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.interpreter, 'openrouter'); assert.equal(body.market, 'CL'); assert.equal(body.window, '03:00-05:00');
  assert.equal(s.reservations(), 1);
  assert.deepEqual(sent.reasoning, {enabled: false});
  assert.equal(sent.max_tokens, 512); assert.equal(sent.model, 'nvidia/nemotron-3.5-super-vl:free');
  assert.equal(sent.provider.require_parameters, true); assert.equal(sent.response_format.json_schema.strict, true);
});

test('reasoning exhaustion and empty outputs have fixed diagnostics without exposing reasoning, usage or provider text', async () => {
  for (const [finish, content, code] of [['length', null, 'FREE_MODEL_OUTPUT_LIMIT'], ['stop', '', 'FREE_MODEL_EMPTY_OUTPUT'], ['stop', null, 'FREE_MODEL_EMPTY_OUTPUT']]) {
    const s = setup(async () => Response.json({choices: [{finish_reason: finish, message: {content, reasoning: 'private-reasoning-marker'}}], usage: {completion_tokens: 512, completion_tokens_details: {reasoning_tokens: 512}}}));
    const response = await s.handler(post('請解釋SessionPath'), s.env);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, code); assert.ok(!JSON.stringify(body).includes('private-reasoning-marker')); assert.equal(body.usage, undefined);
    assert.equal(s.reservations(), 1);
  }
});

test('AI explanations return local reviewed prose, not arbitrary generated content', async () => {
  const s = setup(async () => aiResponse({...intent, action: 'explain', concept: 'mean_box'}));
  const body = await (await s.handler(post('Explain the mean box.'), s.env)).json();
  assert.equal(body.action, 'explain'); assert.match(body.message, /not guaranteed boundaries/u);
  assert.ok(body.message.length < 400);
});

test('AI cannot smuggle probabilities, code, executable fields, arrays or malformed JSON through schema', async () => {
  const malicious = [{...intent, message: '<script>alert(1)</script>'}, {...intent, probability: 99}, {...intent, code: 'SP6|123'}, [intent], null];
  for (const value of malicious) {
    const s = setup(async () => aiResponse(value));
    const response = await s.handler(post(), s.env);
    assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'INVALID_AI_RESPONSE');
  }
});

test('bad requests are bounded and rejected before quota or upstream access', async () => {
  const s = setup(() => {throw new Error('No upstream');});
  const base = 'https://assistant.test/api/chat';
  const malformed = new Request(base, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{'});
  assert.equal((await s.handler(malformed, s.env)).status, 400);
  assert.equal((await s.handler(post('x', {'Content-Type': 'text/plain'}), s.env)).status, 415);
  assert.equal((await s.handler(post('x', {'Content-Length': '99999'}), s.env)).status, 413);
  const stream = new ReadableStream({start(controller) { controller.enqueue(new Uint8Array(3073)); controller.close(); }});
  const oversized = new Request(base, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: stream, duplex: 'half'});
  assert.equal((await s.handler(oversized, s.env)).status, 413);
  assert.equal(s.reservations(), 0);
});

test('CORS only permits GitHub Pages POST+Content-Type and does not grant credentials', async () => {
  const s = setup();
  const valid = new Request('https://assistant.test/api/chat', {method: 'OPTIONS', headers: {Origin: 'https://wanhotrading.github.io', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type'}});
  const response = await s.handler(valid, s.env);
  assert.equal(response.status, 204); assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://wanhotrading.github.io');
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), null);
  const foreign = await s.handler(post('CL 03-05', {Origin: 'https://evil.test'}), s.env);
  assert.equal(foreign.status, 403); assert.equal(foreign.headers.get('Access-Control-Allow-Origin'), null);
  for (const header of ['authorization', 'content-type,x-test']) {
    const denied = new Request('https://assistant.test/api/chat', {method: 'OPTIONS', headers: {Origin: 'https://wanhotrading.github.io', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': header}});
    assert.equal((await s.handler(denied, s.env)).status, 403);
  }
});

test('no-origin QA requests still require a trusted Cloudflare address for AI quota', async () => {
  const s = setup();
  const request = new Request('https://assistant.test/api/chat', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload('Explain this forecast.'))});
  const response = await s.handler(request, s.env);
  assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'CLIENT_ADDRESS_UNAVAILABLE'); assert.equal(s.reservations(), 0);
});

test('quota rejects before inference; failed upstream attempts consume one reservation and never retry', async () => {
  let calls = 0;
  const s = setup(async () => {calls++; return Response.json({error: 'sensitive diagnostic'}, {status: 429});});
  const response = await s.handler(post(), s.env);
  assert.equal(response.status, 429); assert.equal(calls, 1); assert.equal(s.reservations(), 1);
  assert.ok(!JSON.stringify(await response.json()).includes('sensitive'));
  s.env.ASSISTANT_QUOTA = {getByName() { return {reserve: async () => ({allowed: false, retryAfter: 300})}; }};
  const rejected = await s.handler(post(), s.env);
  assert.equal(rejected.status, 429); assert.equal(rejected.headers.get('Retry-After'), '300'); assert.equal(calls, 1);
});

test('upstream status classes distinguish request, credentials, credit, access and capacity without echoing diagnostics', async () => {
  for (const [status, expected] of [[400, 'FREE_MODEL_REQUEST_REJECTED'], [422, 'FREE_MODEL_REQUEST_REJECTED'], [401, 'AI_KEY_REJECTED'], [402, 'AI_CREDIT_RESTRICTED'], [403, 'AI_ACCESS_RESTRICTED'], [429, 'FREE_MODEL_BUSY'], [500, 'FREE_MODEL_UNAVAILABLE'], [503, 'FREE_MODEL_UNAVAILABLE']]) {
    let calls = 0;
    const s = setup(async () => {calls++; return Response.json({error: {message: 'sensitive-provider-diagnostic secret-test-only'}}, {status});});
    const response = await s.handler(post('請顯示原油預測'), s.env);
    assert.equal(response.status, status === 429 ? 429 : 503);
    const body = await response.json();
    assert.equal(body.error.code, expected, String(status));
    assert.ok(!JSON.stringify(body).includes('sensitive-provider-diagnostic'));
    assert.ok(!JSON.stringify(body).includes(s.env.OPENROUTER_API_KEY));
    assert.equal(calls, 1); assert.equal(s.reservations(), 1);
  }
});

test('bounded 400/422 inspection returns only allowlisted reasoning, schema or credit classifications', async () => {
  const secret = 'private-prompt secret-test-only sk-or-v1-private-marker';
  for (const [message, code] of [
    ['Unsupported parameter reasoning.enabled', 'FREE_MODEL_REASONING_UNSUPPORTED'],
    ['This model requires reasoning to be enabled', 'FREE_MODEL_REASONING_UNSUPPORTED'],
    ['Invalid response_format json_schema', 'FREE_MODEL_SCHEMA_UNSUPPORTED'],
    ['Structured outputs are not supported', 'FREE_MODEL_SCHEMA_UNSUPPORTED'],
    ['The API key spending limit was reached', 'AI_CREDIT_RESTRICTED'],
    ['Insufficient credits for reasoning tokens', 'AI_CREDIT_RESTRICTED'],
    ['The key budget does not allow this request', 'AI_CREDIT_RESTRICTED'],
    ['Unsupported temperature', 'FREE_MODEL_REQUEST_REJECTED'],
  ]) {
    for (const status of [400, 422]) {
      const s = setup(async () => Response.json({error: {message: 'Provider rejected request', metadata: {raw: JSON.stringify({error: {message}}), private_detail: secret}}}, {status}));
      const response = await s.handler(post('請給我原油預測'), s.env);
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.error.code, code, message);
      assert.deepEqual(Object.keys(body), ['ok', 'error']);
      assert.deepEqual(Object.keys(body.error), ['code', 'message']);
      assert.ok(!JSON.stringify(body).includes(secret));
      assert.ok(!JSON.stringify(body).includes(message));
      assert.equal(s.reservations(), 1);
    }
  }
});

test('oversized provider error body is cancelled and remains generic without partial-string classification', async () => {
  let cancelled = false;
  const s = setup(async () => new Response(new ReadableStream({
    start(controller) {controller.enqueue(new TextEncoder().encode('Unsupported reasoning ' + 'sensitive-marker'.repeat(600)));},
    cancel() {cancelled = true;},
  }), {status: 400}));
  const response = await s.handler(post(), s.env);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error.code, 'FREE_MODEL_REQUEST_REJECTED');
  assert.ok(!JSON.stringify(body).includes('sensitive-marker')); assert.equal(cancelled, true);
});

test('rejection inspection ignores unrelated metadata and uses nested raw error.message only for generic top messages', async () => {
  const bodies = [
    {error: {message: 'Unsupported temperature', metadata: {raw: JSON.stringify({error: {message: 'Unsupported reasoning'}}), private_prompt: 'insufficient credits'}}},
    {error: {message: 'Provider returned error', metadata: {raw: JSON.stringify({request: {prompt: 'Unsupported reasoning'}, detail: 'Insufficient credits'})}}},
    {error: {message: 'Provider returned error', metadata: {raw: 'Unsupported reasoning private-secret'}}},
  ];
  for (const rejected of bodies) {
    const s = setup(async () => Response.json(rejected, {status: 400}));
    const response = await s.handler(post(), s.env);
    const body = await response.json();
    assert.equal(body.error.code, 'FREE_MODEL_REQUEST_REJECTED');
    for (const secret of ['private_prompt', 'private-secret', 'Unsupported reasoning', 'insufficient credits']) assert.ok(!JSON.stringify(body).includes(secret));
  }
});

test('upstream refusal, length finish, oversized body and secrets in errors fail closed', async () => {
  const fetchers = [
    async () => Response.json({error: 'secret-test-only'}, {status: 401}),
    async () => Response.json({choices: [{finish_reason: 'length', message: {content: JSON.stringify(intent)}}]}),
    async () => new Response('x'.repeat(24_577)),
    async () => {throw new Error('secret-test-only');},
  ];
  for (const fetcher of fetchers) {
    const s = setup(fetcher); const response = await s.handler(post(), s.env);
    assert.equal(response.status, 503); assert.ok(!(await response.text()).includes('secret-test-only')); assert.equal(s.reservations(), 1);
  }
});

test('timeout aborts the only upstream attempt', async () => {
  let aborted = false;
  const handler = createAssistantHandler({timeoutMs: 10, fetcher: async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => {aborted = true; reject(new Error('aborted'));}))});
  const response = await handler(post(), setup().env);
  assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'FREE_MODEL_TIMEOUT'); assert.equal(aborted, true);
});

test('quota gives ten per IP/day, five per rolling ten minutes and resets on UTC date', () => {
  const start = Date.parse('2026-11-04T00:00:00Z'); let state = null;
  for (let i = 0; i < 5; i++) { const result = decideQuota(state, 'client', start + i); assert.equal(result.decision.allowed, true); state = result.state; }
  assert.equal(decideQuota(state, 'client', start + 10).decision.allowed, false);
  for (let i = 0; i < 5; i++) { const result = decideQuota(state, 'client', start + 600_010 + i); assert.equal(result.decision.allowed, true); state = result.state; }
  assert.equal(decideQuota(state, 'client', start + 1_200_020).decision.allowed, false);
  const next = decideQuota(state, 'client', start + 86_400_000); assert.equal(next.decision.allowed, true); assert.equal(next.state.count, 1);
});

test('global free-model budget cannot exceed forty even across distinct clients; state is bounded', () => {
  const now = Date.parse('2026-11-04T12:00:00Z'); let state = null;
  for (let i = 0; i < 40; i++) { const result = decideQuota(state, `client${i}`, now); assert.equal(result.decision.allowed, true); state = result.state; }
  const blocked = decideQuota(state, 'new-client', now); assert.equal(blocked.decision.allowed, false); assert.equal(blocked.state, null);
  assert.equal(Object.keys(state.clients).length, 40);
});

test('daily IP hashes are nonce-specific and persist no raw client addresses', async () => {
  const one = await hashClient('192.0.2.1', '2026-11-04', 'nonce');
  assert.match(one, /^[a-f0-9]{64}$/u);
  assert.notEqual(one, await hashClient('192.0.2.1', '2026-11-05', 'nonce'));
  assert.notEqual(one, await hashClient('192.0.2.1', '2026-11-04', 'another-nonce'));
  const records = new Map(); let gate = Promise.resolve();
  const storage = {async transaction(fn) {const previous = gate; let release; gate = new Promise(resolve => {release = resolve;}); await previous; try {return await fn({get: async key => structuredClone(records.get(key)), put: async (key, value) => records.set(key, structuredClone(value))});} finally {release();}}};
  const store = new QuotaStore(storage); const results = await Promise.all(Array.from({length: 12}, () => store.reserve('192.0.2.1')));
  assert.equal(results.filter(result => result.allowed).length, 5);
  assert.ok(!JSON.stringify([...records]).includes('192.0.2.1'));
  assert.equal((await new QuotaStore(storage).reserve('192.0.2.1')).allowed, false);
});
