import { expect, test, type Page, type TestInfo } from '@playwright/test';
import sharp from 'sharp';

// axe reports text over gradient or image backgrounds as "incomplete", so the paper cards
// (kraft gradient, coffee stains, multiplied grime) never fail accessibility.spec.ts. This
// check measures the rendered paper instead: it hides all text, screenshots the page, and
// compares each line of text against the darkest paper actually under that line.

type Run = {
  label: string;
  rects: { x: number; y: number; w: number; h: number }[];
  color: [number, number, number, number];
  large: boolean;
  // Set when another element sits on top of this text, so its paper cannot be measured.
  coveredBy?: string;
};

// The darkest 5% of the paper under a line counts as its background: stains and the ruled
// line count, while isolated grime specks (a few pixels each) do not.
const BACKGROUND_PERCENTILE = 0.05;
// Near-black pixels are the page or a spiral hole showing through a rotated box, not paper.
const NOT_PAPER_LUMINANCE = 0.01;

const SURFACES = [
  { section: 'about', container: '#about .slab.paper' },
  { section: 'skills', container: '#skills .slab.paper' },
  { section: 'contact', container: '#contact .notebook-page' }
];

function channel(value: number) {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(r: number, g: number, b: number) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: number, b: number) {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function collectRuns(page: Page, container: string, index: number): Promise<Run[]> {
  return page.locator(container).nth(index).evaluate(root => {
    const parse = (value: string): [number, number, number, number] => {
      const m = value.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
      return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : [0, 0, 0, 1];
    };
    const effectiveOpacity = (el: Element | null) => {
      let opacity = 1;
      for (let node = el; node; node = node.parentElement) opacity *= +getComputedStyle(node).opacity;
      return opacity;
    };
    const visible = (el: Element) => {
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && !el.closest('[aria-hidden="true"]');
    };
    const inView = (r: DOMRect) => r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    // Returns the covering element's name, or '' when the text itself is on top.
    const coverOf = (rect: DOMRect) => {
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      if (hit && root.contains(hit)) return '';
      return hit ? `${hit.tagName.toLowerCase()}#${hit.id}.${String(hit.className).trim().split(/\s+/).join('.')}` : 'nothing';
    };
    const isLarge = (style: CSSStyleDeclaration) => {
      const size = parseFloat(style.fontSize);
      return size >= 24 || (size >= 18.66 && parseInt(style.fontWeight, 10) >= 700);
    };
    const runs: Run[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || !node.textContent?.trim() || !visible(parent)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter(r => r.width > 2 && r.height > 2 && inView(r));
      if (!rects.length) continue;
      const style = getComputedStyle(parent);
      const color = parse(style.color);
      color[3] *= effectiveOpacity(parent);
      runs.push({
        label: `${parent.tagName.toLowerCase()}${parent.className ? '.' + String(parent.className).trim().split(/\s+/).join('.') : ''} "${node.textContent.trim().slice(0, 40)}"`,
        rects: rects.map(r => ({ x: r.x, y: r.y, w: r.width, h: r.height })),
        color,
        large: isLarge(style),
        coveredBy: rects.map(coverOf).find(Boolean)
      });
    }
    for (const field of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[placeholder], textarea[placeholder]')) {
      if (field.value || !visible(field)) continue;
      const box = field.getBoundingClientRect();
      const style = getComputedStyle(field);
      const pad = parseFloat(style.paddingTop) || 0;
      const line = Math.min(box.height - 2 * pad, parseFloat(style.lineHeight) || box.height);
      const rect = new DOMRect(box.x, box.y + pad, Math.min(box.width, 360), line);
      if (!inView(rect)) continue;
      const placeholder = getComputedStyle(field, '::placeholder');
      const color = parse(placeholder.color);
      color[3] *= (+placeholder.opacity || 1) * effectiveOpacity(field);
      runs.push({
        label: `placeholder "${field.placeholder.slice(0, 40)}"`,
        rects: [{ x: rect.x, y: rect.y, w: rect.width, h: rect.height }],
        color,
        large: isLarge(style),
        coveredBy: coverOf(rect) || undefined
      });
    }
    return runs;
  });
}

async function measure(page: Page, runs: Run[]) {
  // Borders go too: a tag's pencil outline sits beside its text, but the box around a slightly
  // rotated line clips it, and those dark pixels would count as paper.
  const hide = await page.addStyleTag({
    content: `*, *::before, *::after, ::placeholder {
      color: transparent !important; -webkit-text-fill-color: transparent !important;
      text-shadow: none !important; caret-color: transparent !important;
      border-color: transparent !important; outline-color: transparent !important; }`
  });
  const png = await page.screenshot({ animations: 'disabled' });
  await hide.evaluate(el => el.remove());
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const results: { label: string; ratio?: number; required?: number; background?: string; coveredBy?: string }[] = [];
  for (const run of runs) {
    if (run.coveredBy) {
      results.push({ label: run.label, coveredBy: run.coveredBy });
      continue;
    }
    const samples: { l: number; rgb: [number, number, number] }[] = [];
    for (const rect of run.rects) {
      const x0 = Math.max(0, Math.ceil(rect.x)), x1 = Math.min(info.width, Math.floor(rect.x + rect.w));
      const y0 = Math.max(0, Math.ceil(rect.y)), y1 = Math.min(info.height, Math.floor(rect.y + rect.h));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * info.width + x) * info.channels;
          const rgb: [number, number, number] = [data[i], data[i + 1], data[i + 2]];
          const l = luminance(...rgb);
          if (l >= NOT_PAPER_LUMINANCE) samples.push({ l, rgb });
        }
      }
    }
    if (samples.length < 20) continue;
    samples.sort((a, b) => a.l - b.l);
    const background = samples[Math.floor(samples.length * BACKGROUND_PERCENTILE)].rgb;
    const [r, g, b, a] = run.color;
    const ink = [r * a + background[0] * (1 - a), g * a + background[1] * (1 - a), b * a + background[2] * (1 - a)] as const;
    const ratio = contrast(luminance(...ink), luminance(...background));
    const required = run.large ? 3 : 4.5;
    results.push({ label: run.label, ratio: Math.round(ratio * 100) / 100, required, background: `rgb(${background.join(',')})` });
  }
  return results;
}

