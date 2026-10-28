// The internal review shape every source produces and every destination consumes.

const STAR_RATINGS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export const DEFAULT_REPLY_URL = 'https://business.google.com/reviews';

export function starRatingToNumber(starRating) {
  return STAR_RATINGS[starRating] ?? 0;
}

export function starsFor(rating) {
  return '⭐'.repeat(Math.max(0, rating));
}

/**
 * @param raw      a review object from the Business Profile API
 * @param location an entry from config.locations ({ accountId, locationId, name?, replyUrl? })
 * @param summary  the list response, which carries averageRating and totalReviewCount
 */
export function normalizeReview(raw, location = {}, summary = {}) {
  const reviewer = raw.reviewer ?? {};
  const rating = starRatingToNumber(raw.starRating);
  let photoUrl = reviewer.profilePhotoUrl || null;
  if (photoUrl?.startsWith('//')) photoUrl = `https:${photoUrl}`;

  return {
    id: raw.reviewId,
    locationId: location.locationId ?? null,
    locationName: location.name || location.locationId || null,
    name: (!reviewer.isAnonymous && reviewer.displayName?.trim()) || 'Someone',
    photoUrl,
    rating,
    stars: starsFor(rating),
    comment: raw.comment?.trim() ?? '',
    createTime: raw.createTime ?? null,
    updateTime: raw.updateTime ?? null,
    replyUrl: location.replyUrl ?? DEFAULT_REPLY_URL,
    averageRating: summary.averageRating ?? null,
    totalReviewCount: summary.totalReviewCount ?? null,
    raw,
  };
}

export function withoutRaw(review) {
  const { raw: _raw, ...rest } = review;
  return rest;
}

/** A realistic review for `--test`, so layouts and ingesters can be checked without a real one. */
export function sampleReview(location = {}) {
  const now = new Date().toISOString();
  const raw = {
    name: `accounts/${location.accountId}/locations/${location.locationId}/reviews/sample-review`,
    reviewId: 'sample-review',
    reviewer: { displayName: 'Jane Sample', isAnonymous: false },
    starRating: 'FIVE',
    comment: 'Great service & friendly staff!\nThis is a test review sent by google-reviews-to-webhook --test.',
    createTime: now,
    updateTime: now,
  };
  return normalizeReview(raw, location, { averageRating: 4.8, totalReviewCount: 123 });
}
