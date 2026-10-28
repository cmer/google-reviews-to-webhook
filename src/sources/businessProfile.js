// Review source: the Google Business Profile API (reviews are still served by v4).
//
// A source is any object with `name` and `fetchReviews({ full }) -> NormalizedReview[]`.
// `full: true` asks for every review the source can reach (used the first time a location is
// seen), otherwise only the most recently updated ones are needed.
import { normalizeReview } from '../review.js';

export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const API_BASE = 'https://mybusiness.googleapis.com/v4';
const PAGE_SIZE = 50;
const MAX_PAGES = 40; // 2,000 reviews, the size of the state file
const TIMEOUT_MS = 30_000;

export async function getAccessToken({ clientId, clientSecret, refreshToken }, fetchImpl = fetch) {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const reason = (data.error_description ?? data.error ?? 'no access_token in response').replace(/\.$/, '');
    throw new Error(`OAuth token refresh failed (HTTP ${res.status}): ${reason}. Run \`npm run auth\` to get a new refresh token.`);
  }
  return data.access_token;
}

export function reviewsUrl({ accountId, locationId }, pageToken) {
  let url = `${API_BASE}/accounts/${accountId}/locations/${locationId}/reviews?orderBy=updateTime%20desc&pageSize=${PAGE_SIZE}`;
  if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
  return url;
}

export function createBusinessProfileSource({ locations, credentials, fetchImpl = fetch }) {
  return {
    name: 'google_business_profile',
    async fetchReviews({ full = false } = {}) {
      const token = await getAccessToken(credentials, fetchImpl);
      const reviews = [];
      for (const location of locations) {
        let pageToken;
        for (let page = 0; page < (full ? MAX_PAGES : 1); page++) {
          const res = await fetchImpl(reviewsUrl(location, pageToken), {
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          if (!res.ok) {
            const body = (await res.text().catch(() => '')).slice(0, 500);
            throw new Error(`Business Profile API error for location ${location.locationId} (HTTP ${res.status}): ${body}`);
          }
          const data = await res.json();
          for (const raw of data.reviews ?? []) reviews.push(normalizeReview(raw, location, data));
          pageToken = data.nextPageToken;
          if (!pageToken) break;
        }
      }
      return reviews;
    },
  };
}
