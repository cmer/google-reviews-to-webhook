import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBusinessProfileSource, reviewsUrl, TOKEN_URL } from '../src/sources/businessProfile.js';
import { location, page } from './helpers.js';

const credentials = { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' };

function fakeGoogle({ tokenStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (url === TOKEN_URL) {
      return Response.json(tokenStatus === 200 ? { access_token: 'tok' } : { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, { status: tokenStatus });
    }
    const second = String(url).includes('pageToken=page-2');
    return Response.json(second ? { reviews: [{ ...page.reviews[0], reviewId: 'older' }], averageRating: 4.6, totalReviewCount: 212 } : page);
  };
  return { calls, fetchImpl };
}

test('builds the v4 reviews URL', () => {
  assert.equal(
    reviewsUrl(location),
    'https://mybusiness.googleapis.com/v4/accounts/117829878635658949838/locations/12640715728192214038/reviews?orderBy=updateTime%20desc&pageSize=50',
  );
});

test('refreshes a token, fetches one page and normalizes', async () => {
  const { calls, fetchImpl } = fakeGoogle();
  const reviews = await createBusinessProfileSource({ locations: [location], credentials, fetchImpl }).fetchReviews();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.body.get('grant_type'), 'refresh_token');
  assert.equal(calls[1].init.headers.authorization, 'Bearer tok');
  assert.deepEqual(reviews.map((r) => r.rating), [5, 3, 1, 4]);
  assert.equal(reviews[0].locationName, 'Our Business');
});

test('full fetch follows nextPageToken', async () => {
  const { fetchImpl } = fakeGoogle();
  const reviews = await createBusinessProfileSource({ locations: [location], credentials, fetchImpl }).fetchReviews({ full: true });
  assert.equal(reviews.length, 5);
  assert.equal(reviews.at(-1).id, 'older');
});

test('token errors explain how to recover', async () => {
  const { fetchImpl } = fakeGoogle({ tokenStatus: 400 });
  const source = createBusinessProfileSource({ locations: [location], credentials, fetchImpl });
  await assert.rejects(source.fetchReviews(), /expired or revoked.*npm run auth/);
});
