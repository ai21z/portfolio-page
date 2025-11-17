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
  
  if (!mycoRail || !mycoStrip || !socialIcons.length) {
    console.warn('[Hub-to-Icons] Missing required elements');
    return;
  }

  console.log(`[Hub-to-Icons] Found ${socialIcons.length} social icons`);

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
  const glowIcon = (icon) => {
    console.log('[Hub-to-Icons] Glowing icon:', icon);
    icon.classList.add('spore-hit');
    setTimeout(() => {
      icon.classList.remove('spore-hit');
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
    
    // Calculate distance and duration (3x slower = multiply by 3)
    const dx = targetX - startX;
    const dy = targetY - startY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const baseDuration = Math.max(0.4, Math.min(1.2, distance / 500));
    const duration = baseDuration * 3; // 3x slower
    
    console.log(`[Hub-to-Icons] Distance: ${distance}px, Duration: ${duration}s (3x slower)`);
    
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
    
    // On arrival, glow the icon and remove spore
    setTimeout(() => {
      console.log(`[Hub-to-Icons] Spore arrived, glowing icon`);
      if (targetIcon) {
        glowIcon(targetIcon);
      }
      spore.remove();
    }, duration * 1000);
  };

  // Burst: shoot multiple spores from hub to each icon
  const burstToIcons = () => {
    const hub = hubs[currentHubIndex];
    const hubPage = svgToPage(hub.x, hub.y);
    
    console.log(`[Hub-to-Icons] Burst from ${hub.side} hub at page coords:`, hubPage);
    console.log(`[Hub-to-Icons] Window size: ${window.innerWidth}x${window.innerHeight}`);
    
    // Send 2 spores to each icon with staggered timing
    socialIcons.forEach((icon, index) => {
      const iconCenter = getIconCenter(icon);
      console.log(`[Hub-to-Icons] Icon ${index} center:`, iconCenter);
      const sporeCount = 2; // Always send 2 for testing
      
      for (let i = 0; i < sporeCount; i++) {
        setTimeout(() => {
          console.log(`[Hub-to-Icons] Creating spore ${i} for icon ${index}`);
          createSpore(hubPage.x, hubPage.y, iconCenter.x, iconCenter.y, icon);
        }, index * 80 + i * 40); // Stagger per icon + per spore
      }
    });
    
    // Alternate hubs randomly
    currentHubIndex = Math.floor(Math.random() * hubs.length);
  };

  // TEST: Immediate burst to verify it's working
  console.log('[Hub-to-Icons] Triggering TEST burst immediately...');
  setTimeout(() => {
    console.log('[Hub-to-Icons] TEST burst firing NOW');
    burstToIcons();
  }, 500);
  
  // Start bursting every 3 seconds
  const burstInterval = setInterval(() => {
    console.log('[Hub-to-Icons] Interval burst firing');
    burstToIcons();
  }, 3000);
  
  // Second burst after 2 seconds
  setTimeout(() => {
    console.log('[Hub-to-Icons] Second burst firing');
    burstToIcons();
  }, 2000);

  // Cleanup on resize
  const handleResize = () => {
    if (window.innerWidth > 900) {
      clearInterval(burstInterval);
    }
  };
  
  window.addEventListener('resize', handleResize);
  
  console.log('[Hub-to-Icons] Initialization complete!');
}
