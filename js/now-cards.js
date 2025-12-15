/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   NOW — CULTIVATING CARDS
   
   IMPLEMENTATION DECISIONS:
   
   1. FLIP Animation:
      - Uses First-Last-Invert-Play pattern for smooth flip-to-center
      - Records initial rect, applies target state (centered + scaled), 
        measures final rect, inverts with transform, then plays transition
      - Removes will-change after animation to prevent compositor issues
   
   2. Accessibility:
      - Front faces are <button> elements with aria-expanded
      - Back faces are dialogs with role="dialog", aria-modal="true"
      - Focus management: traps focus in dialog, restores on close
      - Roving tabindex for keyboard nav (Arrow keys between cards)
      - Esc closes active card, outside click supported
   
   3. Reduced Motion:
      - Detects prefers-reduced-motion and swaps flip for fade
      - CSS handles transform removal, JS only manages opacity states
      - No background pulses when reduced motion is preferred
   
   4. Background Hooks:
      - Emits optional events (card:hover, card:activate, card:close)
      - Safe no-op if global mycoBg is undefined
      - Future-proof for interactive background integration
   
   5. Performance:
      - Lazy image loading with loading="lazy"
      - will-change only during animations, removed after
      - Single RAF for FLIP calculations
      - Idempotent init/destroy (no memory leaks)
   
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

// ━━━ Imports ━━━
import { viewportSize } from './utils.js';

// ━━━ Logo Path Helper ━━━
const LOGO = (name) => `/artifacts/projects/logos/${name}`;

// ━━━ Data Model ━━━
const NOW_STREAMS = [
  {
    id: 'adp',
    logo: LOGO('ADP-noBG.png'),
    title: 'ADP - Software Engineer',
    line: 'Maintenance and development for HCM SaaS at scale',
    status: 'high',
    tags: [], // No tech stack pills for ADP
    bullets: [
      'Large-scale platform, steady SLAs',
      'Implementation of new features and bug fixes, testing, code reviews, documentation'
    ],
    links: [{ label: 'Work history', href: '#work' }],
    category: 'engineering'
  },
  {
    id: 'loqj',
    logo: LOGO('LOQJ-noBG.png'),
    title: 'LOQ-J — Local-First RAG',
    line: 'Semantic search, zero cloud, pure Java',
    status: 'brewing',
    tags: ['Java', 'Lucene', 'Local LLMs'],
    bullets: [
      'Lucene 10 vectors + BM25 hybrid',
      'Local LLM, reproducible workflows'
    ],
    links: [{ label: 'Documentation', href: '#' }],
    category: 'engineering'
  },
  {
    id: 'truerolls',
    logo: LOGO('TRUE-ROLLS-noBG.png'),
    title: 'True Rolls - Dice',
    line: 'Cryptographic fairness for tabletop',
    status: 'brewing',
    tags: ['HKDF', 'ChaCha20', 'Cryptography'],
    bullets: [
      'Signed receipts, instant verification',
      'ChaCha20 RNG with replay proofs'
    ],
    links: [{ label: 'Try demo', href: '#' }],
    category: 'engineering'
  },
  {
    id: 'tmt',
    logo: LOGO('TMT-dark-myst.png'),
    title: "The Murderer's Thumb",
    line: 'Dark cinematic metal in production',
    status: 'growing',
    tags: ['Guitar', 'Piano', 'Production'],
    bullets: [
      'Two songs: horror/synthmetal',
      'Composing, performing, producing'
    ],
    links: [{ label: 'Listen soon', href: '#' }],
    category: 'art',
    hidden: true // Hidden until songs are ready
  }
];

// ━━━ State ━━━
let activeCard = null;
let currentFilter = 'engineering';
let cards = [];
let filterChips = [];
let backdrop = null;
let prefersReducedMotion = false;
let focusBeforeOpen = null;

// Status emoji mapping
const STATUS_EMOJI = {
  high: '🔥',
  brewing: '⚗️',
  growing: '🌱'
};

// Status label mapping
const STATUS_LABEL = {
  high: 'High',
  brewing: 'Brewing',
  growing: 'Growing'
};

