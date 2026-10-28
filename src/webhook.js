// "Standard" destinations: JSON to any HTTP endpoint, optionally templated and signed.
import { createHmac } from 'node:crypto';
import { withoutRaw } from './review.js';
import { renderJson, templateVars } from './template.js';

export const EVENT = 'review.created';
export const SOURCE = 'google_business_profile';

export function buildWebhookPayload(review, dest = {}, ctx = {}) {
  const reviewOut = dest.includeRaw ? review : withoutRaw(review);
  if (!dest.payloadTemplateJson) return { event: EVENT, source: SOURCE, review: reviewOut };
  return renderJson(dest.payloadTemplateJson, templateVars(review, ctx), {
    keepTypes: true,
    objects: { '{{review}}': reviewOut, '{{raw}}': review.raw },
  });
}

export function sign(body, secret) {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/** Returns { method, headers, body } ready for fetch. */
export function buildWebhookRequest(review, dest = {}, { now = Date.now, ...ctx } = {}) {
  const body = JSON.stringify(buildWebhookPayload(review, dest, ctx));
  const headers = new Headers({ 'content-type': 'application/json', 'user-agent': 'google-reviews-to-webhook' });
  for (const [name, value] of Object.entries(dest.headers ?? {})) headers.set(name, String(value));

  if (dest.signingSecret) {
    headers.set('x-timestamp', String(Math.floor(now() / 1000)));
    headers.set('x-signature', sign(body, dest.signingSecret));
  }

  return { method: (dest.method ?? 'POST').toUpperCase(), headers: Object.fromEntries(headers), body };
}
