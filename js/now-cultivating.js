/**
 * ⚠️ POTENTIALLY DEAD CODE - Commented out 2025-12-15
 * See CLEANUP-PENDING.md in project root for details.
 * 
 * Exports initNow() and destroyNow() but neither is imported anywhere.
 * now-cards.js is loaded directly via script tag in index.html.
 * This file may be legacy or an unfinished refactor.
 * 
 * Original header:
 * Now — Cultivating
 * Living "Now" page showing current life streams and active work.
 * Features flippable cards with status indicators (🔥⚗️🌱).
 */

/*
import { initNowCards, destroyNowCards } from './now-cards.js';

// ━━━ Life Stream Data (for future card implementation) ━━━

const lifeStreams = [
  {
    id: 'professional',
    title: 'Building at Scale',
    status: 'active', // 🔥
    category: 'Employment',
    content: 'HCM SaaS platform @ ADP. Backend services (Java/Spring). Meeting SLAs, steady releases.',
    tech: ['Java', 'Spring', 'PostgreSQL', 'REST APIs'],
    icon: 'briefcase' // Future: actual icon/logo
  },
  {
    id: 'crafting',
    title: 'Local-First Tools',
    status: 'brewing', // ⚗️
    category: 'Development',
    content: 'LOQJ: RAG CLI with Lucene + Ollama. True-Rolls: Verifiable dice with receipts. Building calm, reliable software.',
    tech: ['Java', 'Lucene', 'ChaCha20', 'CLI Design'],
    icon: 'wrench',
    logo: './artifacts/projects/jar-loqj-no-bg.png' // LOQJ logo
  },
  {
    id: 'composing',
    title: 'The Murderer\'s Thumb',
    status: 'brewing', // ⚗️
    category: 'Music',
    content: 'First two songs in production. Guitar, piano, composition. Sound mix & design.',
    tech: ['Guitar', 'Piano', 'DAW', 'Production'],
    icon: 'music'
  },
  {
    id: 'conjuring',
    title: 'Necrography',
    status: 'growing', // 🌱
    category: 'Art',
    content: 'Horror visual art design. This website\'s living aesthetic. Mycelium, spores, dark rituals.',
    tech: ['WebGL', 'Organic UI', 'Gothic Design'],
    icon: 'palette'
  }
];

// ━━━ State ━━━

let state = {
  initialized: false,
  cards: [],
  intersectionObserver: null,
  isVisible: false
};

// ━━━ Public API ━━━

// Initialize the Now page and cards.
export function initNow() {
  if (state.initialized) {
    console.warn('[Now] Already initialized');
    return;
  }

  const stage = document.querySelector('.now-stage');
  if (!stage) {
    console.error('[Now] Stage element not found');
    return;
  }

  console.log('[Now] Initializing...');
  
  // Setup intersection observer for performance
  setupVisibilityObserver(stage);
  
  // Wire close button
  const closeBtn = stage.querySelector('.now-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', handleClose);
  }

  // Initialize cards
  initNowCards();

  state.initialized = true;
  console.log('[Now] Ready');
}

// Cleanup the Now page.
// Idempotent - safe to call multiple times.
export function destroyNow() {
  if (!state.initialized) return;

  console.log('[Now] Destroying');

  // Destroy cards
  destroyNowCards();

  // Disconnect observer
  if (state.intersectionObserver) {
    state.intersectionObserver.disconnect();
    state.intersectionObserver = null;
  }

  // Clear state
  state.cards = [];
  state.isVisible = false;
  state.initialized = false;
}

// ━━━ Internal Helpers ━━━

// Setup visibility observer to pause/resume animations when off-screen.
function setupVisibilityObserver(stage) {
  if (typeof IntersectionObserver === 'undefined') return;

  state.intersectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        state.isVisible = entry.isIntersecting;
        if (!entry.isIntersecting) {
          // Pause animations when not visible (future card animations)
          console.log('[Now] Page hidden, pausing animations');
        } else {
          console.log('[Now] Page visible, resuming animations');
        }
      });
    },
    { threshold: 0.1 }
  );

  state.intersectionObserver.observe(stage);
}

// Handle close button click.
// Close without triggering intro animations/ritual.
function handleClose() {
  // Get the Now stage
  const stage = document.querySelector('.now-stage');
  if (!stage) return;
  
  // Close any open card cards first (check if closeCard exists)
  // Note: activeCard is in now-cards.js scope, so we can't directly access it
  // But clicking backdrop will close any open card
  const backdrop = document.getElementById('paper-backdrop');
  if (backdrop && backdrop.classList.contains('active')) {
    backdrop.click();
  }
  
  // Remove active state from Now section
  stage.classList.remove('active-section');
  
  // Get intro section and make it active
  const intro = document.querySelector('[data-section="intro"]');
  if (intro) {
    intro.classList.add('active-section');
  }
  
  // Update URL without triggering navigation
  history.replaceState(null, '', window.location.pathname);
  
  // Restore body scroll
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
  document.body.classList.remove('nav-suppressed');
  
  // Don't call stopRitualBackground to avoid triggering animations
  // The background should just naturally fade/stay in intro state
}

// ━━━ Reduced Motion Support ━━━

// Check user's motion preference.
// Returns true if user prefers reduced motion
function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

// ━━━ Future: Card Implementation (Step 2) ━━━

// Build flippable cards from lifeStreams data.
// To be implemented in Step 2.
function buildCards() {
  // TODO: Create flippable card elements
  // TODO: Position in constellation
  // TODO: Wire flip interactions
  // TODO: Add status indicators (🔥⚗️🌱)
  console.log('[Now] Card building deferred to Step 2');
}

// Position cards in the chamber.
// To be implemented in Step 2.
function positionCards() {
  // TODO: Layout algorithm (grid? circular? organic?)
  console.log('[Now] Card positioning deferred to Step 2');
}
*/
