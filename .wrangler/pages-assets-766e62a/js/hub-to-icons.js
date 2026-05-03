// Spore burst from hubs to social icons

export function initHubToIcons() {
  const mycoRail = document.querySelector('.myco-rail');
  const mycoStrip = document.querySelector('.myco-strip');
  const socialIcons = document.querySelectorAll('.living-sigils .sigil-vial');
  const hubElements = document.querySelectorAll('.spore-hub');
  
  if (!mycoRail || !mycoStrip || !socialIcons.length || !hubElements.length) {
    console.warn('[Hub-to-Icons] Missing required elements');
    return;
  }

  const hubs = [
    { x: 20, y: 40, side: 'left' },
    { x: 380, y: 40, side: 'right' }
  ];

  let currentHubIndex = Math.floor(Math.random() * hubs.length);

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
    
    setTimeout(() => {
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
      spore.classList.add('flying');
    });
    
    setTimeout(() => {
      if (targetIcon) {
        glowIcon(targetIcon, color);
      }
      spore.remove();
    }, duration * 1000);
  };

  const burstFromHub = (hubIndex) => {
    const hub = hubs[hubIndex];
    const hubPage = svgToPage(hub.x, hub.y);
    
    socialIcons.forEach((icon, index) => {
      const iconCenter = getIconCenter(icon);
      const sporeCount = 2;
      
      for (let i = 0; i < sporeCount; i++) {
        setTimeout(() => {
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
  
  let cycleCount = 0;
  
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
    setTimeout(() => {
      burstFromHub(hubIndex);
    }, delay);
  };
  
  const runCycle = () => {
    cycleCount++;
    
    resumeHubAnimations();
    
    scheduleBurst(0, BURST_TIMING);
    
    scheduleBurst(1, BURST_TIMING + HUB_OFFSET);
    
    setTimeout(() => {
      pauseHubAnimations();
      
      const cooldown = COOLDOWN_MIN + Math.random() * (COOLDOWN_MAX - COOLDOWN_MIN);
      
      setTimeout(() => {
        runCycle();
      }, cooldown);
    }, CYCLE_DURATION);
  };
  
  runCycle();

  const handleResize = () => {
    if (window.innerWidth > 900) {
    }
  };
  
  window.addEventListener('resize', handleResize);
}