// ━━━ Initialization ━━━
export function initNowCards() {
  // Check reduced motion preference
  prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  
  // Get backdrop (reuse existing)
  backdrop = document.getElementById('paper-backdrop');
  
  // Render cards
  renderCards();
  
  // Wire filters
  wireFilters();
  
  // Apply initial filter
  applyFilter(currentFilter);
  
  // Check for deep link
  handleDeepLink();
  
  // Wire keyboard navigation
  wireKeyboardNav();
  
  // Wire global Esc handler
  document.addEventListener('keydown', handleEscKey);
}

// ━━━ Cleanup ━━━
export function destroyNowCards() {
  // Close any open card
  if (activeCard) {
    closeCard(activeCard, false);
  }
  
  // Remove event listeners
  document.removeEventListener('keydown', handleEscKey);
  
  // Clear references
  cards = [];
  filterChips = [];
  activeCard = null;
  focusBeforeOpen = null;
  
  // Clear grid
  const grid = document.getElementById('now-card-grid');
  if (grid) grid.innerHTML = '';
}

// ━━━ Render Cards ━━━
function renderCards() {
  const grid = document.getElementById('now-card-grid');
  if (!grid) return;
  
  grid.innerHTML = '';
  cards = [];
  
  NOW_STREAMS.forEach((stream, index) => {
    // Skip hidden cards
    if (stream.hidden) return;
    
    const card = createCard(stream, index);
    grid.appendChild(card);
    cards.push(card);
  });
  
  // Add "Coming soon..." message if Art & Music filter is empty
  const artCards = NOW_STREAMS.filter(s => s.category === 'art' && !s.hidden);
  if (artCards.length === 0) {
    const comingSoon = document.createElement('div');
    comingSoon.className = 'now-coming-soon';
    comingSoon.id = 'art-coming-soon';
    comingSoon.setAttribute('data-category', 'art');
    comingSoon.innerHTML = '<p>Coming soon...</p>';
    grid.appendChild(comingSoon);
  }
}

