// The five profile links, glass sigils in a column at the left edge. When a click on the portrait draws the
// AZ sigil in particles, each one leaves the column and travels round and in onto a corner of the sigil,
// and back into the column when the sigil is released. Desktop only: phones and tablets keep the row of
// glass above the name.
import { compactMediaQuery } from './compact.js';
import { reducedMotion } from './motion.js';

// The paths turn round the nose tip, a share of the portrait image's width and height.
const NOSE = [0.475, 0.504];
// The AZ sigil's corners in its 192 px image, which the particles stretch over the portrait, in the
// links' order (GitHub, LinkedIn, Email, CV, GitLab): apex, crossbar right, right foot, left foot,
// crossbar left, so the five go round the sigil clockwise from the top.
const SIGIL_SIZE = 192;
const CORNERS = [[96, 37], [143, 66], [141, 137], [51, 136], [49, 66]];
const TRAVEL_MS = 900;
const STAGGER_MS = 70;
const SWING = 0.55;

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Layout position, which ignores transforms, so the portrait's entrance scale cannot move the paths.
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
    if (!this.rail || !this.portrait) return;
    this.links = [...this.rail.querySelectorAll('.sigil-vial')];
    if (this.links.length !== CORNERS.length) return;

    compactMediaQuery().addEventListener('change', () => this.sync());
    window.addEventListener('resize', () => this.layout());
    document.addEventListener('portrait:constellation', (event) => this.travel(event.detail?.active ? 1 : 0));
    this.sync();
  }

  // data-halo marks the desktop column, which can travel. data-travel frees the links from the column
  // while they are on their way or on the sigil.
  sync() {
    const on = !compactMediaQuery().matches;
    this.rail.toggleAttribute('data-halo', on);
    if (!on) {
      cancelAnimationFrame(this.frame);
      this.progress = this.target = 0;
      this.settle();
    } else if (this.progress > 0) {
      this.layout();
    }
  }

  // Back in the column: the links return to its flow, exactly where they stood.
  settle() {
    this.rail.removeAttribute('data-travel');
    for (const link of this.links) {
      for (const prop of ['--halo-x', '--halo-y', '--land']) link.style.removeProperty(prop);
      link.removeAttribute('data-on-corner');
    }
  }

  // Where each link stands in the column and where its corner is, measured with the links in the column.
  // At rest there is nothing to do: the column lays itself out.
  layout() {
    if (!this.rail.hasAttribute('data-halo') || (this.progress === 0 && this.target === 0)) return;
    const width = this.portrait.offsetWidth;
    const height = this.portrait.offsetHeight;
    if (!width || !height) return;
    this.rail.removeAttribute('data-travel');
    const columns = this.links.map((link) => {
      const [x, y] = pagePosition(link);
      return [x + link.offsetWidth / 2, y + link.offsetHeight / 2];
    });
    this.rail.setAttribute('data-travel', '');
    const [railX, railY] = pagePosition(this.rail);
    const [left, top] = pagePosition(this.portrait);
    const cx = left + width * NOSE[0];
    const cy = top + height * NOSE[1];
    this.places = columns.map(([x, y], i) => {
      const restAngle = Math.atan2(y - cy, x - cx);
      const px = left + (CORNERS[i][0] / SIGIL_SIZE) * width;
      const py = top + (CORNERS[i][1] / SIGIL_SIZE) * height;
      let cornerAngle = Math.atan2(py - cy, px - cx);
      while (cornerAngle - restAngle > Math.PI) cornerAngle -= 2 * Math.PI;
      while (cornerAngle - restAngle < -Math.PI) cornerAngle += 2 * Math.PI;
      return {
        cx: cx - railX,
        cy: cy - railY,
        restAngle,
        rest: Math.hypot(x - cx, y - cy),
        cornerAngle,
        corner: Math.hypot(px - cx, py - cy)
      };
    });
    this.place(this.progress);
  }

  // progress 0 is the column, 1 every link on its corner. The links leave one after another.
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
    // No column to leave where the layout hides it (small, short windows) or off the desktop.
    const hidden = !this.rail?.hasAttribute('data-travel') && !this.rail?.offsetParent;
    if (!this.rail?.hasAttribute('data-halo') || hidden) {
      this.progress = target;
      return;
    }
    if (this.progress === 0) this.layout();
    const finish = () => {
      this.progress = target;
      if (target === 0) this.settle();
      else this.place(1);
    };
    if (reducedMotion) {
      finish();
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
      else finish();
    };
    this.frame = requestAnimationFrame(step);
  }
}

const profileHalo = new ProfileHalo();
export default profileHalo;
