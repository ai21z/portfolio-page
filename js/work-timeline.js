// Work career rail: the interactive "core sample" that indexes the globe.
//
// Renders the TIMELINE as a scrollable vertical spine of dotted nodes (newest at the
// surface). Hover or keyboard-focus a node to read its field-note on the right; click a
// node to drive the globe (places turn the Earth, projects frame a moon, credentials are
// note-only). Coupling is decoupled: a click dispatches `work-timeline:select` on document,
// and the globe module listens for it.

import { TIMELINE } from './work-globe/data/timeline.js';

const GLYPH_HINT = { work: 'place', project: 'project', cert: 'credential' };

let inited = false;

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export function initWorkTimeline() {
  if (inited) return;
  const host = document.querySelector('.work-rail');
  if (!host) return;
  inited = true;

  const nodes = [...TIMELINE].sort((a, b) => b.sortKey - a.sortKey);

  host.textContent = '';

  const header = el('div', 'work-rail-head');
  header.innerHTML =
    '<div class="work-rail-title">The record</div>' +
    '<div class="work-rail-sub">a core sample · now at the surface</div>' +
    '<ul class="work-rail-legend" aria-hidden="true">' +
    '<li><span class="rail-glyph rail-glyph--work"></span>place</li>' +
    '<li><span class="rail-glyph rail-glyph--project"></span>project</li>' +
    '<li><span class="rail-glyph rail-glyph--cert"></span>credential</li>' +
    '</ul>';
  host.appendChild(header);

  const viewport = el('div', 'work-rail-viewport');
  const scroll = el('div', 'work-rail-scroll');
  const readhead = el('div', 'work-rail-readhead');
  readhead.setAttribute('aria-hidden', 'true');
  const spine = el('div', 'work-rail-spine');
  spine.setAttribute('aria-hidden', 'true');
  const list = el('ol', 'work-rail-list');
  list.setAttribute('aria-label', 'Career timeline, most recent first');

  const note = el('div', 'work-note');
  note.setAttribute('role', 'status');
  note.hidden = true;

  let hideTimer = 0;
  let activeLi = null; // the node whose field-note is currently shown (so it can follow on scroll)

  function positionNote(li) {
    const hostRect = host.getBoundingClientRect();
    const liRect = li.getBoundingClientRect();
    const noteH = note.offsetHeight || 120;
    let top = liRect.top - hostRect.top + liRect.height / 2 - noteH / 2;
    top = Math.max(8, Math.min(top, hostRect.height - noteH - 8));
    note.style.top = top + 'px';
  }

  function showNote(node, li) {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0; }
    activeLi = li;
    const driveHint = node.target
      ? (node.target.kind === 'moon' ? 'click → frame the moon' : 'click → locate on Earth')
      : 'credential · note only';
    note.innerHTML =
      '<div class="work-note-kicker">' + GLYPH_HINT[node.type] + '</div>' +
      '<div class="work-note-title">' + node.title + '</div>' +
      '<div class="work-note-meta">' + node.dates + (node.subtitle ? ' · ' + node.subtitle : '') + '</div>' +
      '<div class="work-note-summary">' + node.summary + '</div>' +
      '<div class="work-note-cta' + (node.target ? ' work-note-cta--live' : '') + '">' + driveHint + '</div>';
    note.hidden = false;
    note.classList.add('is-visible');
    positionNote(li);
  }

  function hideNoteSoon() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      note.classList.remove('is-visible');
      note.hidden = true;
      activeLi = null;
    }, 140);
  }

  function selectNode(node, li) {
    // Persistent highlight of the milestone the globe is focused on; the note itself
    // stays hover/focus-driven so it always closes when you move away.
    list.querySelectorAll('.rail-node.is-selected').forEach((n) => {
      if (n !== li) n.classList.remove('is-selected');
    });
    li.classList.add('is-selected');
    showNote(node, li);
    if (node.target) {
      document.dispatchEvent(new CustomEvent('work-timeline:select', {
        detail: { id: node.id, target: node.target }
      }));
    }
  }

  nodes.forEach((node) => {
    const li = el('li', 'rail-node rail-node--' + node.type);
    li.dataset.id = node.id;

    const btn = el('button', 'rail-dot-btn');
    btn.type = 'button';
    const driveHint = node.target ? ' Show on the globe.' : '';
    btn.setAttribute('aria-label',
      node.dates + '. ' + node.title + (node.subtitle ? ', ' + node.subtitle : '') +
      '. ' + GLYPH_HINT[node.type] + '.' + driveHint);
    btn.innerHTML =
      '<span class="rail-glyph rail-glyph--' + node.type + '" aria-hidden="true"></span>' +
      '<span class="rail-node-meta">' +
      '<span class="rail-node-year">' + node.dates + '</span>' +
      '<span class="rail-node-title">' + node.title + '</span>' +
      '<span class="rail-node-sub">' + node.subtitle + '</span>' +
      '</span>';

    btn.addEventListener('mouseenter', () => showNote(node, li));
    btn.addEventListener('focus', () => showNote(node, li));
    btn.addEventListener('mouseleave', hideNoteSoon);
    btn.addEventListener('blur', hideNoteSoon);
    btn.addEventListener('click', () => selectNode(node, li));

    li.appendChild(btn);
    list.appendChild(li);
  });

  scroll.appendChild(spine);
  scroll.appendChild(list);
  viewport.appendChild(scroll);
  viewport.appendChild(readhead);
  host.appendChild(viewport);
  host.appendChild(note);

  // Mark the node nearest the read-head as centered (ambient "scrub" feedback).
  let scrollRaf = 0;
  const markCentered = () => {
    scrollRaf = 0;
    const mid = scroll.getBoundingClientRect().top + scroll.clientHeight / 2;
    let best = null;
    let bestDist = Infinity;
    list.querySelectorAll('.rail-node').forEach((n) => {
      const r = n.getBoundingClientRect();
      const d = Math.abs(r.top + r.height / 2 - mid);
      if (d < bestDist) { bestDist = d; best = n; }
    });
    list.querySelectorAll('.rail-node.is-centered').forEach((n) => {
      if (n !== best) n.classList.remove('is-centered');
    });
    if (best) best.classList.add('is-centered');
  };
  scroll.addEventListener('scroll', () => {
    if (!scrollRaf) scrollRaf = requestAnimationFrame(markCentered);
    // Keep a shown note glued to its node; hide it only once the node scrolls out of view.
    if (activeLi && note.classList.contains('is-visible')) {
      const sr = scroll.getBoundingClientRect();
      const lr = activeLi.getBoundingClientRect();
      const center = lr.top + lr.height / 2;
      if (center < sr.top || center > sr.bottom) hideNoteSoon();
      else positionNote(activeLi);
    }
  }, { passive: true });
  requestAnimationFrame(markCentered);
}
