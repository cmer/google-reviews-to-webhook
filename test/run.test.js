import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { deliver } from '../src/deliver.js';
import { poll, sendTest } from '../src/run.js';
import { loadState } from '../src/state.js';
import { location, reviews, silentLog } from './helpers.js';

const noSleep = async () => {};

test('deliver retries with exponential backoff, then gives up', async () => {
  const delays = [];
  let calls = 0;
  const result = await deliver('https://x', { body: '{}' }, {
    fetchImpl: async () => (calls++, new Response('nope', { status: 500 })),
    sleep: async (ms) => delays.push(ms),
  });
  assert.equal(calls, 4);
  assert.deepEqual(delays, [1000, 2000, 4000]);
  assert.deepEqual(result, { ok: false, attempts: 4, error: 'HTTP 500: nope' });
});

test('deliver treats redirects as failures', async () => {
  const fetchImpl = async (_url, init) => {
    assert.equal(init.redirect, 'manual');
    return new Response(null, { status: 302, headers: { location: 'https://example.com/404' } });
  };
  const result = await deliver('https://x', { body: '{}' }, { fetchImpl, sleep: noSleep, retries: 0 });
  assert.deepEqual(result, { ok: false, attempts: 1, error: 'HTTP 302 redirect to https://example.com/404' });
});

test('deliver succeeds on any 2xx after a failure', async () => {
  let calls = 0;
  const fetchImpl = async () => (++calls === 1 ? Promise.reject(new Error('ECONNRESET')) : new Response(null, { status: 204 }));
  assert.deepEqual(await deliver('https://x', { body: '{}' }, { fetchImpl, sleep: noSleep }), { ok: true, status: 204, attempts: 2 });
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'grtw-'));
  const sent = [];
  const config = {
    timezone: 'America/Toronto',
    stateFile: join(dir, 'state.json'),
    locations: [location],
    destinations: [
      { name: 'office', type: 'slack', url: 'https://office', filters: {} },
      { name: 'general', type: 'slack', url: 'https://general', filters: { minRating: 4 } },
      { name: 'broken', type: 'webhook', url: 'https://broken', filters: {} },
    ],
  };
  const fetchImpl = async (url, init) => {
    if (url === 'https://broken') return new Response('down', { status: 503 });
    sent.push({ url, body: JSON.parse(init.body) });
    return new Response('ok');
  };
  let current = reviews.slice(2); // rev-one and rev-four exist at first
  const source = { name: 'fake', fetchReviews: async () => current };
  const ctx = { config, source, log: silentLog, deliverOptions: { fetchImpl, sleep: noSleep } };
  return { ctx, sent, setReviews: (list) => (current = list) };
}

test('poll: first run is silent, then new reviews route by filter and failures do not block', async () => {
  const { ctx, sent, setReviews } = await setup();

  assert.deepEqual(await poll(ctx), { sent: 0, failed: 0 });
  assert.equal(sent.length, 0);
  assert.deepEqual((await loadState(ctx.config.stateFile)).seen.sort(), ['rev-four', 'rev-one']);

  setReviews(reviews); // rev-five (5★) and rev-three (3★) arrive
  assert.deepEqual(await poll(ctx), { sent: 2, failed: 2 });
  assert.deepEqual(
    sent.map((s) => `${s.url} ${s.body.text.split('\n')[0]}`),
    [
      'https://office Someone left a 3 star Google Review   ⭐⭐⭐',
      'https://office Marie Tremblay left a 5 star Google Review   ⭐⭐⭐⭐⭐',
      'https://general Marie Tremblay left a 5 star Google Review   ⭐⭐⭐⭐⭐',
    ],
  );
  assert.equal((await loadState(ctx.config.stateFile)).seen.length, 4);

  assert.deepEqual(await poll(ctx), { sent: 0, failed: 0 });
});

test('poll: --backfill on first run and --dry-run prints without sending or saving', async () => {
  const { ctx, sent } = await setup();
  const printed = [];
  await poll({ ...ctx, backfill: 1, dryRun: true, print: (s) => printed.push(s) });
  assert.equal(sent.length, 0);
  assert.equal(printed.length, 2); // rev-one (1★) goes to office and broken, not general
  assert.match(printed[0], /^--- office \(slack\) POST\n/);
  assert.equal(await loadState(ctx.config.stateFile), null);
});

test('sendTest sends a sample review to one destination, ignoring filters', async () => {
  const { ctx, sent } = await setup();
  await sendTest('general', ctx);
  assert.equal(sent.length, 1);
  assert.match(sent[0].body.text, /^Jane Sample left a 5 star Google Review/);
  await assert.rejects(sendTest('nope', ctx), /Unknown destination "nope"/);
  await assert.rejects(sendTest('broken', ctx), /failed/);
});