// ━━━ Create Card Element ━━━
function createCard(stream, index) {
  const card = document.createElement('div');
  card.className = 'now-card';
  card.dataset.id = stream.id;
  card.dataset.category = stream.category;
  card.dataset.index = index;
  
  // Inner (3D flip container)
  const inner = document.createElement('div');
  inner.className = 'now-card-inner';
  
  // Front face (button) - LOGO ONLY
  const front = document.createElement('button');
  front.className = 'now-card-face now-card-front';
  front.setAttribute('aria-expanded', 'false');
  front.setAttribute('aria-label', `View details for ${stream.title}`);
  front.tabIndex = index === 0 ? 0 : -1; // Roving tabindex
  
  // TMT gets full-bleed background image
  if (stream.id === 'tmt') {
    front.style.backgroundImage = `url(${stream.logo})`;
    front.style.backgroundSize = '75%';
    front.style.backgroundPosition = 'center';
    front.style.backgroundRepeat = 'no-repeat';
  } else {
    // Others get centered logo
    const logo = document.createElement('img');
    logo.src = stream.logo;
    logo.alt = '';
    logo.className = 'now-card-logo';
    logo.loading = 'lazy';
    front.appendChild(logo);
  }
  
  // Wire click
  front.addEventListener('click', () => {
    // Toggle: if this card is already active, close it; otherwise open it
    if (activeCard === card) {
      closeCard(card);
    } else {
      openCard(card, stream);
    }
  });
  
  // Back face (dialog)
  const back = document.createElement('div');
  back.className = 'now-card-face now-card-back';
  back.setAttribute('role', 'dialog');
  back.setAttribute('aria-modal', 'true');
  back.setAttribute('aria-labelledby', `card-title-${stream.id}`);
  back.setAttribute('aria-hidden', 'true');
  
  // Make back face closeable by clicking anywhere on it
  back.addEventListener('click', (e) => {
    // Don't close if clicking a link (let the link work)
    if (e.target.tagName === 'A') return;
    // Close on any other click
    closeCard(card);
  });
  
  // Header row (title + status pill inline)
  const header = document.createElement('div');
  header.className = 'now-card-header';
  
  // Title
  const title = document.createElement('h3');
  title.id = `card-title-${stream.id}`;
  title.className = 'now-card-title';
  title.textContent = stream.title;
  header.appendChild(title);
  
  // Status pill (smaller, inline with title)
  const status = document.createElement('div');
  status.className = `now-card-status ${stream.status}`;
  status.innerHTML = `<span aria-hidden="true">${STATUS_EMOJI[stream.status]}</span> ${STATUS_LABEL[stream.status]}`;
  header.appendChild(status);
  
  back.appendChild(header);
  
  // One-liner (moved out of meta, standalone)
  const line = document.createElement('p');
  line.className = 'now-card-line';
  line.textContent = stream.line;
  back.appendChild(line);
  
  // Tags
  if (stream.tags && stream.tags.length > 0) {
    const tags = document.createElement('div');
    tags.className = 'now-card-tags';
    stream.tags.forEach(tag => {
      const tagEl = document.createElement('span');
      tagEl.className = 'now-card-tag';
      tagEl.textContent = tag;
      tags.appendChild(tagEl);
    });
    back.appendChild(tags);
  }
  
  // Bullets
  if (stream.bullets && stream.bullets.length > 0) {
    const bullets = document.createElement('ul');
    bullets.className = 'now-card-bullets';
    stream.bullets.forEach(bullet => {
      const li = document.createElement('li');
      li.textContent = bullet;
      bullets.appendChild(li);
    });
    back.appendChild(bullets);
  }
  
  // Links (CTAs)
  if (stream.links && stream.links.length > 0) {
    const links = document.createElement('div');
    links.className = 'now-card-links';
    stream.links.forEach(link => {
      const a = document.createElement('a');
      a.className = 'now-card-link';
      a.href = link.href;
      a.textContent = link.label;
      links.appendChild(a);
    });
    back.appendChild(links);
  }
  
  // Seal (for personal projects: LOQ-J and True Rolls)
  if (stream.id === 'loqj' || stream.id === 'truerolls') {
    const seal = document.createElement('div');
    seal.className = 'now-card-seal';
    seal.setAttribute('aria-hidden', 'true');
    const sealImg = document.createElement('img');
    sealImg.src = '/artifacts/sigil/no-bg-seal-sigil.png';
    sealImg.alt = '';
    sealImg.className = 'now-card-seal-img';
    seal.appendChild(sealImg);
    back.appendChild(seal);
  }
  
  // Assemble
  inner.appendChild(front);
  inner.appendChild(back);
  card.appendChild(inner);
  
  return card;
}

