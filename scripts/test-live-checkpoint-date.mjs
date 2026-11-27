import assert from 'node:assert/strict';
import test from 'node:test';
import {createSavedCheckpointReader} from '../docs/saved-forecast-checkpoints.mjs';

const windows = [{cutoff:'03:00',minute:180},{cutoff:'05:00',minute:300},{cutoff:'08:30',minute:510}];
const today = '2026-11-27', yesterday = '2026-11-26';

function archive(records) {
  const requests = [];
  const reader = createSavedCheckpointReader({
    market: 'CL', endpoint: 'https://example.test/history', windows,
    parse: (body,{cutoff}) => body.includes(cutoff) ? {snapshot:{cutoff}} : null,
    fetchImpl: async url => {
      const date = url.searchParams.get('date');
      requests.push(date);
      return Response.json(records[date] ?? []);
    }
  });
  return {reader,requests};
}

test('06:00 NY with yesterday complete and today missing looks up today only', async () => {
  const {reader, requests} = archive({[yesterday]:windows.map(w=>w.cutoff)});
  assert.equal(await reader({date:today,minute:360}), null);
  assert.deepEqual(requests, [today]);
  const replay = await reader.forDate(yesterday);
  assert.equal(replay.records[2].snapshot.cutoff, '08:30');
});

test('cutoff boundaries and same-day saved recovery', async () => {
  const {reader, requests} = archive({[today]:windows.map(w=>w.cutoff)});
  assert.equal(await reader({date:today,minute:179}), null);
  assert.deepEqual(requests, []);
  for (const [minute, cutoff] of [[180,'03:00'],[299,'03:00'],[300,'05:00'],[509,'05:00'],[510,'08:30'],[960,'08:30']]) {
    const result = await reader({date:today,minute});
    assert.equal(result.date, today);
    assert.equal(result.record.snapshot.cutoff, cutoff);
  }
  assert.deepEqual(requests, [today]);
});

test('an earlier or future checkpoint cannot fill a missing active window', async () => {
  const {reader} = archive({[today]:['03:00','08:30']});
  assert.equal(await reader({date:today,minute:360}), null);
});
