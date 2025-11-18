// Hub-to-Icons spore burst system
// Shoots spores from hubs to social icons, making them glow on impact

export function initHubToIcons() {
  console.log('[Hub-to-Icons] Initializing...');
  
  // TEMPORARY: Disabled mobile check for testing
  // if (window.innerWidth > 900) {
  //   console.log('[Hub-to-Icons] Desktop mode - skipping');
  //   return;
  // }

  const mycoRail = document.querySelector('.myco-rail');
  const mycoStrip = document.querySelector('.myco-strip');
  const socialIcons = document.querySelectorAll('.living-sigils .sigil-vial');
  const hubElements = document.querySelectorAll('.spore-hub');
  
  if (!mycoRail || !mycoStrip || !socialIcons.length || !hubElements.length) {
    console.warn('[Hub-to-Icons] Missing required elements');
    return;
  }

  console.log(`[Hub-to-Icons] Found ${socialIcons.length} social icons and ${hubElements.length} hubs`);

  // Hub positions in SVG viewBox coordinates (400x80)
  const hubs = [
    { x: 20, y: 40, side: 'left' },
    { x: 380, y: 40, side: 'right' }
  ];

  let currentHubIndex = Math.floor(Math.random() * hubs.length);

  // Convert SVG coordinates to page coordinates
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

  // Get center of an icon element
  const getIconCenter = (icon) => {
    const rect = icon.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  };

  // Make an icon glow when hit by spore
  const glowIcon = (icon, sporeColor) => {
    console.log('[Hub-to-Icons] Glowing icon with color:', sporeColor);
    icon.classList.add('spore-hit');
    
    // Set the glow color as a CSS custom property
    icon.style.setProperty('--spore-glow-color', sporeColor);
    
    setTimeout(() => {
      icon.classList.remove('spore-hit');
      icon.style.removeProperty('--spore-glow-color');
      console.log('[Hub-to-Icons] Glow removed from icon');
    }, 1200); // Match animation duration
  };

  // Create a single spore that travels from hub to icon
  const createSpore = (startX, startY, targetX, targetY, targetIcon) => {
    console.log(`[Hub-to-Icons] createSpore called: start(${startX},${startY}) → target(${targetX},${targetY})`);
    
    const spore = document.createElement('div');
    spore.className = 'hub-spore';
    spore.style.left = `${startX}px`;
    spore.style.top = `${startY}px`;
    
    // Random color
    const colors = [
      'rgba(63,255,159,0.9)',
      'rgba(143,180,255,0.85)'
    ];
    const color = colors[Math.floor(Math.random() * colors.length)];
    spore.style.setProperty('--spore-color', color);
    
    console.log(`[Hub-to-Icons] Spore created with color: ${color}`);
    document.body.appendChild(spore);
    console.log(`[Hub-to-Icons] Spore appended to body`);
    
    // Calculate distance and duration (12x slower = multiply by 12 for half speed)
    const dx = targetX - startX;
    const dy = targetY - startY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const baseDuration = Math.max(0.4, Math.min(1.2, distance / 500));
    const duration = baseDuration * 12; // 12x slower (half of previous 6x speed)
    
    console.log(`[Hub-to-Icons] Distance: ${distance}px, Duration: ${duration}s (12x slower)`);
    
    // Animate using CSS custom properties
    spore.style.setProperty('--target-x', `${targetX}px`);
    spore.style.setProperty('--target-y', `${targetY}px`);
    spore.style.setProperty('--duration', `${duration}s`);
    spore.style.setProperty('--start-x', `${startX}px`);
    spore.style.setProperty('--start-y', `${startY}px`);
    
    // Trigger animation
    requestAnimationFrame(() => {
      console.log(`[Hub-to-Icons] Adding flying class to spore`);
      spore.classList.add('flying');
    });
    
    // On arrival, glow the icon with the spore's color
    setTimeout(() => {
      console.log(`[Hub-to-Icons] Spore arrived, glowing icon with color: ${color}`);
      if (targetIcon) {
        glowIcon(targetIcon, color);
      }
      spore.remove();
    }, duration * 1000);
  };

  // Burst: shoot spores from hub during its light fade period
  const burstFromHub = (hubIndex) => {
    const hub = hubs[hubIndex];
    const hubPage = svgToPage(hub.x, hub.y);
    
    console.log(`[Hub-to-Icons] Burst from ${hub.side} hub - light taking off`);
    
    // Stagger spore launches across icons during the fade window (50-65% = 675ms)
    socialIcons.forEach((icon, index) => {
      const iconCenter = getIconCenter(icon);
      const sporeCount = 2;
      
      for (let i = 0; i < sporeCount; i++) {
        // Spread launches throughout the fade: index * 80ms + spore offset * 40ms
        setTimeout(() => {
          createSpore(hubPage.x, hubPage.y, iconCenter.x, iconCenter.y, icon);
        }, index * 80 + i * 40);
      }
    });
  };

  // Cooldown system: After both hubs fire, wait 10-12s before next cycle
  const COOLDOWN_MIN = 10000; // 10 seconds
  const COOLDOWN_MAX = 12000; // 12 seconds
  const CYCLE_DURATION = 9000; // Each hub cycle is 9s
  const HUB_OFFSET = 4500; // Hubs fire 4.5s apart
  const BURST_TIMING = 4320; // 48% of 9s cycle
  
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
      console.log(`[Hub-to-Icons] ${hubs[hubIndex].side.toUpperCase()} hub releasing energy`);
      burstFromHub(hubIndex);
    }, delay);
  };
  
  const runCycle = () => {
    cycleCount++;
    console.log(`[Hub-to-Icons] Starting cycle ${cycleCount}`);
    
    // Resume animations for this cycle
    resumeHubAnimations();
    
    // Left hub fires first at 48% keyframe
    scheduleBurst(0, BURST_TIMING);
    
    // Right hub fires 4.5s later at 48% keyframe
    scheduleBurst(1, BURST_TIMING + HUB_OFFSET);
    
    // After both hubs complete cycle (9s total), pause animations during cooldown
    setTimeout(() => {
      pauseHubAnimations();
      
      const cooldown = COOLDOWN_MIN + Math.random() * (COOLDOWN_MAX - COOLDOWN_MIN);
      console.log(`[Hub-to-Icons] Cooldown: ${(cooldown/1000).toFixed(1)}s`);
      
      setTimeout(() => {
        runCycle();
      }, cooldown);
    }, CYCLE_DURATION);
  };
  
  // Start first cycle
  runCycle();

  // Cleanup on resize (note: intervals are not captured, but effect will reset on reload)
  const handleResize = () => {
    if (window.innerWidth > 900) {
      // Intervals will be cleared on page navigation/reload
      console.log('[Hub-to-Icons] Desktop detected - system should be inactive');
    }
  };
  
  window.addEventListener('resize', handleResize);
  
  console.log('[Hub-to-Icons] Initialization complete!');
}
