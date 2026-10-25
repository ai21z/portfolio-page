// The five profile links as glass sigils round the portrait. They are centred on the nose tip, the top one
// straight above it, the sides level with the eyes and the bottom two a little lower and wider. When a
// click on the portrait draws the AZ sigil in particles, each one travels round and in onto a corner of the
// sigil, and back out when the sigil is released. Desktop only: phones and tablets keep the row of glass
// above the name, and without this script the links stand in a column at the left edge.
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

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

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
  }

  init() {
    if (this.rail) return;
    this.rail = document.querySelector('.living-sigils');
    this.portrait = document.querySelector('.portrait');
    this.name = document.querySelector('.name');
    if (!this.rail || !this.portrait || !this.name) return;
    this.links = [...this.rail.querySelectorAll('.sigil-vial')];
    if (this.links.length !== REST.length) return;

    const relayout = () => this.layout();
    compactMediaQuery().addEventListener('change', () => this.sync());
    window.addEventListener('resize', relayout);
    window.addEventListener('load', relayout);
    document.fonts?.ready.then(relayout);
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(relayout);
      observer.observe(this.portrait);
      observer.observe(this.name);
    }
    document.addEventListener('portrait:constellation', (event) => this.travel(event.detail?.active ? 1 : 0));
    this.sync();
  }

  sync() {
    const on = !compactMediaQuery().matches;
    this.rail.toggleAttribute('data-halo', on);
    if (on) {
      this.layout();
      return;
    }
    cancelAnimationFrame(this.frame);
    this.progress = this.target = 0;
    for (const link of this.links) {
      link.style.removeProperty('--halo-x');
      link.style.removeProperty('--halo-y');
      link.style.removeProperty('--land');
      link.removeAttribute('data-on-corner');
    }
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
    // The name's letters end about 72% down its line box. The top link keeps clear of them.
    const topRoom = cy - (nameTop + this.name.offsetHeight * 0.72) - GLASS / 2 - NAME_GAP;
    this.places = REST.map(([degrees, share], i) => {
      const restAngle = degrees * Math.PI / 180;
      const rest = i === 0 ? Math.min(radius * share, topRoom) : radius * share;
      const px = left + (CORNERS[i][0] / SIGIL_SIZE) * width;
      const py = top + (CORNERS[i][1] / SIGIL_SIZE) * height;
      let cornerAngle = Math.atan2(py - cy, px - cx);
      while (cornerAngle - restAngle > Math.PI) cornerAngle -= 2 * Math.PI;
      while (cornerAngle - restAngle < -Math.PI) cornerAngle += 2 * Math.PI;
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
    if (!this.rail?.hasAttribute('data-halo') || reducedMotion) {
      this.progress = target;
      if (this.rail?.hasAttribute('data-halo')) this.place(target);
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
    };
    this.frame = requestAnimationFrame(step);
  }
}

const profileHalo = new ProfileHalo();
export default profileHalo;
