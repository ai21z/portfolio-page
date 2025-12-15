/**
 * Ritual Wheel - Projects Section (MTG-STYLE CARDS)
 * 
 * Project cards arranged in a mystical wheel with portal-to-body magnification.
 * FOLLOWS THE EXACT PAPER PATTERN FROM app.js + MTG-inspired card design
 * 
 * Architecture:
 * - MTG-style cards: header → art (ring+jar) → textbox → tech badges
 * - Portal pattern: card → placeholder → body → animate (same as papers)
 * - Existing backdrop system (#paper-backdrop + .has-paper-open-global)
 * - Standard z-index hierarchy
 * 
 * Performance: Transform/opacity only, 60fps
 * Accessibility: Roving tabindex, keyboard navigation, ARIA
 */

// ━━━ Project Data ━━━

const projects = [
  {
    id: 'mycelij',
    title: 'MyceliJ',
    subtitle: 'JVM-Native LLM',
    img: 'artifacts/projects/mycelij-no-bg.png',
    blurb: 'Pure-Java language model leveraging Vector API and Structured Concurrency. Local-first, no Python dependencies.',
    cardType: 'artifact', // MTG-style card type
    tech: ['java', 'vector-api', 'concurrency'], // Tech badges (mana cost style)
    links: [
      { label: 'Documentation', url: '/projects/mycelij' },
      { label: 'GitHub', url: '#' }
    ]
  },
  {
    id: 'loqj',
    title: 'LOQJ',
    subtitle: 'CLI Framework',
    img: 'artifacts/projects/jar-loqj-no-bg.png',
    blurb: 'Developer toolkit for rapid prototyping with intelligent code generation.',
    cardType: 'tool',
    tech: ['typescript', 'node', 'cli'],
    links: [
      { label: 'NPM Package', url: '#' },
      { label: 'Docs', url: '/projects/loqj' }
    ]
  },
  {
    id: 'truerolls',
    title: 'True Rolls',
    subtitle: 'Dice System',
    img: 'artifacts/projects/true-rolls-no-bg.png',
    blurb: 'Cryptographically fair dice rolling with beautiful physics simulation.',
    cardType: 'enchantment',
    tech: ['javascript', 'webgl', 'physics'],
    links: [
      { label: 'Live Demo', url: '/projects/truerolls' },
      { label: 'Source', url: '#' }
    ]
  }
];

// ━━━ State ━━━

let state = {
  initialized: false,
  activeCard: null,
  panelElement: null,
  cardElements: [],
  resizeObserver: null,
  intersectionObserver: null,
  isVisible: false
};

// ━━━ Initialization ━━━

export function initProjectsWheel() {
  if (state.initialized) {
    console.warn('[Ritual Wheel] Already initialized');
    return;
  }

  const container = document.querySelector('.rw-card-constellation');
  const stage = document.querySelector('.rw-projects-stage');
  
  if (!container || !stage) {
    console.error('[Ritual Wheel] Required elements not found');
    return;
  }

  // Create panel element
  createPanelElement(stage);
  
  // Build wheel
  buildWheel(container);
  
  // Position cards
  positionCards();
  
  // Attach events
  attachEventListeners();
  
  // Resize observer
  setupResizeObserver();
  
  // Intersection observer for performance
  setupVisibilityObserver(stage);
  
  state.initialized = true;
}

export function destroyProjectsWheel() {
  if (!state.initialized) return;
  
  // Close if open
  if (state.activeCard) {
    closePanel();
  }
  
  // Remove listeners
  state.cardElements.forEach(card => {
    card.removeEventListener('click', handleCardClick);
    card.removeEventListener('keydown', handleCardKeydown);
  });
  
  const backdrop = document.getElementById('paper-backdrop');
  if (backdrop) {
    backdrop.removeEventListener('click', closePanel);
  }
  
  // Disconnect observers
  if (state.resizeObserver) {
    state.resizeObserver.disconnect();
  }
  if (state.intersectionObserver) {
    state.intersectionObserver.disconnect();
  }
  
  // Reset state
  state = {
    initialized: false,
    activeCard: null,
    panelElement: null,
    cardElements: [],
    resizeObserver: null,
    intersectionObserver: null,
    isVisible: false
  };
}

