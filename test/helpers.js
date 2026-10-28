import { readFileSync } from 'node:fs';
import { normalizeReview } from '../src/review.js';

export const page = JSON.parse(readFileSync(new URL('./fixtures/reviews-page.json', import.meta.url), 'utf8'));
export const location = {
  accountId: '117829878635658949838',
  locationId: '12640715728192214038',
  name: 'Our Business',
  replyUrl: 'https://business.google.com/reviews',
};
export const reviews = page.reviews.map((raw) => normalizeReview(raw, location, page));
export const byId = Object.fromEntries(reviews.map((r) => [r.id, r]));
export const silentLog = { info() {}, warn() {}, error() {} };
