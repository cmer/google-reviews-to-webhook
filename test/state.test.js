import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadState, markSeen, saveState, selectReviews } from '../src/state.js';
import { location, reviews } from './helpers.js';

const ids = (list) => list.map((r) => r.id);
const LOC = location.locationId;

test('first run records everything and sends nothing', () => {
  const { send, silent } = selectReviews(reviews, { seen: [] }, { freshLocations: [LOC] });
  assert.deepEqual(send, []);
  assert.deepEqual(ids(silent).sort(), ['rev-five', 'rev-four', 'rev-one', 'rev-three']);
});

test('first run with backfill sends the N most recent, oldest first', () => {
  const { send, silent } = selectReviews(reviews, { seen: [] }, { freshLocations: [LOC], backfill: 2 });
  assert.deepEqual(ids(send), ['rev-three', 'rev-five']);
  assert.deepEqual(ids(silent).sort(), ['rev-four', 'rev-one']);
});

test('later runs send only reviews whose IDs are not in state', () => {
  const state = { seen: ['rev-three', 'rev-one', 'rev-four'] };
  assert.deepEqual(ids(selectReviews(reviews, state).send), ['rev-five']);
});

test('edited reviews are not re-sent', () => {
  const edited = reviews.map((r) => ({ ...r, updateTime: '2026-10-28T00:00:00.000Z' }));
  assert.deepEqual(selectReviews(edited, { seen: ids(reviews) }).send, []);
});

test('backfill is ignored for locations already in state', () => {
  assert.deepEqual(selectReviews(reviews, { seen: ids(reviews) }, { backfill: 5 }).send, []);
});

test('markSeen appends, dedupes and trims to the newest IDs', () => {
  const state = markSeen({ seen: ['a', 'b', 'c'] }, ['b', 'd'], 3);
  assert.deepEqual(state.seen, ['c', 'b', 'd']);
});

test('state round-trips through the file and is null when missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'grtw-'));
  const path = join(dir, 'nested', 'state.json');
  assert.equal(await loadState(path), null);
  await saveState(path, { seen: ['x'], locations: [LOC] });
  const loaded = await loadState(path);
  assert.deepEqual(loaded.seen, ['x']);
  assert.deepEqual(loaded.locations, [LOC]);
  assert.ok(JSON.parse(await readFile(path, 'utf8')).updatedAt);
});
