/**
 * Whole-word (or whole-phrase), case-insensitive: "wait" matches "Long wait!" but not "waiter".
 * Letters with accents count as letters, so "café" works too.
 */
export function mentions(text, keyword) {
  const escaped = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

/** Does a review pass a destination's filters? A missing filter always passes. */
export function matchesFilters(review, filters = {}) {
  const { minRating, maxRating, requireComment, includeKeywords, excludeKeywords, locations } = filters;
  const comment = review.comment ?? '';
  if (minRating != null && review.rating < minRating) return false;
  if (maxRating != null && review.rating > maxRating) return false;
  if (requireComment && !comment) return false;
  if (locations?.length && !locations.map(String).includes(String(review.locationId))) return false;
  // Include: the comment must mention at least one of these.
  if (includeKeywords?.length && !includeKeywords.some((k) => mentions(comment, k))) return false;
  // Exclude: skip the review if the comment mentions any of these.
  if (excludeKeywords?.length && excludeKeywords.some((k) => mentions(comment, k))) return false;
  return true;
}
