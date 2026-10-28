import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWebhookRequest, sign } from '../src/webhook.js';
import { byId } from './helpers.js';

const review = byId['rev-five'];
const ctx = { timezone: 'America/Toronto', now: () => 1_700_000_000_000 };

test('default payload wraps the review without raw', () => {
  const req = buildWebhookRequest(review, {}, ctx);
  const body = JSON.parse(req.body);
  assert.equal(req.method, 'POST');
  assert.equal(req.headers['content-type'], 'application/json');
  assert.equal(body.event, 'review.created');
  assert.equal(body.source, 'google_business_profile');
  assert.equal(body.review.id, 'rev-five');
  assert.equal(body.review.rating, 5);
  assert.equal('raw' in body.review, false);
});

test('includeRaw adds the original Google object', () => {
  const body = JSON.parse(buildWebhookRequest(review, { includeRaw: true }, ctx).body);
  assert.deepEqual(body.review.raw, review.raw);
});

test('payload templates substitute placeholders and keep types', () => {
  const payloadTemplateJson = {
    title: '{name} left {rating} stars',
    rating: '{rating}',
    average: '{averageRating}',
    photo: '{photoUrl}',
    nested: [{ when: '{date}' }],
    review: '{{review}}',
    original: '{{raw}}',
    untouched: 7,
  };
  const body = JSON.parse(buildWebhookRequest(byId['rev-three'], { payloadTemplateJson }, ctx).body);
  assert.equal(body.title, 'Someone left 3 stars');
  assert.equal(body.rating, 3);
  assert.equal(body.average, 4.6);
  assert.equal(body.photo, null);
  assert.equal(body.nested[0].when, 'Oct 26, 2026, 8:00 AM');
  assert.equal(body.review.id, 'rev-three');
  assert.equal('raw' in body.review, false);
  assert.deepEqual(body.original, byId['rev-three'].raw);
  assert.equal(body.untouched, 7);
});

test('method and custom headers', () => {
  const req = buildWebhookRequest(review, { method: 'put', headers: { Authorization: 'Bearer s3cret', 'Content-Type': 'application/vnd.x+json' } }, ctx);
  assert.equal(req.method, 'PUT');
  assert.equal(req.headers.authorization, 'Bearer s3cret');
  assert.equal(req.headers['content-type'], 'application/vnd.x+json');
});

test('signing adds an HMAC-SHA256 signature of the body and a timestamp', () => {
  const req = buildWebhookRequest(review, { signingSecret: 'key' }, ctx);
  assert.equal(req.headers['x-timestamp'], '1700000000');
  assert.equal(req.headers['x-signature'], sign(req.body, 'key'));
  assert.match(req.headers['x-signature'], /^[0-9a-f]{64}$/);
});
