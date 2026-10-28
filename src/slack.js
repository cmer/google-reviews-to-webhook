// Slack incoming-webhook payloads: plain text (the Zapier format) or Block Kit.
import { escapeSlack, renderJson, renderString, templateVars } from './template.js';

export const DEFAULT_TEXT_TEMPLATE = '{name} left a {rating} star Google Review   {stars}\n\n{comment}';
const SECTION_TEXT_LIMIT = 3000;
const COLORS = { good: '#2eb67d', neutral: '#ecb22e', bad: '#e01e5a' };

export function colorFor(rating) {
  if (rating >= 4) return COLORS.good;
  if (rating === 3) return COLORS.neutral;
  return COLORS.bad;
}

export function quote(text) {
  return text.split('\n').map((line) => `>${line}`).join('\n');
}

export function truncate(text, limit = SECTION_TEXT_LIMIT) {
  if (text.length <= limit) return text;
  // Don't leave half an HTML entity or half a surrogate pair at the cut.
  return text.slice(0, limit - 1).replace(/&[a-z]*$/, '').replace(/[\uD800-\uDBFF]$/, '') + '…';
}

export function buildSlackText(review, dest = {}, ctx = {}) {
  const vars = templateVars(review, ctx);
  return renderString(dest.template ?? DEFAULT_TEXT_TEMPLATE, vars, escapeSlack).trimEnd();
}

export function defaultBlocks(review, vars) {
  const header = {
    type: 'section',
    text: { type: 'mrkdwn', text: `${review.stars}  *${escapeSlack(review.name)}* left a *${review.rating}-star* Google review` },
  };
  if (review.photoUrl) header.accessory = { type: 'image', image_url: review.photoUrl, alt_text: review.name };
  const blocks = [header];

  if (review.comment) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: truncate(quote(escapeSlack(review.comment))) } });
  }

  const context = [vars.locationName && escapeSlack(vars.locationName), vars.date];
  if (vars.averageRating != null) context.push(`Average ${vars.averageRating} from ${vars.totalReviewCount} reviews`);
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: context.filter(Boolean).join(' · ') }] });

  if (review.replyUrl) {
    blocks.push({
      type: 'actions',
      elements: [{ type: 'button', text: { type: 'plain_text', text: 'Reply on Google' }, url: review.replyUrl, style: 'primary' }],
    });
  }
  return blocks;
}

// In custom block templates, URL fields are used verbatim; everything else is Slack-escaped.
const isUrlKey = (key) => key === 'url' || key?.endsWith('_url');

export function buildSlackPayload(review, dest = {}, ctx = {}) {
  if ((dest.format ?? 'text') === 'text') return { text: buildSlackText(review, dest, ctx) };

  const vars = templateVars(review, ctx);
  const firstLine = (dest.template ?? DEFAULT_TEXT_TEMPLATE).split('\n')[0];
  const text = renderString(firstLine, vars, escapeSlack).trimEnd();

  let blocks = defaultBlocks(review, vars);
  if (dest.blocksTemplateJson) {
    const rendered = renderJson(dest.blocksTemplateJson, vars, { escapeFor: (key) => (isUrlKey(key) ? String : escapeSlack) });
    blocks = Array.isArray(rendered) ? rendered : rendered.blocks;
  }

  if (dest.color) return { text, attachments: [{ color: colorFor(review.rating), blocks }] };
  return { text, blocks };
}
