// Now cards with FLIP animation

import { viewportSize } from './utils.js';

const LOGO = (name) => `/artifacts/projects/logos/${name}`;

const NOW_STREAMS = [
  {
    id: 'adp',
    logo: LOGO('ADP-noBG.png'),
    title: 'ADP - Software Engineer',
    line: 'Maintenance and development for HCM SaaS at scale',
    status: 'high',
    tags: [],
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
    links: [{ label: 'Documentation soon', unavailable: true }],
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
    links: [{ label: 'Demo soon', unavailable: true }],
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
    links: [{ label: 'Listen soon', unavailable: true }],
    category: 'art',
    hidden: true
  }
];

let activeCard = null;
let currentFilter = 'engineering';
let cards = [];
let filterChips = [];
let backdrop = null;
let prefersReducedMotion = false;
let focusBeforeOpen = null;

const STATUS_EMOJI = {
  high: '🔥',
  brewing: '⚗️',
  growing: '🌱'
};

const STATUS_LABEL = {
  high: 'High',
  brewing: 'Brewing',
  growing: 'Growing'
};

export function initNowCards() {
  prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  backdrop = document.getElementById('paper-backdrop');
  renderCards();
  wireFilters();
  applyFilter(currentFilter);
  handleDeepLink();
  wireKeyboardNav();
  document.addEventListener('keydown', handleEscKey);
}

export function destroyNowCards() {
  if (activeCard) {
    closeCard(activeCard, false);
  }
  document.removeEventListener('keydown', handleEscKey);
  cards = [];
  filterChips = [];
  activeCard = null;
  focusBeforeOpen = null;
  const grid = document.getElementById('now-card-grid');
  if (grid) grid.innerHTML = '';
}

function renderCards() {
  const grid = document.getElementById('now-card-grid');
  if (!grid) return;
  
  grid.innerHTML = '';
  cards = [];
  
  NOW_STREAMS.forEach((stream, index) => {
    if (stream.hidden) return;
    
    const card = createCard(stream, index);
    grid.appendChild(card);
    cards.push(card);
  });
  
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

function createCard(stream, index) {
  const card = document.createElement('div');
  card.className = 'now-card';
  card.dataset.id = stream.id;
  card.dataset.category = stream.category;
  card.dataset.index = index;
  
  const inner = document.createElement('div');
  inner.className = 'now-card-inner';
  
  const front = document.createElement('button');
  front.className = 'now-card-face now-card-front';
  front.setAttribute('aria-expanded', 'false');
  front.setAttribute('aria-label', `View details for ${stream.title}`);
  front.tabIndex = index === 0 ? 0 : -1;
  
  if (stream.id === 'tmt') {
    front.style.backgroundImage = `url(${stream.logo})`;
    front.style.backgroundSize = '75%';
    front.style.backgroundPosition = 'center';
    front.style.backgroundRepeat = 'no-repeat';
  } else {
    const logo = document.createElement('img');
    logo.src = stream.logo;
    logo.alt = '';
    logo.className = 'now-card-logo';
    logo.loading = 'lazy';
    front.appendChild(logo);
  }
  
  front.addEventListener('click', () => {
    if (activeCard === card) {
      closeCard(card);
    } else {
      openCard(card, stream);
    }
  });
  
  const back = document.createElement('div');
  back.className = 'now-card-face now-card-back';
  back.setAttribute('role', 'dialog');
  back.setAttribute('aria-modal', 'true');
  back.setAttribute('aria-labelledby', `card-title-${stream.id}`);
  back.setAttribute('aria-hidden', 'true');
  
  back.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') return;
    closeCard(card);
  });

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'now-card-close';
  closeButton.setAttribute('aria-label', 'Close now card');
  closeButton.textContent = '×';
  closeButton.addEventListener('click', (e) => {
    e.stopPropagation();
    closeCard(card);
  });
  back.appendChild(closeButton);
  
  const header = document.createElement('div');
  header.className = 'now-card-header';
  
  const title = document.createElement('h3');
  title.id = `card-title-${stream.id}`;
  title.className = 'now-card-title';
  title.textContent = stream.title;
  header.appendChild(title);
  
  const status = document.createElement('div');
  status.className = `now-card-status ${stream.status}`;
  status.innerHTML = `<span aria-hidden="true">${STATUS_EMOJI[stream.status]}</span> ${STATUS_LABEL[stream.status]}`;
  header.appendChild(status);
  
  back.appendChild(header);
  
  const line = document.createElement('p');
  line.className = 'now-card-line';
  line.textContent = stream.line;
  back.appendChild(line);
  
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
  
  if (stream.links && stream.links.length > 0) {
    const links = document.createElement('div');
    links.className = 'now-card-links';
    stream.links.forEach(link => {
      if (link.unavailable || !link.href || link.href === '#') {
        const unavailable = document.createElement('span');
        unavailable.className = 'now-card-link now-card-link-disabled';
        unavailable.setAttribute('aria-disabled', 'true');
        unavailable.textContent = link.label;
        links.appendChild(unavailable);
        return;
      }

      const a = document.createElement('a');
      a.className = 'now-card-link';
      a.href = link.href;
      a.textContent = link.label;
      links.appendChild(a);
    });
    back.appendChild(links);
  }
  
  if (stream.id === 'loqj' || stream.id === 'truerolls') {
    const seal = document.createElement('div');
    seal.className = 'now-card-seal';
    seal.setAttribute('aria-hidden', 'true');
    const sealImg = document.createElement('img');
    sealImg.src = '/artifacts/sigil/no-bg-seal-sigil.webp';
    sealImg.onerror = () => {
      sealImg.onerror = null;
      sealImg.src = '/artifacts/sigil/no-bg-seal-sigil.png';
    };
    sealImg.alt = '';
    sealImg.className = 'now-card-seal-img';
    seal.appendChild(sealImg);
    back.appendChild(seal);
  }
  
  inner.appendChild(front);
  inner.appendChild(back);
  card.appendChild(inner);
  
  return card;
}

