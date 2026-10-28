// HTTP delivery with retries and exponential backoff.
const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const REQUEST_TIMEOUT_MS = 15_000;

/** Try once, then retry up to `retries` times. Any 2xx is success. Never throws. */
export async function deliver(url, request, { retries = 3, baseDelayMs = 1000, fetchImpl = fetch, sleep = sleepFor, onRetry } = {}) {
  const { method = 'POST', headers, body } = request;
  let error;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const res = await fetchImpl(url, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
        // A redirect means a wrong URL (Slack redirects bad webhook paths to a 200 page), not success.
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return { ok: true, status: res.status, attempts: attempt };
      const text = (await res.text().catch(() => '')).slice(0, 300);
      const location = res.headers.get('location');
      error = `HTTP ${res.status}${location ? ` redirect to ${location}` : ''}${text ? `: ${text}` : ''}`;
    } catch (err) {
      error = err.message;
    }
    if (attempt <= retries) {
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
  return { ok: false, attempts: retries + 1, error };
}
