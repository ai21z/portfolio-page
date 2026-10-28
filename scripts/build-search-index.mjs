import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

// The blocks a reader reads: a paragraph, a list item, a heading, a quote, a caption, a table row.
// Code, figure art and media are left out, so a match always lands in prose.
const BLOCKS = new Set(['p', 'li', 'h2', 'h3', 'h4', 'blockquote', 'figcaption', 'tr']);
const SKIPPED = new Set(['pre', 'svg', 'video', 'audio', 'script', 'style', 'template']);

const attr = (node, name) => node.attrs?.find(a => a.name === name)?.value;
const hasClass = (node, name) => (attr(node, 'class') || '').split(/\s+/).includes(name);

function find(node, test) {
  if (test(node)) return node;
  for (const child of node.childNodes || []) {
    const found = find(child, test);
    if (found) return found;
  }
  return null;
}

function findAll(node, test, out = []) {
  if (test(node)) out.push(node);
  for (const child of node.childNodes || []) findAll(child, test, out);
  return out;
}

function text(node) {
  if (node.nodeName === '#text') return node.value;
  if (SKIPPED.has(node.nodeName)) return '';
  const parts = (node.childNodes || []).map(text);
  return node.nodeName === 'tr' ? parts.join(' ') : parts.join('');
}

const squash = value => value.replace(/\s+/g, ' ').trim();

function blocks(node, out = []) {
  if (SKIPPED.has(node.nodeName)) return out;
  // A list item that holds a list keeps its own words and lets the inner items count once each.
  if (BLOCKS.has(node.nodeName) && !find({ childNodes: node.childNodes }, n => n !== node && BLOCKS.has(n.nodeName))) {
    const value = squash(text(node));
    if (value) out.push(value);
    return out;
  }
  for (const child of node.childNodes || []) blocks(child, out);
  return out;
}

export async function searchIndex(root = repoRoot) {
  const registry = JSON.parse(await readFile(path.join(root, 'blog/articles.json'), 'utf8'));
  const posts = [];
  for (const [hub, entries] of Object.entries(registry)) {
    for (const entry of entries) {
      const html = await readFile(path.join(root, 'blog', hub, `${entry.id}.html`), 'utf8');
      const doc = parse(html);
      const header = find(doc, n => hasClass(n, 'article-header'));
      const article = find(doc, n => n.nodeName === 'article' && hasClass(n, 'article-content'));
      if (!header || !article) throw new Error(`No article in blog/${hub}/${entry.id}.html`);
      const title = squash(text(find(header, n => hasClass(n, 'article-title'))));
      if (title !== entry.title) throw new Error(`Title of blog/${hub}/${entry.id}.html differs from the registry`);
      const minutes = Number(squash(text(header)).match(/(\d+) min read/)?.[1]) || null;
      posts.push({
        hub,
        id: entry.id,
        title,
        date: entry.date,
        iso: attr(find(header, n => n.nodeName === 'time'), 'datetime'),
        minutes,
        excerpt: entry.excerpt,
        tags: findAll(header, n => hasClass(n, 'tag')).map(n => squash(text(n))),
        headings: findAll(article, n => n.nodeName === 'h2' || n.nodeName === 'h3').map(n => squash(text(n))),
        text: blocks(article).join('\n')
      });
    }
  }
  return `${JSON.stringify({ posts })}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await writeFile(path.join(repoRoot, 'blog/search-index.json'), await searchIndex());
  console.log('Wrote blog/search-index.json');
}