function openCard(card, stream) {
  if (activeCard === card) return;
  
  if (activeCard) {
    closeCard(activeCard, false);
  }
  
  focusBeforeOpen = document.activeElement;
  
  emitBackgroundEvent('card:activate', { id: stream.id });
  
  const front = card.querySelector('.now-card-front');
  const back = card.querySelector('.now-card-back');
  const inner = card.querySelector('.now-card-inner');
  
  front.setAttribute('aria-expanded', 'true');
  back.setAttribute('aria-hidden', 'false');
  
  if (backdrop) {
    backdrop.style.display = 'block';
    backdrop.addEventListener('click', () => closeCard(card), { once: true });
  }
  
  cards.forEach(c => {
    if (c !== card) c.classList.add('dimmed');
  });
  
  card.classList.add('active');
  activeCard = card;
  
  const first = card.getBoundingClientRect();
  
  card._originalRect = {
    left: first.left,
    top: first.top,
    width: first.width,
    height: first.height
  };
  
  const { w: viewportWidth, h: viewportHeight } = viewportSize();
  const isMobile = viewportWidth <= 900;
  const maxWidth = isMobile ? Math.min(viewportWidth * 0.88, 320) : 450;
  const maxHeight = isMobile ? Math.min(viewportHeight * 0.65, 380) : Math.min(420, viewportHeight * 0.75);
  
  const navFilters = document.querySelector('.now-filters');
  const navRect = navFilters ? navFilters.getBoundingClientRect() : null;
  const navMargin = 30;
  const navBottom = navRect ? navRect.bottom + navMargin : 150;
  
  const targetLeft = (viewportWidth - maxWidth) / 2;
  const centeredTop = (viewportHeight - maxHeight) / 2;
  const targetTop = Math.max(navBottom, centeredTop);
  
  card.style.position = 'fixed';
  card.style.left = `${first.left}px`;
  card.style.top = `${first.top}px`;
  card.style.width = `${first.width}px`;
  card.style.height = `${first.height}px`;
  card.style.zIndex = '50';
  
  if (prefersReducedMotion) {
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
  
  requestAnimationFrame(() => {
    card.style.transition = 'none';
    inner.style.transform = 'rotateY(0deg) scale(1)';
    inner.style.transition = 'none';
    
    const centerLeft = (viewportWidth - first.width) / 2;
    const centerTop = Math.max(navBottom, (viewportHeight - first.height) / 2);
    
    requestAnimationFrame(() => {
      card.style.willChange = 'left, top, width, height, transform';
      card.style.transition = 'left 280ms ease-out, top 280ms ease-out, transform 280ms ease-out';
      inner.style.willChange = 'transform';
      
      card.style.left = `${centerLeft}px`;
      card.style.top = `${centerTop}px`;
      card.style.transform = 'scale(1.02)';
      
      setTimeout(() => {
        card.style.transition = 'width 320ms ease-in-out, height 320ms ease-in-out, left 320ms ease-in-out, top 320ms ease-in-out, transform 320ms ease-in-out';
        inner.style.transition = 'transform 400ms cubic-bezier(0.34, 1.2, 0.64, 1)';
        
        const finalLeft = (viewportWidth - maxWidth) / 2;
        const finalTop = Math.max(navBottom, (viewportHeight - maxHeight) / 2);
        
        card.style.left = `${finalLeft}px`;
        card.style.top = `${finalTop}px`;
        card.style.width = `${maxWidth}px`;
        card.style.height = `${maxHeight}px`;
        card.style.transform = 'scale(1)';
        inner.style.transform = 'rotateY(180deg)';
        
        card.classList.add('flipped');
        
        setTimeout(() => {
          card.style.willChange = 'auto';
          inner.style.willChange = 'auto';
          card.style.transform = '';
        }, 400);
      }, 280);
    });
  });
  
  setTimeout(() => {
    const firstFocusable = back.querySelector('a[href], button');
    if (firstFocusable) firstFocusable.focus();
  }, 300);
  
  wireFocusTrap(back);
}

function closeCard(card, restoreFocus = true) {
  if (!card) return;
  
  const front = card.querySelector('.now-card-front');
  const back = card.querySelector('.now-card-back');
  const inner = card.querySelector('.now-card-inner');
  
  front.setAttribute('aria-expanded', 'false');
  back.setAttribute('aria-hidden', 'true');
  
  if (backdrop) {
    backdrop.style.display = 'none';
  }
  
  cards.forEach(c => c.classList.remove('dimmed'));
  
  card.classList.remove('flipped');
  
  const index = parseInt(card.dataset.index);
  const grid = document.getElementById('now-card-grid');
  const gridRect = grid.getBoundingClientRect();
  const gridStyle = window.getComputedStyle(grid);
  const gap = parseInt(gridStyle.gap) || 32;
  
  const { w } = viewportSize();
  const cardsPerRow = w > 768 ? 2 : 1;
  const row = Math.floor(index / cardsPerRow);
  const col = index % cardsPerRow;
  
  if (!prefersReducedMotion && card._originalRect) {
    const orig = card._originalRect;
    const { w: viewportWidth, h: viewportHeight } = viewportSize();
    
    const centerLeft = (viewportWidth - orig.width) / 2;
    const centerTop = (viewportHeight - orig.height) / 2;
    
    card.style.transition = 'width 320ms ease-in-out, height 320ms ease-in-out, left 320ms ease-in-out, top 320ms ease-in-out, transform 320ms ease-in-out';
    inner.style.transition = 'transform 400ms cubic-bezier(0.34, 1.2, 0.64, 1)';
    
    card.style.left = `${centerLeft}px`;
    card.style.top = `${centerTop}px`;
    card.style.width = `${orig.width}px`;
    card.style.height = `${orig.height}px`;
    card.style.transform = 'scale(1.02)';
    inner.style.transform = 'rotateY(0deg)';
    
    setTimeout(() => {
      card.style.transition = 'left 280ms ease-out, top 280ms ease-out, transform 280ms ease-out';
      
      card.style.left = `${orig.left}px`;
      card.style.top = `${orig.top}px`;
      card.style.transform = 'scale(1)';
    }, 320);
  }
  
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
    
    delete card._originalRect;
  }, prefersReducedMotion ? 300 : 620);
  
  if (restoreFocus && focusBeforeOpen) {
    focusBeforeOpen.focus();
    focusBeforeOpen = null;
  }
  
  const id = card.dataset.id;
  emitBackgroundEvent('card:close', { id });
  
  activeCard = null;
}

