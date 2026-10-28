// The JSON state file: which review IDs (and which locations) have been processed.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const MAX_SEEN = 2000;

export function emptyState() {
  return { seen: [], locations: [] };
}

/** Returns null when the state file doesn't exist yet (first run). */
export async function loadState(path) {
  let data;
  try {
    data = JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`Cannot read state file ${path}: ${err.message}`);
  }
  return { ...emptyState(), ...data };
}

export async function saveState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2) + '\n');
  await rename(tmp, path);
}

/** Append IDs (most recent last) and keep only the newest `max`. */
export function markSeen(state, ids, max = MAX_SEEN) {
  const added = new Set(ids);
  const seen = [...state.seen.filter((id) => !added.has(id)), ...added].slice(-max);
  return { ...state, seen };
}

const byCreateTime = (a, b) => String(a.createTime).localeCompare(String(b.createTime));

/**
 * Decide what to send. Reviews from locations seen for the first time ("fresh") are recorded
 * silently, except the `backfill` most recent of them. Elsewhere, a review is new when its ID
 * isn't in state, so edited reviews are never re-sent.
 * Returns { send (oldest first), silent }.
 */
export function selectReviews(reviews, state, { freshLocations = [], backfill = 0 } = {}) {
  const fresh = new Set(freshLocations.map(String));
  const seen = new Set(state.seen);
  const initial = reviews.filter((r) => fresh.has(String(r.locationId)));
  const backfilled = backfill > 0 ? [...initial].sort(byCreateTime).slice(-backfill) : [];
  const unseen = reviews.filter((r) => !fresh.has(String(r.locationId)) && !seen.has(r.id));
  const send = [...backfilled, ...unseen].sort(byCreateTime);
  const sending = new Set(send.map((r) => r.id));
  return { send, silent: initial.filter((r) => !sending.has(r.id)) };
}
