// Accessible text equivalent of the Work globe.
//
// The globe renders all employment + project content into pointer-only canvas
// popups, so keyboard users, screen-reader users, and anyone whose WebGL2
// context fails got nothing. This renders the same data as a real DOM list
// (headings, text, github links) into #work-index, generated from the single
// source of truth so it can never drift from the globe. It is visually hidden
// by default (the globe stays the visual), but exposed to assistive tech,
// reachable by keyboard, revealed on focus, and shown as the genuine fallback
// when the WebGL scene is unavailable.

import { WORK_LOCATIONS } from './data/work-locations.js?v=20260711';
import { PROJECTS } from './data/projects.js?v=20260711';

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props); // textContent/className/href are properties → auto-escaped
  for (const child of children) if (child != null) node.append(child);
  return node;
}

function renderWorkIndex(mount) {
  if (!mount) return;
  mount.replaceChildren();

  mount.append(el('h2', { className: 'work-index-title', textContent: 'Work history' }));
  const work = el('ul', { className: 'work-index-list' });
  for (const key of Object.keys(WORK_LOCATIONS)) {
    const loc = WORK_LOCATIONS[key];
    for (const entry of loc.entries) {
      const li = el('li', { className: 'work-index-entry' });
      li.append(el('h3', { textContent: entry.company }));
      li.append(el('p', {
        className: 'work-index-meta',
        textContent: [entry.position, entry.period, loc.name].filter(Boolean).join(' · '),
      }));
      const tasks = el('ul');
      for (const r of entry.responsibilities || []) tasks.append(el('li', { textContent: r }));
      li.append(tasks);
      work.append(li);
    }
  }
  mount.append(work);

  mount.append(el('h2', { className: 'work-index-title', textContent: 'Projects' }));
  const projects = el('ul', { className: 'work-index-list' });
  for (const p of PROJECTS) {
    const li = el('li', { className: 'work-index-entry' });
    li.append(el('h3', { textContent: p.name }));
    if (p.description) li.append(el('p', { textContent: p.description }));
    if (p.tech?.length) li.append(el('p', { className: 'work-index-meta', textContent: p.tech.join(' · ') }));
    if (p.github) {
      li.append(el('a', {
        className: 'work-index-link',
        href: p.github,
        textContent: 'View on GitHub',
        target: '_blank',
        rel: 'noopener noreferrer',
      }));
    }
    projects.append(li);
  }
  mount.append(projects);
}

function init() {
  renderWorkIndex(document.getElementById('work-index'));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
