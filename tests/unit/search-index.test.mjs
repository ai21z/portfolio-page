import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { searchIndex } from '../../scripts/build-search-index.mjs';

// The committed index is the one the posts make, so a deploy of a reviewed commit ships what was read.
test('the committed search index matches the posts', async () => {
  const committed = await readFile(new URL('../../blog/search-index.json', import.meta.url), 'utf8');
  assert.equal(committed.replace(/\r\n/g, '\n'), await searchIndex());
});

test('the search index holds every post with its words, and no code or figure art', async () => {
  const { posts } = JSON.parse(await searchIndex());
  const registry = JSON.parse(await readFile(new URL('../../blog/articles.json', import.meta.url), 'utf8'));
  assert.deepEqual(posts.map(post => `${post.hub}/${post.id}`),
    Object.entries(registry).flatMap(([hub, entries]) => entries.map(entry => `${hub}/${entry.id}`)));
  for (const post of posts) {
    assert.match(post.iso, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(post.minutes > 0 && post.tags.length && post.text.length > 1000, post.id);
  }
  const harness = posts.find(post => post.id === 'inside-a-trust-harness-java-21');
  assert.ok(!harness.text.includes('RAW_COMMAND_KEYS'), 'code blocks stay out');
  assert.ok(posts.find(post => post.id === 'twelve-local-models').text.includes('repetition guard'));
});
