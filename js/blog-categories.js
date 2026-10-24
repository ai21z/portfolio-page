// The four Blog categories, the one place their names and lines live. The Field Notes list, the phone
// specimen cards, the dish tooltip and the screen-reader preview all read from here, and
// tests/perf-assets.spec.ts checks the copies in index.html (shown without JavaScript) match.
export const BLOG_CATEGORIES = [
  { id: 'craft', name: 'Craft', line: "Build notes and process. How I made things, what I tried, what worked, what didn't." },
  { id: 'cosmos', name: 'Cosmos', line: 'Ideas and big-picture thinking. Mental models, opinions, and reflections about tech, AI, and life.' },
  { id: 'codex', name: 'Codex', line: 'Reference material. Checklists, guides, patterns, and notes meant to be reused.' },
  { id: 'convergence', name: 'Convergence', line: 'Synthesis and lessons. Retrospectives and posts that connect multiple topics into one takeaway.' }
];

export const BLOG_CATEGORY_IDS = BLOG_CATEGORIES.map((category) => category.id);

export const blogCategory = (id) => BLOG_CATEGORIES.find((category) => category.id === id) || null;

// The first sentence, for the phone cards, which hold one short line.
export const blogCategoryShortLine = (category) => category.line.split('. ')[0] + '.';

// A category with no posts is a dormant culture: its rim label dims and carries a caption, it shows no
// count, and nothing opens an empty view from it. A link to #blog/<id> still routes.
export const dormantCategories = new Set();

// Marks a dish rim label (an .arc-btn group in the labels SVG) for a dormant category, or clears it.
// The dish rebuilds its labels on every resize, and the post counts arrive after the first build, so
// both call this.
export function decorateRimLabel(group) {
  const id = group.dataset.hub;
  const category = blogCategory(id);
  if (!category) return;
  const dormant = dormantCategories.has(id);
  group.classList.toggle('is-dormant', dormant);
  group.setAttribute('tabindex', dormant ? '-1' : '0');
  group.setAttribute('aria-label', dormant ? `${category.name.toUpperCase()}, dormant, no posts yet` : `${category.name.toUpperCase()}, open category`);
  if (dormant) group.setAttribute('aria-disabled', 'true');
  else group.removeAttribute('aria-disabled');
}
