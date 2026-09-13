import { getGraphicsBudget } from './graphics-governor.js';
import { compactMediaQuery, isCompact } from './compact.js';

export function initHubToIcons() {
  const mycoRail = document.querySelector('.myco-rail');
  const mycoStrip = document.querySelector('.myco-strip');
  const socialIcons = document.querySelectorAll('.living-sigils .sigil-vial');
  const hubElements = document.querySelectorAll('.spore-hub');
  if (mycoStrip?.__hubToIconsBound) return;
  
  if (!mycoRail || !mycoStrip || !socialIcons.length || !hubElements.length) {
    console.warn('[Hub-to-Icons] Missing required elements');
    return;
  }

  mycoStrip.__hubToIconsBound = true;
  const timers = new Set();
  const particles = new Set();
  let running = false;
  const schedule = (callback, delay) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (running) callback();
    }, delay);
    timers.add(timer);
  };

  const hubs = [
    { x: 20, y: 40, side: 'left' },
    { x: 380, y: 40, side: 'right' }
  ];


  const svgToPage = (svgX, svgY) => {
    const stripRect = mycoStrip.getBoundingClientRect();
    const svgRect = mycoRail.getBoundingClientRect();
    const viewBox = mycoRail.viewBox.baseVal;
    
    const scaleX = svgRect.width / viewBox.width;
    const scaleY = svgRect.height / viewBox.height;
    
    return {
      x: svgRect.left + (svgX * scaleX),
      y: svgRect.top + (svgY * scaleY)
    };
  };

  const getIconCenter = (icon) => {
    const rect = icon.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  };

  const glowIcon = (icon, sporeColor) => {
    icon.classList.add('spore-hit');
    
    icon.style.setProperty('--spore-glow-color', sporeColor);
    
    schedule(() => {
      icon.classList.remove('spore-hit');
      icon.style.removeProperty('--spore-glow-color');
    }, 1200);
  };

  const createSpore = (startX, startY, targetX, targetY, targetIcon) => {
    const spore = document.createElement('div');
    spore.className = 'hub-spore';
    spore.style.left = `${startX}px`;
    spore.style.top = `${startY}px`;
    
    const colors = [
      'rgba(63,255,159,0.9)',
      'rgba(143,180,255,0.85)'
    ];
    const color = colors[Math.floor(Math.random() * colors.length)];
    spore.style.setProperty('--spore-color', color);
    
    document.body.appendChild(spore);
    particles.add(spore);
    
    const dx = targetX - startX;
    const dy = targetY - startY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const baseDuration = Math.max(0.4, Math.min(1.2, distance / 500));
    const duration = baseDuration * 12;
    
    spore.style.setProperty('--target-x', `${targetX}px`);
    spore.style.setProperty('--target-y', `${targetY}px`);
    spore.style.setProperty('--duration', `${duration}s`);
    spore.style.setProperty('--start-x', `${startX}px`);
    spore.style.setProperty('--start-y', `${startY}px`);
    
    requestAnimationFrame(() => {
      if (running && spore.isConnected) spore.classList.add('flying');
    });
    
    schedule(() => {
      if (targetIcon) {
        glowIcon(targetIcon, color);
      }
      spore.remove();
      particles.delete(spore);
    }, duration * 1000);
  };

  const burstFromHub = (hubIndex) => {
    const hub = hubs[hubIndex];
    const hubPage = svgToPage(hub.x, hub.y);
    
    socialIcons.forEach((icon, index) => {
      const iconCenter = getIconCenter(icon);
      const sporeCount = 2;
      
      for (let i = 0; i < sporeCount; i++) {
        schedule(() => {
          createSpore(hubPage.x, hubPage.y, iconCenter.x, iconCenter.y, icon);
        }, index * 80 + i * 40);
      }
    });
  };

  const COOLDOWN_MIN = 10000;
  const COOLDOWN_MAX = 12000;
  const CYCLE_DURATION = 9000;
  const HUB_OFFSET = 4500;
  const BURST_TIMING = 4320;
  
  
  const pauseHubAnimations = () => {
    hubElements.forEach(hub => {
      hub.style.animationPlayState = 'paused';
    });
  };
  
  const resumeHubAnimations = () => {
    hubElements.forEach(hub => {
      hub.style.animationPlayState = 'running';
    });
  };
  
  const scheduleBurst = (hubIndex, delay) => {
    schedule(() => {
      burstFromHub(hubIndex);
    }, delay);
  };
  
  const runCycle = () => {
    
    resumeHubAnimations();
    
    scheduleBurst(0, BURST_TIMING);
    
    scheduleBurst(1, BURST_TIMING + HUB_OFFSET);
    
    schedule(() => {
      pauseHubAnimations();
      
      const cooldown = COOLDOWN_MIN + Math.random() * (COOLDOWN_MAX - COOLDOWN_MIN);
      
      schedule(() => {
        runCycle();
      }, cooldown);
    }, CYCLE_DURATION);
  };
  
  const syncPlayback = () => {
    const active = !document.hidden && !isCompact()
      && !getGraphicsBudget('hub-to-icons').quiet
      && document.querySelector('.stage[data-section="intro"].active-section');
    if (Boolean(active) === running) return;
    running = Boolean(active);
    if (running) {
      runCycle();
      return;
    }
    timers.forEach(clearTimeout);
    timers.clear();
    particles.forEach(particle => particle.remove());
    particles.clear();
    socialIcons.forEach(icon => {
      icon.classList.remove('spore-hit');
      icon.style.removeProperty('--spore-glow-color');
    });
    pauseHubAnimations();
  };

  document.addEventListener('visibilitychange', syncPlayback);
  window.addEventListener('graphics:profile-change', syncPlayback);
  compactMediaQuery().addEventListener('change', syncPlayback);
  const intro = document.querySelector('.stage[data-section="intro"]');
  if (intro) new MutationObserver(syncPlayback).observe(intro, { attributes: true, attributeFilter: ['class'] });
  syncPlayback();
}