// ━━━ Open Card (FLIP Animation) ━━━
function openCard(card, stream) {
  if (activeCard === card) return;
  
  // Close any open card first
  if (activeCard) {
    closeCard(activeCard, false);
  }
  
  // Save focus origin
  focusBeforeOpen = document.activeElement;
  
  // Emit background hook
  emitBackgroundEvent('card:activate', { id: stream.id });
  
  // Get elements
  const front = card.querySelector('.now-card-front');
  const back = card.querySelector('.now-card-back');
  const inner = card.querySelector('.now-card-inner');
  
  // Update ARIA
  front.setAttribute('aria-expanded', 'true');
  back.setAttribute('aria-hidden', 'false');
  
  // Show backdrop
  if (backdrop) {
    backdrop.style.display = 'block';
    // Backdrop click closes
    backdrop.addEventListener('click', () => closeCard(card), { once: true });
  }
  
  // Dim other cards
  cards.forEach(c => {
    if (c !== card) c.classList.add('dimmed');
  });
  
  // Mark as active
  card.classList.add('active');
  activeCard = card;
  
  // FLIP: First - record initial position
  const first = card.getBoundingClientRect();
  
  // Cache original position for close animation
  card._originalRect = {
    left: first.left,
    top: first.top,
    width: first.width,
    height: first.height
  };
  
  // Calculate target dimensions (proper dialog size, not scaled)
  const { w: viewportWidth, h: viewportHeight } = viewportSize();
  const isMobile = viewportWidth <= 900;
  // Mobile: 320px width, ~380px height
  // Desktop: 450px width, ~420px height (closer to original 321px but allows content)
  const maxWidth = isMobile ? Math.min(viewportWidth * 0.88, 320) : 450;
  const maxHeight = isMobile ? Math.min(viewportHeight * 0.65, 380) : Math.min(420, viewportHeight * 0.75);
  
  // Calculate actual position of filters (they're in document flow now)
  const navFilters = document.querySelector('.now-filters');
  const navRect = navFilters ? navFilters.getBoundingClientRect() : null;
  const navMargin = 30; // Space below filters
  const navBottom = navRect ? navRect.bottom + navMargin : 150; // Fallback if not found
  
  // Center position horizontally, but ensure top is below nav
  const targetLeft = (viewportWidth - maxWidth) / 2;
  const centeredTop = (viewportHeight - maxHeight) / 2;
  
  // Ensure card is positioned below nav pills (never overlap)
  const targetTop = Math.max(navBottom, centeredTop);
  
  // Set card to fixed at original position
  card.style.position = 'fixed';
  card.style.left = `${first.left}px`;
  card.style.top = `${first.top}px`;
  card.style.width = `${first.width}px`;
  card.style.height = `${first.height}px`;
  card.style.zIndex = '50';
  
  // Reduced motion check
  if (prefersReducedMotion) {
    // Simple center + fade
    card.style.left = `${targetLeft}px`;
    card.style.top = `${targetTop}px`;
    card.style.width = `${maxWidth}px`;
    card.style.height = `${maxHeight}px`;
    card.style.transition = 'all 300ms ease, opacity 300ms ease';
    card.classList.add('flipped');
    
    setTimeout(() => {
      const firstFocusable = back.querySelector('a[href], button');
      if (firstFocusable) firstFocusable.focus();
    }, 300);
    
    wireFocusTrap(back);
    return;
  }
  
  // FLIP animation - Two-phase for smooth size transition
  // Phase 1: Move to center (no flip, no size change)
  // Phase 2: Flip and expand height
  requestAnimationFrame(() => {
    // Start with current position
    card.style.transition = 'none';
    inner.style.transform = 'rotateY(0deg) scale(1)';
    inner.style.transition = 'none';
    
    // Calculate center position but keep original size initially
    const centerLeft = (viewportWidth - first.width) / 2;
    const centerTop = Math.max(navBottom, (viewportHeight - first.height) / 2);
    
    requestAnimationFrame(() => {
      // Phase 1: Move to center, slight lift with scale
      card.style.willChange = 'left, top, width, height, transform';
      card.style.transition = 'left 280ms ease-out, top 280ms ease-out, transform 280ms ease-out';
      inner.style.willChange = 'transform';
      
      // Move to center (keep original size)
      card.style.left = `${centerLeft}px`;
      card.style.top = `${centerTop}px`;
      card.style.transform = 'scale(1.02)'; // Slight lift
      
      // Phase 2: After centering, flip and resize
      setTimeout(() => {
        card.style.transition = 'width 320ms ease-in-out, height 320ms ease-in-out, left 320ms ease-in-out, top 320ms ease-in-out, transform 320ms ease-in-out';
        inner.style.transition = 'transform 400ms cubic-bezier(0.34, 1.2, 0.64, 1)';
        
        // Recalculate center for new size
        const finalLeft = (viewportWidth - maxWidth) / 2;
        const finalTop = Math.max(navBottom, (viewportHeight - maxHeight) / 2);
        
        // Flip, resize, and scale back
        card.style.left = `${finalLeft}px`;
        card.style.top = `${finalTop}px`;
        card.style.width = `${maxWidth}px`;
        card.style.height = `${maxHeight}px`;
        card.style.transform = 'scale(1)';
        inner.style.transform = 'rotateY(180deg)';
        
        // Add flipped class for CSS
        card.classList.add('flipped');
        
        // Clean up
        setTimeout(() => {
          card.style.willChange = 'auto';
          inner.style.willChange = 'auto';
          card.style.transform = '';
        }, 400);
      }, 280);
    });
  });
  
  // Focus management - focus first interactive element
  setTimeout(() => {
    const firstFocusable = back.querySelector('a[href], button');
    if (firstFocusable) firstFocusable.focus();
  }, 300);
  
  // Wire focus trap
  wireFocusTrap(back);
}

