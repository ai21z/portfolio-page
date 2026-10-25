// The five profile links as glass sigils round the portrait. They are centred on the nose tip, the top one
// straight above it, the sides level with the eyes and the bottom two a little lower and wider. When a
// click on the portrait draws the AZ sigil in particles, each one travels round and in onto a corner of the
// sigil, and back out when the sigil is released. At rest a spore draws a pentacle through them, again
// and again (see Spore below). Desktop only: phones and tablets keep the row of glass above the name, and
// without this script the links stand in a column at the left edge.
import { compactMediaQuery } from './compact.js';
import { reducedMotion } from './motion.js';

// The nose tip in the portrait image, as a share of its width and height.
const NOSE = [0.475, 0.504];
// Rest places clockwise from the top, in DOM and tab order (GitHub, LinkedIn, Email, CV, GitLab):
// [angle in degrees, distance from the nose as a share of the photo's radius].
const REST = [[-90, 1], [-18, 1], [53, 1.1], [127, 1.1], [198, 1]];
// The AZ sigil's corners in its 192 px image, which the particles stretch over the portrait: apex,
// crossbar right, right foot, left foot, crossbar left.
const SIGIL_SIZE = 192;
const CORNERS = [[96, 37], [143, 66], [141, 137], [51, 136], [49, 66]];
const GLASS = 44;
const NAME_GAP = 14;
const TRAVEL_MS = 900;
const STAGGER_MS = 70;
const SWING = 0.55;

// The spore's pentacle. From its start link it draws the star, to the link two along and on round in
// steps of two, back to the start. Then it runs a lap of the halo and on to the next link, rests there,
// and draws the next star from it. Each link lights as the spore reaches it.
const STAR = [0, 2, 4, 1, 3, 0];
const SPORE_SPEED = 1.7;       // photo radii a second
const SPORE_REST_MS = 1200;
const SPORE_START_MS = 2000;   // after load, so it never meets the first paint
const SPORE_TAIL = 9;
const LIT_FADE = 1.4;          // of the glow a second

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeInOut = (t) => 0.5 - Math.cos(Math.PI * t) / 2;
const TAU = 2 * Math.PI;

// Layout position, which ignores transforms, so the portrait's entrance scale cannot move the halo.
function pagePosition(el) {
  let x = 0;
  let y = 0;
  for (let node = el; node; node = node.offsetParent) {
    x += node.offsetLeft;
    y += node.offsetTop;
  }
  return [x, y];
}

class ProfileHalo {
  constructor() {
    this.links = [];
    this.places = [];
    this.progress = 0;
    this.target = 0;
    this.frame = 0;
    this.spore = { start: 0, leg: 0, legStart: 0, frame: 0, ready: false, last: 0, trail: [], lit: [0, 0, 0, 0, 0] };
  }

  init() {
    if (this.rail) return;
    this.rail = document.querySelector('.living-sigils');
    this.portrait = document.querySelector('.portrait');
    this.name = document.querySelector('.name');
    this.landing = document.getElementById('main');
    if (!this.rail || !this.portrait || !this.name) return;
    this.links = [...this.rail.querySelectorAll('.sigil-vial')];
    if (this.links.length !== REST.length) return;

    const relayout = () => this.layout();
    compactMediaQuery().addEventListener('change', () => this.sync());
    window.addEventListener('resize', relayout);
    document.fonts?.ready.then(relayout);
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(relayout);
      observer.observe(this.portrait);
      observer.observe(this.name);
    }
    document.addEventListener('portrait:constellation', (event) => this.travel(event.detail?.active ? 1 : 0));

    const wake = () => this.sporeSync();
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('graphics:profile-change', wake);
    window.addEventListener('motion:preference', wake);
    if (this.landing) new MutationObserver(wake).observe(this.landing, { attributes: true, attributeFilter: ['class'] });
    const begin = () => setTimeout(() => { this.spore.ready = true; wake(); }, SPORE_START_MS);
    if (document.readyState === 'complete') begin();
    else window.addEventListener('load', () => { relayout(); begin(); }, { once: true });

