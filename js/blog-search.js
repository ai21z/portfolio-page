// Search over the notes, in the Field Notes panel. The index (blog/search-index.json, made by the
// build from the post pages) loads the first time the field is used. While the results are open the
// dish sifts with them: the nuclei of matching posts stay lit and the rest fade, and the result in
// focus names its nucleus as a hover would.
import { blogCategory } from './blog-categories.js';
import { compactMediaQuery } from './compact.js';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
// How much a term counts where it is found. A title outweighs a heading, a heading the body.
const WEIGHT = { title: 8, tags: 5, headings: 4, excerpt: 3, text: 1 };
// A passage starts a little before the match and runs on about two lines, so the match is in view.
const SNIPPET_BEFORE = 32;
const SNIPPET_AFTER = 84;

let indexRequest = null;

function loadIndex() {
  indexRequest ??= fetch('./blog/search-index.json')
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(({ posts }) => posts.map(post => ({
      ...post,
      culture: blogCategory(post.hub)?.name || post.hub,
      fields: {
        title: post.title.toLowerCase(),
        tags: [...post.tags, blogCategory(post.hub)?.name || post.hub].join(' ').toLowerCase(),
        headings: post.headings.join('\n').toLowerCase(),
        excerpt: post.excerpt.toLowerCase(),
        text: post.text.toLowerCase()
      }
    })))
    .catch(error => {
      indexRequest = null;
      throw error;
    });
  return indexRequest;
}

const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function termsOf(query) {
  return [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];
}

// A post matches when every term is found in it somewhere. Its score adds, for each term, the weight
// of the best place it was found, with a little more for a term that starts a word, and more again
// when several words stand together as typed.
function score(post, terms, phrase) {
  let total = 0;
  if (phrase) {
    if (post.fields.title.includes(phrase)) total += WEIGHT.title;
    else if (post.fields.text.includes(phrase) || post.fields.excerpt.includes(phrase)) total += WEIGHT.headings;
  }
  for (const term of terms) {
    let best = 0;
    for (const [field, weight] of Object.entries(WEIGHT)) {
      const at = post.fields[field].indexOf(term);
      if (at < 0) continue;
      const wordStart = at === 0 || /[^a-z0-9]/.test(post.fields[field][at - 1]);
      best = Math.max(best, weight * (wordStart ? 1.25 : 1));
    }
    if (!best) return 0;
    total += best;
  }
  return total;
}

function mark(text, terms) {
  if (!terms.length) return escapeHtml(text);
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  return text.split(pattern).map((part, i) => (i % 2 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part))).join('');
}

// The passage to show: the block that holds the whole query as a phrase, or else the most of its
// words, cut to whole words from a little before the first of them. When the title already holds
// every word, the excerpt stands.
function snippet(post, terms, phrase) {
  if (terms.every(t => post.fields.title.includes(t))) return post.excerpt;
  let block = post.excerpt;
  let best = 0;
  for (const candidate of [post.excerpt, ...post.headings, ...post.text.split('\n')]) {
    const lower = candidate.toLowerCase();
    const found = terms.filter(t => lower.includes(t)).length + (phrase && lower.includes(phrase) ? terms.length : 0);
    if (found > best) {
      best = found;
      block = candidate;
    }
  }
  const lower = block.toLowerCase();
  const at = Math.min(...terms.map(t => lower.indexOf(t)).filter(i => i >= 0));
  if (!Number.isFinite(at) || at <= SNIPPET_BEFORE) return block;
  const start = block.indexOf(' ', at - SNIPPET_BEFORE) + 1 || at;
  const end = Math.min(block.length, at + SNIPPET_AFTER);
  const cut = end < block.length ? block.lastIndexOf(' ', end) : end;
  const passage = block.slice(Math.min(start, at), cut > at ? cut : end);
  return cut < block.length ? `…${passage.replace(/[\s.,]+$/, '')}…` : `…${passage}`;
}

function stamp(iso) {
  const [year, month, day] = (iso || '').split('-').map(Number);
  return year ? `${day} ${MONTHS[month - 1]} ${year}` : '';
}

