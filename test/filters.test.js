import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesFilters, mentions } from '../src/filters.js';
import { byId, reviews } from './helpers.js';

const ids = (filters) => reviews.filter((r) => matchesFilters(r, filters)).map((r) => r.id);

test('no filters matches everything', () => {
  assert.deepEqual(ids(undefined), ['rev-five', 'rev-three', 'rev-one', 'rev-four']);
});

test('rating bounds are inclusive', () => {
  assert.deepEqual(ids({ minRating: 4 }), ['rev-five', 'rev-four']);
  assert.deepEqual(ids({ maxRating: 3 }), ['rev-three', 'rev-one']);
  assert.deepEqual(ids({ minRating: 3, maxRating: 4 }), ['rev-three', 'rev-four']);
});

test('requireComment drops reviews without text', () => {
  assert.deepEqual(ids({ requireComment: true }), ['rev-five', 'rev-one', 'rev-four']);
});

test('includeKeywords sends only reviews that mention one of them', () => {
  assert.deepEqual(ids({ includeKeywords: ['refund', 'RUDE'] }), ['rev-one', 'rev-four']);
  assert.equal(matchesFilters(byId['rev-three'], { includeKeywords: ['anything'] }), false);
});

test('excludeKeywords skips reviews that mention any of them', () => {
  assert.deepEqual(ids({ excludeKeywords: ['refund', 'rude'] }), ['rev-five', 'rev-three']);
  assert.deepEqual(ids({ includeKeywords: ['wait', 'parking'], excludeKeywords: ['refund'] }), ['rev-one']);
});

test('keywords match whole words and phrases, case-insensitively', () => {
  assert.equal(mentions('Long wait & rude staff.', 'wait'), true);
  assert.equal(mentions('Our waiter was great', 'wait'), false);
  assert.equal(mentions('Rude   STAFF everywhere', 'rude staff'), true);
  assert.equal(mentions('Le café était froid', 'café'), true);
  assert.equal(mentions('Le cafés', 'café'), false);
  assert.equal(mentions('Cost $5 (cash)', '(cash)'), true);
});

test('locations limits by location ID', () => {
  assert.equal(matchesFilters(byId['rev-five'], { locations: ['12640715728192214038'] }), true);
  assert.equal(matchesFilters(byId['rev-five'], { locations: ['999'] }), false);
});
