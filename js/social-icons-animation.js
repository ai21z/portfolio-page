// Social icons floating animation

class SocialIconsAnimation {
  constructor() {
    this.icons = [];
    this.time = 0;
    this.lastTimestamp = 0;
    this.animationFrameId = null;
    this.isActive = false;
    this.isSectionVisible = true;
    this.splitContainer = null;
    this.splitEnterHandler = null;
    this.splitLeaveHandler = null;
    this.splitFocusHandler = null;
    this.splitBlurHandler = null;
    this.splitTimeout = null;
  }

  init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.setup());
    } else {
      this.setup();
    }
  }

  setup() {
    const iconElements = document.querySelectorAll('.sigil-vial:not(.sigil-vial-split)');
    
    if (!iconElements.length) {
      console.warn('No social icons found');
      return;
    }

    iconElements.forEach((element, index) => {
      this.icons.push({
        element,
        phaseX: Math.random() * Math.PI * 2,
        phaseY: Math.random() * Math.PI * 2,
        phaseRotate: Math.random() * Math.PI * 2,
        phaseScale: Math.random() * Math.PI * 2,
        frequencyX: 0.3 + Math.random() * 0.4,
        frequencyY: 0.4 + Math.random() * 0.5,
        frequencyRotate: 0.2 + Math.random() * 0.3,
        frequencyScale: 0.5 + Math.random() * 0.4,
        amplitudeX: 6 + Math.random() * 4,
        amplitudeY: 6 + Math.random() * 4,
        amplitudeRotate: 2 + Math.random() * 3,
        amplitudeScale: 0.02 + Math.random() * 0.04,
        isHovered: false
      });

      element.addEventListener('mouseenter', () => {
        this.icons[index].isHovered = true;
      });
      
      element.addEventListener('mouseleave', () => {
        this.icons[index].isHovered = false;
      });
    });

    this.setupSplitBubble();

    this.start();
  }

  setupSplitBubble() {
    this.splitContainer = document.querySelector('.sigil-vial-split');
    if (!this.splitContainer) return;

    const bubbles = this.splitContainer.querySelectorAll('.vial-split-bubble');
    if (!bubbles.length) return;

    const isWithinSplit = target => {
      if (!target) return false;
      return target === this.splitContainer || this.splitContainer.contains(target);
    };

    const openSplit = () => {
      if (this.splitTimeout) {
        clearTimeout(this.splitTimeout);
        this.splitTimeout = null;
      }
      this.splitContainer.classList.add('is-split');
    };

    const scheduleClose = () => {
      if (this.splitTimeout) {
        clearTimeout(this.splitTimeout);
      }
      this.splitTimeout = setTimeout(() => {
        this.splitContainer.classList.remove('is-split');
        this.splitTimeout = null;
      }, 180);
    };

    const handlePointerEnter = () => {
      openSplit();
    };

    const handlePointerLeave = event => {
      if (event && isWithinSplit(event.relatedTarget)) {
        return;
      }
      scheduleClose();
    };

    const handleFocusIn = () => {
      openSplit();
    };

    const handleFocusOut = event => {
      if (event && isWithinSplit(event.relatedTarget)) {
        return;
      }
      scheduleClose();
    };

    this.splitEnterHandler = handlePointerEnter;
    this.splitLeaveHandler = handlePointerLeave;
    this.splitFocusHandler = handleFocusIn;
    this.splitBlurHandler = handleFocusOut;

    this.splitContainer.addEventListener('pointerenter', this.splitEnterHandler);
    this.splitContainer.addEventListener('pointerleave', this.splitLeaveHandler);
    this.splitContainer.addEventListener('focusin', this.splitFocusHandler);
    this.splitContainer.addEventListener('focusout', this.splitBlurHandler);

    bubbles.forEach(bubble => {
      bubble.addEventListener('focus', this.splitFocusHandler);
      bubble.addEventListener('blur', this.splitBlurHandler);
      bubble.addEventListener('pointerenter', this.splitEnterHandler);
      bubble.addEventListener('pointerleave', this.splitLeaveHandler);
    });
  }

  start() {
    if (this.isActive) return;
    this.isActive = true;
    this.lastTimestamp = 0;
    this.animate();
  }

  stop() {
    this.isActive = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  animate(timestamp) {
    if (!this.isActive) return;

    // Compute real delta time (clamped to prevent jumps after tab switch)
    if (!timestamp) timestamp = performance.now();
    const dt = this.lastTimestamp ? Math.min((timestamp - this.lastTimestamp) / 1000, 0.1) : 0.016;
    this.lastTimestamp = timestamp;

    // Skip work if section is not visible (but keep loop alive for quick resume)
    if (!this.isSectionVisible) {
      this.animationFrameId = requestAnimationFrame((ts) => this.animate(ts));
      return;
    }

    this.time += dt;

    this.icons.forEach(icon => {
      const {
        element,
        phaseX, phaseY, phaseRotate, phaseScale,
        frequencyX, frequencyY, frequencyRotate, frequencyScale,
        amplitudeX, amplitudeY, amplitudeRotate, amplitudeScale,
        isHovered
      } = icon;

      const translateX = Math.sin(this.time * frequencyX + phaseX) * amplitudeX;
      const translateY = Math.sin(this.time * frequencyY + phaseY) * amplitudeY;
      const rotate = Math.sin(this.time * frequencyRotate + phaseRotate) * amplitudeRotate;
      const scale = 1 + Math.sin(this.time * frequencyScale + phaseScale) * amplitudeScale;

      const hoverDamping = isHovered ? 0.3 : 1;

      element.style.transform = `
        translate(${translateX * hoverDamping}px, ${translateY * hoverDamping}px)
        rotate(${rotate * hoverDamping}deg)
        scale(${1 + (scale - 1) * hoverDamping})
      `;
    });

    this.animationFrameId = requestAnimationFrame((ts) => this.animate(ts));
  }

  destroy() {
    this.stop();
    this.icons.forEach(icon => {
      if (icon.element) {
        icon.element.style.transform = '';
      }
    });
    this.icons = [];

    if (this.splitContainer) {
      this.splitContainer.classList.remove('is-split');
      this.splitContainer.removeEventListener('pointerenter', this.splitEnterHandler);
      this.splitContainer.removeEventListener('pointerleave', this.splitLeaveHandler);
      this.splitContainer.removeEventListener('focusin', this.splitFocusHandler);
      this.splitContainer.removeEventListener('focusout', this.splitBlurHandler);

      const bubbles = this.splitContainer.querySelectorAll('.vial-split-bubble');
      bubbles.forEach(bubble => {
        bubble.removeEventListener('focus', this.splitFocusHandler);
        bubble.removeEventListener('blur', this.splitBlurHandler);
        bubble.removeEventListener('pointerenter', this.splitEnterHandler);
        bubble.removeEventListener('pointerleave', this.splitLeaveHandler);
      });
    }

    if (this.splitTimeout) {
      clearTimeout(this.splitTimeout);
      this.splitTimeout = null;
    }

    this.splitContainer = null;
  }
}

// Initialize on page load
const socialIconsAnimation = new SocialIconsAnimation();
socialIconsAnimation.init();

// Handle page visibility changes to pause when tab is hidden
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    socialIconsAnimation.stop();
  } else {
    socialIconsAnimation.start();
  }
});

// Gate animation to intro section visibility (icons only visible there)
const _introStageForIcons = document.querySelector('.stage[data-section="intro"]');
if (_introStageForIcons) {
  const obs = new MutationObserver(() => {
    socialIconsAnimation.isSectionVisible = _introStageForIcons.classList.contains('active-section');
  });
  obs.observe(_introStageForIcons, { attributes: true, attributeFilter: ['class'] });
  socialIconsAnimation.isSectionVisible = _introStageForIcons.classList.contains('active-section');
}

// Respect prefers-reduced-motion
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  socialIconsAnimation.destroy();
}

export default socialIconsAnimation;