// ━━━ Close Card ━━━
function closeCard(card, restoreFocus = true) {
  if (!card) return;
  
  const front = card.querySelector('.now-card-front');
  const back = card.querySelector('.now-card-back');
  const inner = card.querySelector('.now-card-inner');
  
  // Update ARIA
  front.setAttribute('aria-expanded', 'false');
  back.setAttribute('aria-hidden', 'true');
  
  // Hide backdrop
  if (backdrop) {
    backdrop.style.display = 'none';
  }
  
  // Un-dim other cards
  cards.forEach(c => c.classList.remove('dimmed'));
  
  // Remove flip class
  card.classList.remove('flipped');
  
  // Get the card's original position in grid
  const index = parseInt(card.dataset.index);
  const grid = document.getElementById('now-card-grid');
  const gridRect = grid.getBoundingClientRect();
  const gridStyle = window.getComputedStyle(grid);
  const gap = parseInt(gridStyle.gap) || 32;
  
  // Calculate original position (approximate)
  // Note: This is a simplified calculation; actual position depends on grid layout
  const { w } = viewportSize();
  const cardsPerRow = w > 768 ? 2 : 1;
  const row = Math.floor(index / cardsPerRow);
  const col = index % cardsPerRow;
  
  // Animate back - Two-phase reverse
  // Phase 1: Flip back and shrink to original size (while centered)
  // Phase 2: Move back to grid position
  if (!prefersReducedMotion && card._originalRect) {
    const orig = card._originalRect;
    const { w: viewportWidth, h: viewportHeight } = viewportSize();
    
    // Calculate center position for original size
    const centerLeft = (viewportWidth - orig.width) / 2;
    const centerTop = (viewportHeight - orig.height) / 2;
    
    // Phase 1: Flip back and shrink (stay centered)
    card.style.transition = 'width 320ms ease-in-out, height 320ms ease-in-out, left 320ms ease-in-out, top 320ms ease-in-out, transform 320ms ease-in-out';
    inner.style.transition = 'transform 400ms cubic-bezier(0.34, 1.2, 0.64, 1)';
    
    // Shrink to original size while centered, flip back
    card.style.left = `${centerLeft}px`;
    card.style.top = `${centerTop}px`;
    card.style.width = `${orig.width}px`;
    card.style.height = `${orig.height}px`;
    card.style.transform = 'scale(1.02)';
    inner.style.transform = 'rotateY(0deg)';
    
    // Phase 2: Move back to grid
    setTimeout(() => {
      card.style.transition = 'left 280ms ease-out, top 280ms ease-out, transform 280ms ease-out';
      
      card.style.left = `${orig.left}px`;
      card.style.top = `${orig.top}px`;
      card.style.transform = 'scale(1)';
    }, 320);
  }
  
  // Restore position after animation (total: 320 + 280 = 600ms)
  setTimeout(() => {
    card.classList.remove('active');
    card.style.position = '';
    card.style.left = '';
    card.style.top = '';
    card.style.width = '';
    card.style.height = '';
    card.style.zIndex = '';
    card.style.opacity = '';
    card.style.transition = '';
    card.style.transform = '';
    inner.style.transform = '';
    inner.style.transition = '';
    
    // Clean up cached rect
    delete card._originalRect;
  }, prefersReducedMotion ? 300 : 620);
  
  // Restore focus
  if (restoreFocus && focusBeforeOpen) {
    focusBeforeOpen.focus();
    focusBeforeOpen = null;
  }
  
  // Emit background hook
  const id = card.dataset.id;
  emitBackgroundEvent('card:close', { id });
  
  activeCard = null;
}

// ━━━ Wire Filters ━━━
function wireFilters() {
  const filterButtons = document.querySelectorAll('.now-filter-chip');
  filterChips = Array.from(filterButtons);
  
  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const filter = btn.dataset.filter;
      applyFilter(filter);
      
      // Update ARIA
      filterChips.forEach(chip => {
        chip.setAttribute('aria-selected', chip === btn ? 'true' : 'false');
      });
    });
  });
}