// ━━━ DOM Building ━━━

function createPanelElement(stage) {
  const panel = document.createElement('article');
  panel.className = 'rw-parchment-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'rw-panel-title');
  panel.innerHTML = `
    <h2 class="rw-panel-title" id="rw-panel-title"></h2>
    <p class="rw-panel-blurb"></p>
    <nav class="rw-panel-actions" aria-label="Project links"></nav>
  `;
  // CRITICAL: Append to body, not stage! (same stacking context as magnified card)
  document.body.appendChild(panel);
  state.panelElement = panel;
}

function buildWheel(container) {
  // Build cards
  projects.forEach((project, index) => {
    const card = createCardElement(project, index);
    container.appendChild(card);
    state.cardElements.push(card);
  });
}

function createCardElement(project, index) {
  const button = document.createElement('button');
  button.classList.add('rw-card');
  button.setAttribute('data-card-id', project.id);
  button.setAttribute('data-card-index', index);
  button.setAttribute('data-card-type', project.cardType);
  button.setAttribute('aria-label', `${project.title} ${project.subtitle} - Click to view details`);
  button.setAttribute('tabindex', index === 0 ? '0' : '-1');
  
  // Card structure (MTG-inspired)
  button.innerHTML = `
    <div class="rw-card-header">
      <span class="rw-card-title">${project.title}</span>
      <span class="rw-card-subtitle">${project.subtitle}</span>
    </div>
    
    <div class="rw-card-art">
      <!-- Living Ring (exact copy from altar) -->
      <svg class="rw-card-ring" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs>
          <path id="ring-orbit-${project.id}" d="M50,5 A45,45 0 1,1 49.99,5" />
        </defs>
        
        <circle cx="50" cy="50" r="48" class="rw-ring-halo"/>
        <circle cx="50" cy="50" r="45" class="rw-ring-stroke"/>
        
        <circle class="rw-ring-spore" r="0.9">
          <animateMotion dur="9s" repeatCount="indefinite" rotate="auto">
            <mpath href="#ring-orbit-${project.id}"/>
          </animateMotion>
        </circle>
        <circle class="rw-ring-spore" r="0.9">
          <animateMotion dur="12s" repeatCount="indefinite" rotate="auto">
            <mpath href="#ring-orbit-${project.id}"/>
          </animateMotion>
        </circle>
        <circle class="rw-ring-spore ember" r="1.1">
          <animateMotion dur="15s" repeatCount="indefinite" rotate="auto">
            <mpath href="#ring-orbit-${project.id}"/>
          </animateMotion>
        </circle>
      </svg>
      
      <!-- Jar Specimen -->
            </svg>
      <img 
        src="${project.img}" 
        alt="${project.title}" 
        class="rw-card-jar"
        loading="lazy"
        decoding="async"
      />
    </div>
    </div>
    
    <div class="rw-card-textbox">
      <p class="rw-card-blurb">${project.blurb}</p>
    </div>
    
    <div class="rw-card-footer">
      ${project.tech.map(t => `<span class="rw-tech-badge" data-tech="${t}">${getTechIcon(t)}</span>`).join('')}
    </div>
  `;
  
  return button;
}

// Tech badge icons (simple text for now, can be replaced with SVG icons)
function getTechIcon(tech) {
  const icons = {
    'java': '☕',
    'vector-api': '⚡',
    'concurrency': '🔄',
    'typescript': 'TS',
    'node': '⬢',
    'cli': '⌨',
    'javascript': 'JS',
    'webgl': '🎮',
    'physics': '⚛'
  };
  return icons[tech] || tech.slice(0, 2).toUpperCase();
}

// ━━━ Positioning ━━━

function getCardAngle(index) {
  // Triangle formation for 3 cards
  if (projects.length === 3) {
    const angles = [
      -Math.PI / 2,        // Top (North)
      Math.PI / 6,         // Bottom-right (30°)
      (5 * Math.PI) / 6    // Bottom-left (150°)
    ];
    return angles[index];
  }
  
  // Even spacing for other counts
  const baseAngle = -Math.PI / 2;
  const angleStep = (Math.PI * 2) / projects.length;
  return baseAngle + (index * angleStep);
}