function wireFilters() {
  const filterButtons = document.querySelectorAll('.now-filter-chip');
  filterChips = Array.from(filterButtons);
  
  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const filter = btn.dataset.filter;
      applyFilter(filter);
      
      filterChips.forEach(chip => {
        chip.setAttribute('aria-selected', chip === btn ? 'true' : 'false');
      });
    });
  });
}

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
  
  const comingSoon = document.getElementById('art-coming-soon');
  if (comingSoon) {
    if (filter === 'art' || filter === 'all') {
      comingSoon.dataset.hidden = 'false';
    } else {
      comingSoon.dataset.hidden = 'true';
    }
  }
  
  updateTabIndex();
}

function updateTabIndex() {
  const visibleCards = cards.filter(c => c.dataset.hidden !== 'true');
  visibleCards.forEach((card, index) => {
    const btn = card.querySelector('.now-card-front');
    btn.tabIndex = index === 0 ? 0 : -1;
  });
}

function wireKeyboardNav() {
  document.addEventListener('keydown', (e) => {
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
      
      visibleCards.forEach((card, index) => {
        const btn = card.querySelector('.now-card-front');
        btn.tabIndex = index === targetIndex ? 0 : -1;
      });
      
      targetBtn.focus();
    }
  });
}

function wireFocusTrap(dialog) {
  if (dialog.__nowFocusTrapBound) return;
  dialog.__nowFocusTrapBound = true;

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

function handleEscKey(e) {
  if (e.key === 'Escape' && activeCard) {
    closeCard(activeCard);
    e.preventDefault();
    e.stopPropagation();
  }
}

function handleDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const filter = params.get('filter');
  const cardId = params.get('card');
  
  if (filter && ['all', 'engineering', 'art'].includes(filter)) {
    const chip = filterChips.find(c => c.dataset.filter === filter);
    if (chip) chip.click();
  }
  
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

function emitBackgroundEvent(event, data) {
  if (typeof window.mycoBg?.emit === 'function') {
    window.mycoBg.emit(event, data);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initNowCards);
} else {
  initNowCards();
}
