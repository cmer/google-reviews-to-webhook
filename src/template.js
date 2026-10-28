// Placeholder rendering shared by Slack templates and webhook payload templates.
import { withoutRaw } from './review.js';

export const DEFAULT_TIMEZONE = 'America/Toronto';

const PLACEHOLDER = /\{(\w+)\}/g;
const SINGLE_PLACEHOLDER = /^\{(\w+)\}$/;

/** Slack only needs &, < and > escaped: https://api.slack.com/reference/surfaces/formatting#escaping */
export function escapeSlack(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatDate(iso, timeZone = DEFAULT_TIMEZONE) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso));
}

/** Every review field (except raw) is a placeholder, plus a formatted {date}. */
export function templateVars(review, { timezone } = {}) {
  return { ...withoutRaw(review), date: formatDate(review.createTime, timezone) };
}

/** Replace {key} with vars[key]. Unknown placeholders are left as-is. */
export function renderString(template, vars, escape = String) {
  return template.replace(PLACEHOLDER, (match, key) => (key in vars ? escape(vars[key] ?? '') : match));
}

/**
 * Render every string inside a JSON template.
 *  - objects:   exact string values replaced with whole objects, e.g. { '{{review}}': review }
 *  - keepTypes: a value that is exactly one placeholder ("{rating}") keeps the variable's type
 *  - escapeFor: (jsonKey) => escape function for that string
 */
export function renderJson(node, vars, opts = {}, key = null) {
  if (Array.isArray(node)) return node.map((item) => renderJson(item, vars, opts, key));
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, renderJson(v, vars, opts, k)]));
  }
  if (typeof node !== 'string') return node;
  if (opts.objects && Object.hasOwn(opts.objects, node)) return opts.objects[node];
  const single = node.match(SINGLE_PLACEHOLDER);
  if (opts.keepTypes && single && single[1] in vars) return vars[single[1]];
  return renderString(node, vars, opts.escapeFor?.(key) ?? String);
}