function positionCards() {
  const radiusPercent = 42; // 42% of container (slightly larger for cards)
  
  state.cardElements.forEach((card, index) => {
    const angle = getCardAngle(index);
    const xPercent = 50 + Math.cos(angle) * radiusPercent;
    const yPercent = 50 + Math.sin(angle) * radiusPercent;
    
    // Use CSS custom properties (matching CSS)
    card.style.setProperty('--card-x', `${xPercent}%`);
    card.style.setProperty('--card-y', `${yPercent}%`);
  });
}

// ━━━ Event Handling ━━━

function attachEventListeners() {
  // Card interactions
  state.cardElements.forEach(card => {
    card.addEventListener('click', handleCardClick);
    card.addEventListener('keydown', handleCardKeydown);
  });
  
  // Backdrop click to close
  const backdrop = document.getElementById('paper-backdrop');
  if (backdrop) {
    backdrop.addEventListener('click', closePanel);
  }
  
  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.activeCard) {
      closePanel();
    }
  });
}

function handleCardClick(e) {
  e.preventDefault();
  e.stopPropagation();
  
  const card = e.currentTarget;
  const cardId = card.getAttribute('data-card-id');
  const project = projects.find(p => p.id === cardId);
  
  if (project) {
    openCard(card, project);
  }
}

function handleCardKeydown(e) {
  const currentIndex = parseInt(e.currentTarget.getAttribute('data-card-index'));
  
  switch (e.key) {
    case 'Enter':
    case ' ':
      e.preventDefault();
      handleCardClick(e);
      break;
      
    case 'ArrowRight':
    case 'ArrowDown':
      e.preventDefault();
      moveFocus((currentIndex + 1) % state.cardElements.length);
      break;
      
    case 'ArrowLeft':
    case 'ArrowUp':
      e.preventDefault();
      moveFocus((currentIndex - 1 + state.cardElements.length) % state.cardElements.length);
      break;
  }
}

function moveFocus(newIndex) {
  state.cardElements.forEach((card, i) => {
    card.setAttribute('tabindex', i === newIndex ? '0' : '-1');
  });
  state.cardElements[newIndex].focus();
}

// ━━━ Portal Pattern (Exact Copy from app.js paper system) ━━━

function openCard(card, project) {
  if (state.activeCard) return;
  
  state.activeCard = card;
  
  // 1. Get original position
  const r = card.getBoundingClientRect();
  
  // 2. Create placeholder
  const placeholder = document.createElement('div');
  placeholder.className = 'rw-card-placeholder';
  placeholder.style.visibility = 'hidden';
  placeholder.style.pointerEvents = 'none';
  
  // 3. Portal to body
  card.__portal = { parent: card.parentNode, placeholder: placeholder };
  card.__portal.parent.insertBefore(placeholder, card);
  document.body.appendChild(card);
  
  // 4. Make fixed with frozen position
  card.classList.add('rw-card-magnified');
  card.style.position = 'fixed';
  card.style.left = `${r.left}px`;
  card.style.top = `${r.top}px`;
  card.style.width = `${r.width}px`;
  card.style.height = `${r.height}px`;
  
  // 5. Start with zero transform
  card.style.setProperty('--open-tx', '0px');
  card.style.setProperty('--open-ty', '0px');
  card.style.setProperty('--open-scale', '1');
  
  // 6. Calculate center translation
  const vw = window.innerWidth, vh = window.innerHeight;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const tx = (vw / 2) - cx;
  const ty = (vh / 2) - cy;
  const scale = 1.5; // Slightly larger for cards
  
  // 7. Animate to center
  requestAnimationFrame(() => {
    card.style.setProperty('--open-tx', `${tx}px`);
    card.style.setProperty('--open-ty', `${ty}px`);
    card.style.setProperty('--open-scale', `${scale}`);
  });
  
  // 8. Dim other cards
  state.cardElements.forEach(c => {
    if (c !== card) {
      c.classList.add('rw-card-dimmed');
      c.setAttribute('aria-hidden', 'true');
    }
  });
  
  // 9. Activate backdrop
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  document.body.classList.add('has-paper-open-global');
  
  // 10. Show panel
  showPanel(project);
  
  // 11. Focus
  requestAnimationFrame(() => {
    card.focus({ preventScroll: true });
  });
}