async function measureSurface(page: Page, testInfo: TestInfo, container: string) {
  const all = [];
  const count = await page.locator(container).count();
  for (let index = 0; index < count; index++) {
    const surface = page.locator(container).nth(index);
    await surface.scrollIntoViewIfNeeded();
    // Compact layouts blur every card except the one in front; wait for this one to come forward.
    await expect.poll(() => surface.evaluate(el => !el.closest('.has-front') || el.classList.contains('is-front'))).toBe(true);
    await page.mouse.move(0, 0);
    // Cards fly in when a section opens; measure once every finite animation has finished.
    await page.waitForFunction(() => document.getAnimations().every(a =>
      a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity));
    await page.waitForTimeout(250);
    all.push(...await measure(page, await collectRuns(page, container, index)));
  }
  await testInfo.attach('paper-contrast.json', { body: JSON.stringify(all, null, 2), contentType: 'application/json' });
  return all;
}

for (const width of [390, 1366]) {
  for (const { section, container } of SURFACES) {
    test(`text on paper in ${section} meets WCAG AA contrast at ${width}px`, async ({ page, browserName }, testInfo) => {
      test.skip(browserName !== 'chromium', 'Gradient rendering is shared; one engine is enough.');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width, height: 844 });
      // Stay offline and deterministic: with Turnstile unreachable the form shows its error
      // status, so the error ink is measured too.
      await page.route('https://challenges.cloudflare.com/**', route => route.abort());
      await page.goto('/index.html#' + section);
      await expect(page.locator('html')).toHaveClass(/js-ready/);
      await expect(page.locator('#' + section)).toHaveClass(/active-section/);
      const results = await measureSurface(page, testInfo, container);
      expect(results.length).toBeGreaterThan(0);
      expect(results.filter(r => r.coveredBy), 'text hidden under another element').toEqual([]);
      expect(results.filter(r => r.ratio! < r.required!)).toEqual([]);
    });
  }
}
