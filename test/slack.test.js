import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSlackPayload, colorFor, truncate } from '../src/slack.js';
import { byId } from './helpers.js';

const ctx = { timezone: 'America/Toronto' };

test('text format reproduces the Zapier message', () => {
  assert.deepEqual(buildSlackPayload(byId['rev-five'], {}, ctx), {
    text: 'Marie Tremblay left a 5 star Google Review   ⭐⭐⭐⭐⭐\n\nExcellent service!\nWill come back.',
  });
});

test('text format posts only the first line when there is no comment', () => {
  assert.deepEqual(buildSlackPayload(byId['rev-three'], { format: 'text' }, ctx), {
    text: 'Someone left a 3 star Google Review   ⭐⭐⭐',
  });
});

test('text format escapes user text', () => {
  const { text } = buildSlackPayload(byId['rev-one'], {}, ctx);
  assert.equal(text, 'Bob &lt;script&gt; left a 1 star Google Review   ⭐\n\nLong wait &amp; rude staff. &lt;b&gt;Never again&lt;/b&gt;');
});

test('custom text template supports every placeholder', () => {
  const template = '{name}|{rating}|{stars}|{comment}|{replyUrl}|{locationName}|{date}|{averageRating}|{totalReviewCount}|{unknown}';
  const { text } = buildSlackPayload(byId['rev-five'], { template }, ctx);
  assert.equal(
    text,
    'Marie Tremblay|5|⭐⭐⭐⭐⭐|Excellent service!\nWill come back.|https://business.google.com/reviews|Our Business|Oct 27, 2026, 2:30 PM|4.6|212|{unknown}',
  );
});

test('blocks format builds the default layout', () => {
  const payload = buildSlackPayload(byId['rev-five'], { format: 'blocks' }, ctx);
  assert.equal(payload.text, 'Marie Tremblay left a 5 star Google Review   ⭐⭐⭐⭐⭐');
  assert.deepEqual(payload.blocks, [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '⭐⭐⭐⭐⭐  *Marie Tremblay* left a *5-star* Google review' },
      accessory: { type: 'image', image_url: 'https://lh3.googleusercontent.com/a/photo-five=s120-c', alt_text: 'Marie Tremblay' },
    },
    { type: 'section', text: { type: 'mrkdwn', text: '>Excellent service!\n>Will come back.' } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: 'Our Business · Oct 27, 2026, 2:30 PM · Average 4.6 from 212 reviews' }] },
    {
      type: 'actions',
      elements: [{ type: 'button', text: { type: 'plain_text', text: 'Reply on Google' }, url: 'https://business.google.com/reviews', style: 'primary' }],
    },
  ]);
});

test('blocks omit the comment, photo and button when absent', () => {
  const review = { ...byId['rev-three'], replyUrl: null };
  const { blocks } = buildSlackPayload(review, { format: 'blocks' }, ctx);
  assert.deepEqual(blocks.map((b) => b.type), ['section', 'context']);
  assert.equal(blocks[0].accessory, undefined);
});

test('blocks escape user text and truncate long comments', () => {
  const { blocks } = buildSlackPayload(byId['rev-one'], { format: 'blocks' }, ctx);
  assert.equal(blocks[0].text.text, '⭐  *Bob &lt;script&gt;* left a *1-star* Google review');
  assert.equal(blocks[1].text.text, '>Long wait &amp; rude staff. &lt;b&gt;Never again&lt;/b&gt;');

  const long = { ...byId['rev-five'], comment: '&'.repeat(5000) };
  const quoted = buildSlackPayload(long, { format: 'blocks' }, ctx).blocks[1].text.text;
  assert.ok(quoted.length <= 3000);
  assert.match(quoted, /&amp;…$/);
  assert.equal(truncate('😀😀', 3), '😀…');
});

test('color wraps blocks in an attachment', () => {
  const payload = buildSlackPayload(byId['rev-one'], { format: 'blocks', color: true }, ctx);
  assert.equal(payload.blocks, undefined);
  assert.equal(payload.attachments[0].color, colorFor(1));
  assert.equal(payload.attachments[0].blocks.length, 4);
  assert.deepEqual([5, 4, 3, 2, 1].map(colorFor), ['#2eb67d', '#2eb67d', '#ecb22e', '#e01e5a', '#e01e5a']);
});

test('blocksTemplate overrides the layout, escaping text but not URLs', () => {
  const blocksTemplateJson = [
    { type: 'section', text: { type: 'mrkdwn', text: '{name}: {comment}' } },
    { type: 'image', image_url: 'https://example.com/a?b=1&c={rating}', alt_text: '{name}' },
  ];
  const payload = buildSlackPayload(byId['rev-one'], { format: 'blocks', blocksTemplateJson }, ctx);
  assert.equal(payload.blocks[0].text.text, 'Bob &lt;script&gt;: Long wait &amp; rude staff. &lt;b&gt;Never again&lt;/b&gt;');
  assert.equal(payload.blocks[1].image_url, 'https://example.com/a?b=1&c=1');
  assert.deepEqual(buildSlackPayload(byId['rev-one'], { format: 'blocks', blocksTemplateJson: { blocks: [] } }, ctx).blocks, []);
});