function closePanel() {
  if (!state.activeCard) return;
  
  const card = state.activeCard;
  
  // 1. Animate back
  card.style.setProperty('--open-tx', '0px');
  card.style.setProperty('--open-ty', '0px');
  card.style.setProperty('--open-scale', '1');
  
  // 2. Clean up on transition end
  const cleanup = () => {
    card.classList.remove('rw-card-magnified');
    card.removeAttribute('role');
    card.removeAttribute('aria-modal');
    card.style.position = '';
    card.style.left = '';
    card.style.top = '';
    card.style.width = '';
    card.style.height = '';
    card.style.removeProperty('--open-tx');
    card.style.removeProperty('--open-ty');
    card.style.removeProperty('--open-scale');
    
    // Portal return
    if (card.__portal) {
      card.__portal.parent.insertBefore(card, card.__portal.placeholder);
      card.__portal.placeholder.remove();
      card.__portal = null;
    }
    
    card.removeEventListener('transitionend', cleanup);
  };
  
  card.addEventListener('transitionend', cleanup, { once: true });
  
  // Fallback cleanup
  setTimeout(cleanup, 400);
  
  // 3. Restore other cards
  state.cardElements.forEach(c => {
    if (c !== card) {
      c.classList.remove('rw-card-dimmed');
      c.removeAttribute('aria-hidden');
    }
  });
  
  // 4. Hide panel
  hidePanel();
  
  // 5. Deactivate backdrop
  document.body.classList.remove('has-paper-open-global');
  
  // 6. Clear state
  state.activeCard = null;
}

// ━━━ Panel Management ━━━

function showPanel(project) {
  if (!state.panelElement) return;
  
  const panel = state.panelElement;
  
  // Populate content
  panel.querySelector('.rw-panel-title').textContent = `${project.title} — ${project.subtitle}`;
  panel.querySelector('.rw-panel-blurb').textContent = project.blurb;
  
  const actions = panel.querySelector('.rw-panel-actions');
  actions.innerHTML = '';
  project.links.forEach(link => {
    const a = document.createElement('a');
    a.href = link.url;
    a.className = 'rw-panel-link';
    a.textContent = link.label;
    actions.appendChild(a);
  });
  
  // Show
  panel.classList.add('rw-panel-visible');
  panel.removeAttribute('aria-hidden');
}

function hidePanel() {
  if (!state.panelElement) return;
  
  state.panelElement.classList.remove('rw-panel-visible');
  state.panelElement.setAttribute('aria-hidden', 'true');
}

// ━━━ Resize Observer ━━━

function setupResizeObserver() {
  if (!window.ResizeObserver) return;
  
  const chamber = document.querySelector('.rw-wheel-chamber');
  if (!chamber) return;
  
  state.resizeObserver = new ResizeObserver(() => {
    if (!state.activeCard) {
      positionCards();
    }
  });
  
  state.resizeObserver.observe(chamber);
}

// ━━━ Visibility Observer (Performance Optimization) ━━━

function setupVisibilityObserver(stage) {
  if (!window.IntersectionObserver) return;
  
  state.intersectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        const isVisible = entry.isIntersecting;
        state.isVisible = isVisible;
        
        // Pause/resume SVG animations based on visibility
        state.cardElements.forEach(card => {
          const svg = card.querySelector('.rw-card-ring');
          if (svg) {
            if (isVisible) {
              svg.unpauseAnimations();
              card.classList.remove('rw-animations-paused');
            } else {
              svg.pauseAnimations();
              card.classList.add('rw-animations-paused');
            }
          }
        });
      });
    },
    { threshold: 0 }
  );
  
  state.intersectionObserver.observe(stage);
}