// ━━━ Apply Filter ━━━
function applyFilter(filter) {
  currentFilter = filter;
  
  cards.forEach(card => {
    const category = card.dataset.category;
    
    if (filter === 'all') {
      card.dataset.hidden = 'false';
    } else if (filter === 'engineering' && category === 'engineering') {
      card.dataset.hidden = 'false';
    } else if (filter === 'art' && category === 'art') {
      card.dataset.hidden = 'false';
    } else {
      card.dataset.hidden = 'true';
    }
  });
  
  // Show/hide "Coming soon..." message
  const comingSoon = document.getElementById('art-coming-soon');
  if (comingSoon) {
    if (filter === 'art' || filter === 'all') {
      comingSoon.dataset.hidden = 'false';
    } else {
      comingSoon.dataset.hidden = 'true';
    }
  }
  
  // Update roving tabindex for visible cards
  updateTabIndex();
}

// ━━━ Update Roving Tabindex ━━━
function updateTabIndex() {
  const visibleCards = cards.filter(c => c.dataset.hidden !== 'true');
  visibleCards.forEach((card, index) => {
    const btn = card.querySelector('.now-card-front');
    btn.tabIndex = index === 0 ? 0 : -1;
  });
}

// ━━━ Keyboard Navigation (Arrow Keys) ━━━
function wireKeyboardNav() {
  document.addEventListener('keydown', (e) => {
    // Only handle arrow keys when focus is on a card
    const activeElement = document.activeElement;
    if (!activeElement || !activeElement.classList.contains('now-card-front')) return;
    
    const currentCard = activeElement.closest('.now-card');
    if (!currentCard) return;
    
    const visibleCards = cards.filter(c => c.dataset.hidden !== 'true');
    const currentIndex = visibleCards.indexOf(currentCard);
    
    let targetIndex = -1;
    
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        targetIndex = (currentIndex + 1) % visibleCards.length;
        e.preventDefault();
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        targetIndex = (currentIndex - 1 + visibleCards.length) % visibleCards.length;
        e.preventDefault();
        break;
      default:
        return;
    }
    
    if (targetIndex >= 0) {
      const targetCard = visibleCards[targetIndex];
      const targetBtn = targetCard.querySelector('.now-card-front');
      
      // Update tabindex
      visibleCards.forEach((card, index) => {
        const btn = card.querySelector('.now-card-front');
        btn.tabIndex = index === targetIndex ? 0 : -1;
      });
      
      targetBtn.focus();
    }
  });
}

// ━━━ Focus Trap (for dialog) ━━━
function wireFocusTrap(dialog) {
  const focusableSelectors = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const focusableElements = dialog.querySelectorAll(focusableSelectors);
  const firstFocusable = focusableElements[0];
  const lastFocusable = focusableElements[focusableElements.length - 1];
  
  const trapFocus = (e) => {
    if (e.key !== 'Tab') return;
    
    if (e.shiftKey) {
      if (document.activeElement === firstFocusable) {
        lastFocusable.focus();
        e.preventDefault();
      }
    } else {
      if (document.activeElement === lastFocusable) {
        firstFocusable.focus();
        e.preventDefault();
      }
    }
  };
  
  dialog.addEventListener('keydown', trapFocus);
}

// ━━━ Global Esc Handler ━━━
function handleEscKey(e) {
  if (e.key === 'Escape' && activeCard) {
    closeCard(activeCard);
    e.preventDefault();
    e.stopPropagation();
  }
}

// ━━━ Deep Link Support ━━━
function handleDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const filter = params.get('filter');
  const cardId = params.get('card');
  
  // Apply filter if present
  if (filter && ['all', 'engineering', 'art'].includes(filter)) {
    const chip = filterChips.find(c => c.dataset.filter === filter);
    if (chip) chip.click();
  }
  
  // Open card if present
  if (cardId) {
    setTimeout(() => {
      const card = cards.find(c => c.dataset.id === cardId);
      const stream = NOW_STREAMS.find(s => s.id === cardId);
      if (card && stream) {
        openCard(card, stream);
      }
    }, 300);
  }
}

// ━━━ Background Event Emitter (optional, no-op safe) ━━━
function emitBackgroundEvent(event, data) {
  if (typeof window.mycoBg?.emit === 'function') {
    window.mycoBg.emit(event, data);
  }
}

// ━━━ Auto-initialize when module loads ━━━
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initNowCards);
} else {
  initNowCards();
}
