// One poll: fetch, pick new reviews, route each to its matching destinations, update state.
import { deliver } from './deliver.js';
import { matchesFilters } from './filters.js';
import { sampleReview } from './review.js';
import { buildSlackPayload } from './slack.js';
import { emptyState, loadState, markSeen, saveState, selectReviews } from './state.js';
import { buildWebhookRequest } from './webhook.js';

export function buildRequest(review, dest, ctx) {
  if (dest.type === 'webhook') return buildWebhookRequest(review, dest, ctx);
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(buildSlackPayload(review, dest, ctx)) };
}

/** Send one review to one destination. Logs the outcome and never throws. */
export async function sendTo(dest, review, { config, log, dryRun = false, deliverOptions, print = console.log }) {
  const fields = { destination: dest.name, reviewId: review.id };
  try {
    const request = buildRequest(review, dest, { timezone: config.timezone });
    if (dryRun) {
      print(`--- ${dest.name} (${dest.type}) ${request.method}\n${JSON.stringify(JSON.parse(request.body), null, 2)}`);
      return { ok: true, dryRun: true };
    }
    const result = await deliver(dest.url, request, {
      ...deliverOptions,
      onRetry: ({ attempt, delayMs, error }) => log.warn('delivery.retry', { ...fields, attempt, delayMs, error }),
    });
    if (result.ok) log.info('delivery.ok', { ...fields, status: result.status, attempts: result.attempts });
    else log.error('delivery.failed', { ...fields, attempts: result.attempts, error: result.error });
    return result;
  } catch (err) {
    log.error('delivery.failed', { ...fields, error: err });
    return { ok: false, error: err.message };
  }
}

/** Send a review to every destination whose filters match, in parallel. */
export async function dispatchReview(review, ctx) {
  const targets = ctx.config.destinations.filter((dest) => matchesFilters(review, dest.filters));
  if (targets.length === 0) ctx.log.info('review.unrouted', { reviewId: review.id, rating: review.rating });
  return Promise.all(targets.map((dest) => sendTo(dest, review, ctx)));
}

export async function poll({ config, source, log, backfill = 0, dryRun = false, ...rest }) {
  const ctx = { config, log, dryRun, ...rest };
  const state = (await loadState(config.stateFile)) ?? emptyState();
  const known = new Set(state.locations.map(String));
  const freshLocations = config.locations.map((l) => l.locationId).filter((id) => !known.has(id));

  const reviews = await source.fetchReviews({ full: freshLocations.length > 0 });
  const { send, silent } = selectReviews(reviews, state, { freshLocations, backfill });
  log.info('poll.fetched', { source: source.name, fetched: reviews.length, new: send.length, freshLocations });
  if (freshLocations.length) log.info('state.initialized', { locations: freshLocations, recorded: silent.length, backfill });
  else if (backfill) log.warn('backfill.ignored', { reason: 'only applies on first run; delete the state file to backfill' });

  let next = markSeen({ ...state, locations: [...known, ...freshLocations] }, silent.map((r) => r.id));
  if (!dryRun) await saveState(config.stateFile, next);

  let failed = 0;
  for (const review of send) {
    const results = await dispatchReview(review, ctx);
    failed += results.filter((r) => !r.ok).length;
    // Seen once every matching destination succeeded or ran out of retries.
    next = markSeen(next, [review.id]);
    if (!dryRun) await saveState(config.stateFile, next);
  }
  log.info('poll.done', { sent: send.length, failedDeliveries: failed, dryRun });
  return { sent: send.length, failed };
}

/** `--test <name>`: send a sample review to one destination, ignoring its filters. */
export async function sendTest(name, ctx) {
  const dest = ctx.config.destinations.find((d) => d.name === name);
  if (!dest) {
    const known = ctx.config.destinations.map((d) => d.name).join(', ') || 'none';
    throw new Error(`Unknown destination "${name}". Configured destinations: ${known}`);
  }
  const result = await sendTo(dest, sampleReview(ctx.config.locations[0]), ctx);
  if (!result.ok) throw new Error(`Test delivery to "${name}" failed: ${result.error}`);
}