export function initBlogSearch({ openPost }) {
  const root = document.querySelector('.blog-search');
  const input = document.getElementById('blog-search-input');
  const results = document.getElementById('blog-search-results');
  const list = root?.querySelector('.blog-search-list');
  const summary = root?.querySelector('.blog-search-summary');
  const status = document.getElementById('blog-search-status');
  if (!root || !input || !results || !list || root.__searchBound) return;
  root.__searchBound = true;
  root.hidden = false;

  // On a phone the dish and its panel give way to the culture cards, and the search moves above them.
  const compact = compactMediaQuery();
  const panel = root.parentElement;
  const panelNext = root.nextElementSibling;
  const place = () => {
    if (compact.matches) document.querySelector('.blog-mobile')?.prepend(root);
    else if (root.parentElement !== panel) panel.insertBefore(root, panelNext);
  };
  place();
  compact.addEventListener('change', place);

  let posts = null;
  let failed = false;
  let statusTimer = null;
  let namedHub = null;

  const nuclei = () => document.querySelectorAll('#dish-nuclei .dish-nucleus');

  function sift(matches) {
    const layer = document.getElementById('dish-nuclei');
    const lit = matches && new Set(matches.map(post => `${post.hub}/${post.id}`));
    layer?.classList.toggle('is-sifting', Boolean(lit));
    nuclei().forEach(nucleus => {
      nucleus.classList.toggle('is-match', Boolean(lit?.has(`${nucleus.dataset.hub}/${nucleus.dataset.article}`)));
      nucleus.classList.remove('is-named');
    });
  }

  function name(hit) {
    nuclei().forEach(nucleus => nucleus.classList.toggle('is-named',
      Boolean(hit) && nucleus.dataset.hub === hit.dataset.hub && nucleus.dataset.article === hit.dataset.article));
    // Only a preview this search began is ended here, so a hub under the pointer keeps its own.
    const hubId = hit?.dataset.hub || null;
    if (hubId === namedHub) return;
    if (namedHub) window.dispatchEvent(new CustomEvent('blog:hover-off', { detail: { source: 'search' } }));
    if (hubId) window.dispatchEvent(new CustomEvent('blog:hover', { detail: { hubId, source: 'search' } }));
    namedHub = hubId;
  }

  function announce(message) {
    clearTimeout(statusTimer);
    // A pause first, so a screen reader speaks the count once typing rests, not at every key.
    statusTimer = setTimeout(() => { if (status) status.textContent = message; }, 500);
  }

  function close() {
    if (results.hidden) return;
    results.hidden = true;
    root.classList.remove('is-open');
    sift(null);
    name(null);
  }

  function render() {
    const query = input.value.trim();
    root.classList.toggle('has-query', Boolean(query));
    if (failed) {
      summary.textContent = 'The notes could not be searched. Every post is in its culture.';
      list.replaceChildren();
      announce(summary.textContent);
      return;
    }
    if (!posts) {
      summary.textContent = 'Opening the index…';
      list.replaceChildren();
      return;
    }
    const terms = termsOf(query);
    const phrase = terms.length > 1 ? terms.join(' ') : '';
    const matches = terms.length
      ? posts.map(post => ({ post, score: score(post, terms, phrase) }))
        .filter(m => m.score > 0)
        .sort((a, b) => b.score - a.score || b.post.iso.localeCompare(a.post.iso))
        .map(m => m.post)
      : [...posts].sort((a, b) => b.iso.localeCompare(a.iso));

    const count = matches.length === 1 ? '1 note' : `${matches.length} notes`;
    summary.textContent = !terms.length ? `All ${count}, newest first`
      : matches.length ? `${count} of ${posts.length}` : `Nothing matches “${query}”. Try a culture, a model or a tool.`;
    announce(!terms.length ? `All ${count}.` : matches.length ? `${count} match.` : 'No note matches.');

    list.innerHTML = matches.map(post => `
      <li><a class="blog-search-hit" href="/blog/${encodeURIComponent(post.hub)}/${encodeURIComponent(post.id)}" data-hub="${escapeHtml(post.hub)}" data-article="${escapeHtml(post.id)}">
        <span class="blog-search-title">${mark(post.title, terms)}</span>
        <span class="blog-search-meta">${escapeHtml(post.culture)}<span aria-hidden="true"> · </span>${post.minutes ? `${post.minutes} min<span aria-hidden="true"> · </span>` : ''}${escapeHtml(stamp(post.iso))}</span>
        <span class="blog-search-snippet">${mark(snippet(post, terms, phrase), terms)}</span>
      </a></li>`).join('');
    sift(terms.length ? matches : null);
  }

  async function open() {
    if (results.hidden) {
      results.hidden = false;
      root.classList.add('is-open');
    }
    render();
    if (posts || failed) return;
    try {
      posts = await loadIndex();
    } catch (error) {
      console.warn('[Blog] Could not load the search index:', error.message);
      failed = true;
    }
    if (!results.hidden) render();
  }

  const hits = () => [...list.querySelectorAll('.blog-search-hit')];

  input.addEventListener('focus', open);
  input.addEventListener('input', open);
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (results.hidden) open();
      hits()[0]?.focus();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const first = hits()[0];
      if (input.value.trim() && first) openHit(first);
    } else if (event.key === 'Escape') {
      // The first Escape closes the results, the next one empties the field. The browser's own Escape
      // on a search field would empty it at once.
      event.preventDefault();
      event.stopPropagation();
      if (!results.hidden) close();
      else input.value = '';
      root.classList.toggle('has-query', Boolean(input.value.trim()));
    }
  });

  list.addEventListener('keydown', event => {
    const all = hits();
    const at = all.indexOf(document.activeElement);
    if (at < 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = at + (event.key === 'ArrowDown' ? 1 : -1);
      (next < 0 ? input : all[Math.min(next, all.length - 1)]).focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      all[event.key === 'Home' ? 0 : all.length - 1].focus();
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      input.focus();
      close();
    }
  });

  // A result previews its nucleus, from the pointer and from the keyboard alike.
  list.addEventListener('focusin', event => name(event.target.closest('.blog-search-hit')));
  list.addEventListener('pointerover', event => {
    const hit = event.target.closest('.blog-search-hit');
    if (hit) name(hit);
  });
  list.addEventListener('pointerleave', () => name(list.contains(document.activeElement) ? document.activeElement : null));

  function openHit(hit) {
    close();
    openPost(hit.dataset.hub, hit.dataset.article);
  }

  // Pressing a result keeps focus in the field. Safari never focuses a clicked link, so the field's blur
  // would close the results before the click arrived.
  list.addEventListener('mousedown', event => {
    if (event.button === 0 && event.target.closest('.blog-search-hit')) event.preventDefault();
  });

  // A plain click reads the post in place. A modified click keeps its own way, a new tab or window.
  list.addEventListener('click', event => {
    const hit = event.target.closest('.blog-search-hit');
    if (!hit || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openHit(hit);
  });

  // A phone blurs the field when its keyboard is put away, and the results stay up to be read.
  root.addEventListener('focusout', event => {
    if (!compact.matches && !root.contains(event.relatedTarget)) close();
  });
  document.addEventListener('pointerdown', event => {
    if (!root.contains(event.target)) close();
  });

  // The posts may arrive after the results opened: their nuclei then take the current sifting.
  // The dish rebuilds its nuclei on the same event, so this waits a turn for the new ones.
  window.addEventListener('blog:posts', () => setTimeout(() => { if (!results.hidden) render(); }));

  // Ctrl K, or Command K on a Mac, reaches the field from anywhere on the dish. A modifier, so speech input
  // or a stray key cannot set it off (a single character shortcut fails WCAG 2.1.4).
  const mac = /Mac|iPhone|iPad/.test(navigator.userAgentData?.platform || navigator.platform || '');
  const key = root.querySelector('.blog-search-key');
  if (key && mac) key.textContent = '⌘K';
  document.addEventListener('keydown', event => {
    if (event.key.toLowerCase() !== 'k' || !(mac ? event.metaKey : event.ctrlKey) || event.altKey || event.shiftKey) return;
    const blog = document.getElementById('blog');
    if (!blog?.classList.contains('active-section') || blog.dataset.mode !== 'map' || !input.getClientRects().length) return;
    if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    input.focus();
  });
}
