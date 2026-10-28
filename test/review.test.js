import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeReview, starRatingToNumber, starsFor } from '../src/review.js';
import { byId, location, page } from './helpers.js';

test('maps starRating enums to numbers', () => {
  assert.deepEqual(['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'].map(starRatingToNumber), [1, 2, 3, 4, 5]);
  assert.equal(starRatingToNumber('STAR_RATING_UNSPECIFIED'), 0);
  assert.equal(starsFor(3), '⭐⭐⭐');
});

test('normalizes a review', () => {
  const review = byId['rev-five'];
  assert.deepEqual(
    { ...review, raw: undefined },
    {
      id: 'rev-five',
      locationId: '12640715728192214038',
      locationName: 'Our Business',
      name: 'Marie Tremblay',
      photoUrl: 'https://lh3.googleusercontent.com/a/photo-five=s120-c',
      rating: 5,
      stars: '⭐⭐⭐⭐⭐',
      comment: 'Excellent service!\nWill come back.',
      createTime: '2026-10-27T18:30:00.000Z',
      updateTime: '2026-10-27T18:30:00.000Z',
      replyUrl: 'https://business.google.com/reviews',
      averageRating: 4.6,
      totalReviewCount: 212,
      raw: undefined,
    },
  );
  assert.equal(review.raw, page.reviews[0]);
});

test('anonymous reviewers become "Someone" and missing comments are empty', () => {
  const review = byId['rev-three'];
  assert.equal(review.name, 'Someone');
  assert.equal(review.comment, '');
  assert.equal(review.photoUrl, null);
  assert.equal(normalizeReview({ reviewId: 'x', reviewer: { displayName: '  ' }, starRating: 'TWO' }, location).name, 'Someone');
});

test('protocol-relative photo URLs get https', () => {
  assert.equal(byId['rev-one'].photoUrl, 'https://lh3.googleusercontent.com/a/photo-one');
});

test('location name falls back to the location ID', () => {
  const review = normalizeReview(page.reviews[0], { locationId: '42' });
  assert.equal(review.locationName, '42');
});
