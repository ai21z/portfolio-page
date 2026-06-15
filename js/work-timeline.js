// Work career rail: the interactive "core sample" that indexes the globe.
//
// Renders the TIMELINE as a scrollable vertical spine of dotted nodes. Hover or keyboard-
// focus a node to read its field-note on the right; click a node to drive the globe (places
// turn the Earth, projects frame a moon, credentials are note-only). The same nodes can be
// re-sorted by year (default), by type, or by place, morphing between layouts with a FLIP.
// Coupling is decoupled: a click dispatches `work-timeline:select`; the globe listens.

import { TIMELINE } from './work-globe/data/timeline.js?v=20260617';

const GLYPH_HINT = { work: 'place', project: 'project', cert: 'credential' };

// Grouping bucket for the "place" sort. A view concern, so it lives here, not in the data.
const PLACE_BY_ID = {
  adp: 'Spain', talos: 'Spain', 'true-rolls': 'Spain', 'data-annotation': 'Spain',
  netcompany: 'Greece', 'freelance-turn': 'Greece', msc: 'Greece', beng: 'Greece',
  'cert-frontend-gfoss': 'Greece'
};
const placeOf = (node) => PLACE_BY_ID[node.id] || 'Online';

const MODES = {
  year: { label: 'Year' },
  type: { label: 'Type', order: ['work', 'project', 'cert'], labels: { work: 'Roles', project: 'Projects', cert: 'Credentials' }, key: (n) => n.type },
  place: { label: 'Place', order: ['Spain', 'Greece', 'Online'], labels: { Spain: 'Spain', Greece: 'Greece', Online: 'Online' }, key: placeOf }
};

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

  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nodes = [...TIMELINE].sort((a, b) => b.sortKey - a.sortKey);
  const workSection = host.closest('.stage') || document.getElementById('work');
  const isCompact = () => window.matchMedia('(max-width: 900px)').matches;

  host.textContent = '';

  const header = el('div', 'work-rail-head');
  header.innerHTML =
    '<div class="work-rail-key">' +
    '<div class="work-rail-key-row"><span class="rail-glyph rail-glyph--work"></span><span>place</span></div>' +
    '<div class="work-rail-key-row"><span class="rail-glyph rail-glyph--project"></span><span>project</span></div>' +
    '<div class="work-rail-key-row"><span class="rail-glyph rail-glyph--cert"></span><span>credential</span></div>' +
    '</div>' +
    '<div class="work-rail-title">Timeline</div>' +
    '<div class="work-rail-sub">click a marker to place it on the globe</div>';
  const modeBar = el('div', 'work-rail-modes');
  modeBar.setAttribute('role', 'group');
  modeBar.setAttribute('aria-label', 'Sort the timeline');
  header.appendChild(modeBar);
  host.appendChild(header);

  const viewport = el('div', 'work-rail-viewport');
  const scroll = el('div', 'work-rail-scroll');
  const readhead = el('div', 'work-rail-readhead');
  readhead.setAttribute('aria-hidden', 'true');
  const spine = el('div', 'work-rail-spine');
  spine.setAttribute('aria-hidden', 'true');
  const list = el('ol', 'work-rail-list');
  list.setAttribute('aria-label', 'Career timeline');

  const note = el('div', 'work-note');
  note.setAttribute('role', 'status');
  note.hidden = true;

  let hideTimer = 0;
  let activeLi = null;

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

  // Build every node once, keyed by id, so re-sorting just reorders the DOM.
  const nodeLis = new Map();
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

    // Desktop: hover/focus reveals the side note, click drives the globe.
    // Compact: no side note; a tap opens the centered modal card instead.
    btn.addEventListener('mouseenter', () => { if (!isCompact()) showNote(node, li); });
    btn.addEventListener('focus', () => { if (!isCompact()) showNote(node, li); });
    btn.addEventListener('mouseleave', hideNoteSoon);
    btn.addEventListener('blur', hideNoteSoon);
    btn.addEventListener('click', () => { if (isCompact()) openCard(node); else selectNode(node, li); });

    li.appendChild(btn);
    nodeLis.set(node.id, li);
  });

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

  function buildGroups(mode) {
    if (mode === 'year') return [{ label: null, ids: nodes.map((n) => n.id) }];
    const cfg = MODES[mode];
    return cfg.order
      .map((g) => ({ label: cfg.labels[g], ids: nodes.filter((n) => cfg.key(n) === g).map((n) => n.id) }))
      .filter((grp) => grp.ids.length);
  }

  let currentMode = 'year';
  function layout(mode, animate) {
    const first = new Map();
    if (animate && !reducedMotion) nodeLis.forEach((li, id) => first.set(id, li.getBoundingClientRect().top));

    list.textContent = '';
    buildGroups(mode).forEach((grp) => {
      if (grp.label) {
        const h = el('li', 'rail-group');
        h.textContent = grp.label;
        h.setAttribute('aria-hidden', 'true');
        list.appendChild(h);
      }
      grp.ids.forEach((id) => list.appendChild(nodeLis.get(id)));
    });

    if (animate && !reducedMotion) {
      nodeLis.forEach((li, id) => {
        const dy = (first.get(id) || 0) - li.getBoundingClientRect().top;
        if (dy) {
          li.style.transition = 'none';
          li.style.transform = 'translateY(' + dy + 'px)';
          requestAnimationFrame(() => { li.style.transition = ''; li.style.transform = ''; });
        }
      });
    }

    currentMode = mode;
    hideNoteSoon();
    requestAnimationFrame(markCentered);
  }

  Object.keys(MODES).forEach((mode) => {
    const b = el('button', 'work-rail-mode');
    b.type = 'button';
    b.textContent = MODES[mode].label;
    b.setAttribute('aria-pressed', mode === 'year' ? 'true' : 'false');
    b.addEventListener('click', () => {
      if (currentMode === mode) return;
      modeBar.querySelectorAll('.work-rail-mode').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      layout(mode, true);
    });
    modeBar.appendChild(b);
  });

  // ---- compact view toggle: Timeline <-> Globe (hidden on desktop, where both show) ----
  let currentView = 'timeline';
  const toggle = el('div', 'work-view-toggle');
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', 'Switch between the timeline and the globe');
  const toggleButtons = {};
  ['timeline', 'globe'].forEach((view) => {
    const tb = el('button', 'work-view-btn');
    tb.type = 'button';
    tb.dataset.view = view;
    tb.textContent = view === 'timeline' ? 'Timeline' : 'Globe';
    tb.addEventListener('click', () => setView(view));
    toggle.appendChild(tb);
    toggleButtons[view] = tb;
  });

  function setView(view) {
    currentView = view;
    if (workSection) {
      workSection.classList.toggle('work-view-timeline', view === 'timeline');
      workSection.classList.toggle('work-view-globe', view === 'globe');
    }
    Object.keys(toggleButtons).forEach((v) => toggleButtons[v].setAttribute('aria-pressed', v === view ? 'true' : 'false'));
    if (view === 'globe') closeCard();
    document.dispatchEvent(new CustomEvent('work-view:change', { detail: { view } }));
  }

  // ---- the field-note as a centered modal card (compact tap target) ----
  const backdrop = el('div', 'work-card-backdrop');
  backdrop.hidden = true;
  const card = el('div', 'work-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  const cardClose = el('button', 'work-card-close');
  cardClose.type = 'button';
  cardClose.setAttribute('aria-label', 'Close');
  cardClose.innerHTML = '&times;';
  const cardBody = el('div', 'work-card-body');
  card.appendChild(cardClose);
  card.appendChild(cardBody);
  backdrop.appendChild(card);

  function openCard(node) {
    cardBody.innerHTML =
      '<div class="work-note-kicker">' + GLYPH_HINT[node.type] + '</div>' +
      '<div class="work-card-title">' + node.title + '</div>' +
      '<div class="work-card-meta">' + node.dates + (node.subtitle ? ' · ' + node.subtitle : '') + '</div>' +
      '<div class="work-card-summary">' + node.summary + '</div>' +
      (node.target ? '<button type="button" class="work-card-globe">See it on the globe</button>' : '');
    const globeBtn = cardBody.querySelector('.work-card-globe');
    if (globeBtn) {
      globeBtn.addEventListener('click', () => {
        closeCard();
        setView('globe');
        document.dispatchEvent(new CustomEvent('work-timeline:select', { detail: { id: node.id, target: node.target } }));
      });
    }
    backdrop.hidden = false;
    requestAnimationFrame(() => backdrop.classList.add('is-open'));
    cardClose.focus();
  }

  function closeCard() {
    if (backdrop.hidden) return;
    backdrop.classList.remove('is-open');
    window.setTimeout(() => { backdrop.hidden = true; }, 200);
  }

  cardClose.addEventListener('click', closeCard);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeCard(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !backdrop.hidden) closeCard(); });

  scroll.appendChild(spine);
  scroll.appendChild(list);
  viewport.appendChild(scroll);
  viewport.appendChild(readhead);
  host.appendChild(viewport);
  host.appendChild(note);
  if (workSection) workSection.appendChild(toggle);
  document.body.appendChild(backdrop);

  layout('year', false);
  setView('timeline');

  // Re-evaluate the globe's run/pause state when crossing the compact breakpoint.
  let viewResizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(viewResizeTimer);
    viewResizeTimer = window.setTimeout(() => {
      document.dispatchEvent(new CustomEvent('work-view:change', { detail: { view: currentView } }));
    }, 160);
  });

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
}