    this.sync();
  }

  sync() {
    const on = !compactMediaQuery().matches;
    this.rail.toggleAttribute('data-halo', on);
    if (on) {
      this.layout();
    } else {
      cancelAnimationFrame(this.frame);
      this.progress = this.target = 0;
      for (const link of this.links) {
        for (const prop of ['--halo-x', '--halo-y', '--land', '--lit']) link.style.removeProperty(prop);
        link.removeAttribute('data-on-corner');
      }
    }
    this.sporeSync();
  }

  layout() {
    if (!this.rail.hasAttribute('data-halo')) return;
    const width = this.portrait.offsetWidth;
    const height = this.portrait.offsetHeight;
    if (!width || !height) return;
    const [railX, railY] = pagePosition(this.rail);
    const [left, top] = pagePosition(this.portrait);
    const [, nameTop] = pagePosition(this.name);
    const radius = Math.min(width, height) / 2;
    const cx = left + width * NOSE[0];
    const cy = top + height * NOSE[1];
    this.radius = radius;
    // The name's letters end about 72% down its line box. The top link keeps clear of them.
    const topRoom = cy - (nameTop + this.name.offsetHeight * 0.72) - GLASS / 2 - NAME_GAP;
    this.places = REST.map(([degrees, share], i) => {
      const restAngle = degrees * Math.PI / 180;
      const rest = i === 0 ? Math.min(radius * share, topRoom) : radius * share;
      const px = left + (CORNERS[i][0] / SIGIL_SIZE) * width;
      const py = top + (CORNERS[i][1] / SIGIL_SIZE) * height;
      let cornerAngle = Math.atan2(py - cy, px - cx);
      while (cornerAngle - restAngle > Math.PI) cornerAngle -= TAU;
      while (cornerAngle - restAngle < -Math.PI) cornerAngle += TAU;
      return {
        cx: cx - railX,
        cy: cy - railY,
        restAngle,
        rest,
        cornerAngle,
        corner: Math.hypot(px - cx, py - cy)
      };
    });
    this.place(this.progress);
  }

  // progress 0 is the halo, 1 every link on its corner. The links leave one after another.
  place(progress) {
    const span = TRAVEL_MS + STAGGER_MS * (this.links.length - 1);
    this.links.forEach((link, i) => {
      const p = this.places[i];
      if (!p) return;
      const local = Math.min(1, Math.max(0, (progress * span - i * STAGGER_MS) / TRAVEL_MS));
      const t = ease(local);
      // Round and in at once, with a swing out and back, so each one loops onto its corner.
      const angle = p.restAngle + (p.cornerAngle - p.restAngle) * t + Math.sin(Math.PI * t) * SWING;
      const distance = p.rest + (p.corner - p.rest) * t;
      link.style.setProperty('--halo-x', `${(p.cx + Math.cos(angle) * distance).toFixed(1)}px`);
      link.style.setProperty('--halo-y', `${(p.cy + Math.sin(angle) * distance).toFixed(1)}px`);
      // A glow that peaks as the link lands on its corner.
      const land = local >= 1 ? (this.target === 1 ? 1 : 0) : Math.max(0, 1 - (1 - local) * 8);
      link.style.setProperty('--land', land.toFixed(3));
      link.toggleAttribute('data-on-corner', local >= 1 && this.target === 1);
    });
  }

  travel(target) {
    this.target = target;
    cancelAnimationFrame(this.frame);
    this.sporeSync();
    if (!this.rail?.hasAttribute('data-halo') || reducedMotion) {
      this.progress = target;
      if (this.rail?.hasAttribute('data-halo')) this.place(target);
      this.sporeSync();
      return;
    }
    const from = this.progress;
    const span = TRAVEL_MS + STAGGER_MS * (this.links.length - 1);
    const duration = span * Math.abs(target - from);
    const start = performance.now();
    const step = (now) => {
      const k = duration ? Math.min(1, (now - start) / duration) : 1;
      this.progress = from + (target - from) * k;
      this.place(this.progress);
      if (k < 1) this.frame = requestAnimationFrame(step);
      else this.sporeSync();
    };
    this.frame = requestAnimationFrame(step);
  }

  // === Spore ===

  sporeShouldRun() {
    return this.spore.ready && this.rail.hasAttribute('data-halo') && this.places.length > 0 &&
      this.progress === 0 && this.target === 0 && !reducedMotion && !document.hidden &&
      (!this.landing || this.landing.classList.contains('active-section')) &&
      document.documentElement.dataset.graphicsEffectiveProfile !== 'quiet';
  }

  sporeSync() {
    const s = this.spore;
    if (!this.rail) return;
    if (this.sporeShouldRun()) {
      if (s.frame) return;
      if (!s.dots) {
        s.dots = Array.from({ length: SPORE_TAIL }, (_, i) => {
          const dot = document.createElement('span');
          dot.className = 'halo-spore';
          dot.setAttribute('aria-hidden', 'true');
          dot.style.setProperty('--spore-size', `${(6 - i * 0.5).toFixed(1)}px`);
          dot.style.setProperty('--spore-alpha', (0.95 - i * 0.1).toFixed(2));
          this.rail.append(dot);
          return dot;
        });
      }
      // A stopped pentacle starts again from the beginning of its star.
      s.leg = 0;
      s.legStart = performance.now();
      s.last = s.legStart;
      s.trail = [];
      const tick = (now) => {
        s.frame = requestAnimationFrame(tick);
        this.sporeFrame(now);
      };
      s.frame = requestAnimationFrame(tick);
      return;
    }
    if (s.frame) cancelAnimationFrame(s.frame);
    s.frame = 0;
    for (const dot of s.dots || []) dot.style.opacity = '0';
    s.lit.fill(0);
    for (const link of this.links) link.style.removeProperty('--lit');
    this.rail.removeAttribute('data-spore-at');
  }

  restPoint(i) {
    const p = this.places[i];
    return [p.cx + Math.cos(p.restAngle) * p.rest, p.cy + Math.sin(p.restAngle) * p.rest];
  }

  // The halo's own curve: the distance from the nose eases between the links' distances, so the lap
  // passes through every one.
  lapPoint(angle) {
    const n = this.places.length;
    const base = this.places[0].restAngle;
    let a = (angle - base) % TAU;
    if (a < 0) a += TAU;
    let i = n - 1;
    for (let k = 0; k < n; k++) {
      const start = this.places[k].restAngle - base;
      const end = k + 1 < n ? this.places[k + 1].restAngle - base : TAU;
      if (a >= start && a < end) { i = k; break; }
    }
    const from = this.places[i];
    const to = this.places[(i + 1) % n];
    const start = from.restAngle - base;
    const end = i + 1 < n ? to.restAngle - base : TAU;
    const t = easeInOut((a - start) / (end - start));
    const distance = from.rest + (to.rest - from.rest) * t;
    return [from.cx + Math.cos(angle) * distance, from.cy + Math.sin(angle) * distance];
  }

  // Legs of the current pentacle: five chords of the star, then the lap, then the rest.
  legs() {
    const s = this.spore;
    const n = this.places.length;
    const speed = SPORE_SPEED * this.radius / 1000;
    const out = [];
    for (let j = 0; j < STAR.length - 1; j++) {
      const a = (s.start + STAR[j]) % n;
      const b = (s.start + STAR[j + 1]) % n;
      const [ax, ay] = this.restPoint(a);
      const [bx, by] = this.restPoint(b);
      out.push({ kind: 'chord', a, b, ms: Math.hypot(bx - ax, by - ay) / speed });
    }
    const next = (s.start + 1) % n;
    const from = this.places[s.start].restAngle;
    let to = this.places[next].restAngle;
    while (to <= from) to += TAU;
    const sweep = TAU + (to - from);
    out.push({ kind: 'lap', b: next, from, sweep, ms: (sweep * this.radius * 1.04) / speed });
    out.push({ kind: 'rest', b: next, ms: SPORE_REST_MS });
    return out;
  }

  sporeFrame(now) {
    const s = this.spore;
    const dt = Math.min(0.1, (now - s.last) / 1000);
    s.last = now;
    const legs = this.legs();
    let leg = legs[s.leg];
    while (leg && now - s.legStart >= leg.ms) {
      if (leg.kind !== 'rest') this.arrive(leg.b);
      s.legStart += leg.ms;
      s.leg += 1;
      if (s.leg >= legs.length) {
        s.start = (s.start + 1) % this.places.length;
        s.leg = 0;
        return;
      }
      leg = legs[s.leg];
    }
    const t = easeInOut(Math.min(1, (now - s.legStart) / leg.ms));
    let point;
    if (leg.kind === 'chord') {
      const [ax, ay] = this.restPoint(leg.a);
      const [bx, by] = this.restPoint(leg.b);
      point = [ax + (bx - ax) * t, ay + (by - ay) * t];
    } else if (leg.kind === 'lap') {
      point = this.lapPoint(leg.from + leg.sweep * t);
    } else {
      point = this.restPoint(leg.b);
    }
    s.trail.unshift(point);
    if (s.trail.length > SPORE_TAIL * 2) s.trail.length = SPORE_TAIL * 2;
    s.dots.forEach((dot, i) => {
      const at = s.trail[Math.min(s.trail.length - 1, i * 2)];
      dot.style.transform = `translate(${at[0].toFixed(1)}px, ${at[1].toFixed(1)}px)`;
      dot.style.opacity = leg.kind === 'rest' && i > 0 ? '0' : '1';
    });
    s.lit.forEach((value, i) => {
      if (value <= 0) return;
      s.lit[i] = Math.max(0, value - dt * LIT_FADE);
      this.links[i].style.setProperty('--lit', s.lit[i].toFixed(3));
    });
  }

  arrive(i) {
    this.spore.lit[i] = 1;
    this.links[i].style.setProperty('--lit', '1');
    this.rail.dataset.sporeAt = String(i);
  }
}

const profileHalo = new ProfileHalo();
export default profileHalo;
