import { expect, test, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fillContact, stubVerification } from './helpers/contact';

async function audit(page: Page, testInfo: TestInfo, state: string) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  await testInfo.attach(state + '.json', { body: JSON.stringify(result.violations, null, 2), contentType: 'application/json' });
  expect(result.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([]);
}

for (const width of [390, 1366]) {
  for (const section of ['main', 'about', 'skills', 'work', 'blog', 'contact']) {
    test(`automated accessibility in ${section} at ${width}px`, async ({ page }, testInfo) => {
      await stubVerification(page);
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/index.html#' + section);
      await expect(page.locator('html')).toHaveClass(/js-ready/);
      await audit(page, testInfo, section);
    });
  }
}

// Every view sits inside the one main landmark and names itself with its own h1. The other views are
// inert, so a screen reader meets exactly one main and one h1, the heading of the view on screen.
test('each view has the main landmark and its own h1', async ({ page, browserName }) => {
  await stubVerification(page);
  const views = [['main', 'Aris Zounarakis'], ['about', 'About'], ['skills', 'Skills'], ['blog', 'Blog'],
    ['work', 'Work'], ['contact', 'Get in Touch']] as const;
  for (const [section, name] of views) {
    await page.goto('/index.html#' + section);
    await expect(page.locator('html')).toHaveClass(/js-ready/);
    await expect(page.locator('#' + section)).toHaveClass(/active-section/);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1, name, exact: true })).toHaveCount(1);
    // Playwright's role lookup in WebKit does not leave out inert content (Safari itself does), so the
    // other views are checked in Chromium and Firefox.
    if (browserName === 'webkit') continue;
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    for (const [other, otherName] of views) {
      if (other !== section) await expect(page.getByRole('heading', { name: otherName, exact: true })).toHaveCount(0);
    }
  }
});

// The tab names the view, so history, bookmarks and a screen reader's window title say where you are.
test('each view names the browser tab, and Back puts the name back', async ({ page }) => {
  await stubVerification(page);
  await page.goto('/index.html');
  await expect(page.locator('html')).toHaveClass(/js-ready/);
  await expect(page).toHaveTitle('Aris Zounarakis | Software Engineer in Barcelona');
  for (const [section, title] of [['about', 'About'], ['skills', 'Skills'], ['work', 'Work'], ['blog', 'Blog'], ['contact', 'Contact']]) {
    await page.goto('/index.html#' + section);
    await expect(page.locator('#' + section)).toHaveClass(/active-section/);
    await expect(page).toHaveTitle(`${title} | Aris Zounarakis`);
  }
  await page.goto('/index.html#blog/codex');
  await expect(page.locator('#blog')).toHaveAttribute('data-mode', 'category');
  await expect(page).toHaveTitle('Codex | Blog | Aris Zounarakis');
  await page.goto('/index.html#blog/codex/fail-fast-learn-faster');
  await expect(page.locator('#blog-article-content h1')).toHaveText('Fail Fast, Learn Faster - Instinct, on Purpose');
  await expect(page).toHaveTitle('Fail Fast, Learn Faster - Instinct, on Purpose | Aris Zounarakis');
  await page.goBack();
  await expect(page).toHaveTitle('Codex | Blog | Aris Zounarakis');
  await page.goto('/index.html#about');
  await expect(page).toHaveTitle('About | Aris Zounarakis');
  await page.locator('#about .altar-close').click();
  await expect(page.locator('#main')).toHaveClass(/active-section/);
  await expect(page).toHaveTitle('Aris Zounarakis | Software Engineer in Barcelona');
});

// An open post brings its own h1, so the Blog heading steps aside and the page keeps one h1.
test('an open post is the only h1 in the Blog view', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Playwright role lookup in WebKit keeps inert views');
  await stubVerification(page);
  await page.goto('/index.html#blog/codex/fail-fast-learn-faster');
  await expect(page.locator('#blog-article-content h1')).toHaveText('Fail Fast, Learn Faster - Instinct, on Purpose');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fail Fast, Learn Faster - Instinct, on Purpose');
  await page.goto('/index.html#blog/codex');
  await expect(page.locator('#blog')).toHaveAttribute('data-mode', 'category');
  await expect(page.getByRole('heading', { level: 1, name: 'Blog', exact: true })).toHaveCount(1);
});

// Skip to content was routed as a hash, so from any view but the landing it returned to the landing.
test('skip to content moves focus into the section on screen and stays there', async ({ page }) => {
  await stubVerification(page);
  for (const section of ['main', 'about', 'skills', 'work', 'blog', 'contact']) {
    await page.goto('/index.html#' + section);
    await expect(page.locator('html')).toHaveClass(/js-ready/);
    await expect(page.locator('#' + section)).toHaveClass(/active-section/);
    // The first stop from the address bar.
    await page.locator('a.skip').focus();
    const before = page.url();
    await page.keyboard.press('Enter');
    await expect(page.locator('#' + section)).toHaveClass(/active-section/);
    await expect(page.locator('#' + section)).toBeFocused();
    expect(page.url()).toBe(before);
  }
});

// The landing used to focus its own section on load, so the first Tab passed the skip link and the nav.
test('on a fresh load the first Tab reaches the skip link, then the navigation, with a visible ring', async ({ page, browserName }) => {
  // WebKit leaves links out of the Tab order by default, as Safari does.
  test.skip(browserName === 'webkit', 'Tab skips links in WebKit');
  await page.setViewportSize({ width: 1366, height: 844 });
  await page.goto('/index.html');
  await expect(page.locator('html')).toHaveClass(/js-ready/);
  await expect(page.locator('#main')).toHaveClass(/active-section/);
  await page.keyboard.press('Tab');
  await expect(page.locator('a.skip')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('#network-nav')))).toBe(true);
  // Past the sigil, the first word label. Its ring is on the word, the only part that draws.
  await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => {
    const word = document.activeElement?.querySelector('.node-label');
    return word ? getComputedStyle(word).outlineStyle : 'no label';
  });
  expect(ring).toBe('solid');
});

// Enter on a dish label hid the label and dropped focus to the body, so the next Tab began at the top.
test('a Blog view change keeps keyboard focus in the view it shows', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 844 });
  await page.goto('/index.html#blog');
  await expect(page.locator('#blog')).toHaveClass(/active-section/);
  // A dish label where the dish runs, the Field Notes entry where the static fallback shows instead.
  await page.waitForFunction(() => document.querySelector('#dish-labels .arc-btn') || document.querySelector('#blog .webgl-fallback-visible'));
  const label = page.locator('#dish-labels .arc-btn[data-hub="codex"]');
  const opener = (await label.count()) ? label : page.locator('#blog .blog-memo-item[data-hub="codex"]:visible').first();
  await opener.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#blog-category-view')).toBeVisible();
  await expect(page.locator('#blog-category-title')).toBeFocused();
  const article = page.locator('#blog-category-view .blog-article-item').first();
  await expect(article).toBeVisible();
  await article.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#blog-article-view')).toBeVisible();
  await expect(page.locator('#blog-article-content')).toBeFocused();
  await page.locator('#btn-map-article').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#blog-article-view')).toBeHidden();
  await expect(page.locator('#blog')).toBeFocused();
});

test('controls no one can see stay out of the Tab order', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 844 });
  for (const section of ['main', 'about', 'skills', 'work', 'blog', 'contact']) {
    await page.goto('/index.html#' + section);
    await expect(page.locator('html')).toHaveClass(/js-ready/);
    await expect(page.locator('#' + section)).toHaveClass(/active-section/);
    // The panels cover the sigil and hide the labels. The landing and Contact still show the sigil.
    const covered = !['main', 'contact'].includes(section);
    expect(await page.locator('#network-nav').evaluate(el => (el as HTMLElement).inert), section).toBe(covered);
  }
  // Contact fades the word labels out, and they leave the Tab order once faded.
  await expect.poll(() => page.locator('.network-node-label').evaluateAll(labels =>
    labels.length > 0 && labels.every(label => getComputedStyle(label).visibility === 'hidden'))).toBe(true);
  // The article scroll buttons show once the article is scrolled, and leave the Tab order when it
  // returns to the top.
  await page.goto('/index.html#blog/codex/fail-fast-learn-faster');
  const view = page.locator('#blog-article-view');
  await expect(view).toBeVisible();
  const scrollNav = page.locator('.article-scroll-nav');
  const visibility = () => scrollNav.evaluate(el => getComputedStyle(el).visibility);
  await view.evaluate(el => { el.scrollTop = 900; });
  await expect(scrollNav).toHaveClass(/visible/);
  await expect.poll(visibility).toBe('visible');
  await view.evaluate(el => { el.scrollTop = 0; });
  await expect(scrollNav).not.toHaveClass(/visible/);
  await expect.poll(visibility).toBe('hidden');
  // Pressed from the keyboard, Bottom scrolls to the end and the focused button stays shown.
  await view.evaluate(el => { el.scrollTop = 900; });
  await expect(scrollNav).toHaveClass(/visible/);
  const bottom = page.locator('.scroll-nav-btn[data-action="bottom"]');
  await bottom.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => view.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2);
  await page.waitForTimeout(500);
  await expect(bottom).toBeFocused();
  expect(await visibility()).toBe('visible');
});

test('a typed capital H never opens the route debug overlay, which only ?hud enables', async ({ page }) => {
  // WCAG 2.1.4: a single-character shortcut fired whenever a visitor typed "Hello".
  await stubVerification(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/index.html');
  await expect(page.locator('html')).toHaveClass(/js-ready/);
  await page.keyboard.press('Shift+H');
  await expect(page.locator('#hud-canvas')).toHaveCount(0);

  await page.goto('/index.html#contact');
  const name = page.getByLabel('Your Name');
  await name.pressSequentially('Hello Hana');
  await expect(name).toHaveValue('Hello Hana');
  await expect(page.locator('#hud-canvas')).toHaveCount(0);

  await page.goto('/index.html?hud');
  await expect(page.locator('#hud-canvas')).toHaveCount(1);
});

for (const section of ['about', 'skills']) {
  test(`${section} card keeps keyboard focus inside and restores its trigger`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto(`/index.html#${section}`);
    // The card opens from a button in its heading, named by the heading, never from a focusable
    // article posing as a button.
    const name = section === 'about' ? 'Background' : 'Systems Thinking';
    const heading = page.getByRole('heading', { level: 2, name, exact: true });
    const trigger = heading.getByRole('button', { name, exact: true });
    await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    const first = page.locator(`#${section} .paper`).first();
    await expect(first).not.toHaveAttribute('role');
    await expect(first).not.toHaveAttribute('aria-label');
    await expect(first).toHaveAttribute('tabindex', '-1');
    // A key press first, so the focus that follows counts as keyboard focus in every engine.
    await page.keyboard.press('Shift');
    await trigger.focus();
    await expect(first).toHaveCSS('outline-style', 'dashed');
    await expect(trigger).toHaveCSS('outline-style', 'none');
    await trigger.press('Enter');
    const card = page.locator('.paper-open');
    await expect(card).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveAccessibleName(name);
    await expect(card.locator('.paper-trigger')).toHaveAttribute('aria-expanded', 'true');
    await audit(page, testInfo, section + '-dialog');
    await card.locator('.paper-card-close').focus();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      await expect.poll(() => card.evaluate(el => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => card.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
}

// The article pages had only a breadcrumb, no way back to the other views.
test('article pages lead back to the five views, and the in-app reader leaves that bar out', async ({ page }) => {
  for (const slug of ['codex/fail-fast-learn-faster', 'cosmos/first-year-software-engineer']) {
    await page.goto(`/blog/${slug}`);
    const links = page.locator('nav.article-site-nav .article-site-links a');
    await expect(links).toHaveText(['About', 'Skills', 'Work', 'Blog', 'Contact']);
    expect(await links.evaluateAll((items) => items.map((item) => item.getAttribute('href'))))
      .toEqual(['/#about', '/#skills', '/#work', '/#blog', '/#contact']);
    await expect(page.locator('nav.article-site-nav .article-site-home')).toHaveAttribute('href', '/');
    await page.locator('a.skip').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('main.article-container')).toBeFocused();
  }
  await page.goto('/index.html#blog/codex/fail-fast-learn-faster');
  await expect(page.locator('#blog-article-content .article-title')).toBeVisible();
  await expect(page.locator('#blog-article-content .article-site-nav')).toHaveCount(0);
});

// An opened card showed its own close and the section's, two × marks for one way out.
test('an opened card shows one close, and the section close returns once it shuts', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const section of ['about', 'skills']) {
    await page.goto('/index.html#' + section);
    const sectionClose = page.locator(`#${section} .altar-close`);
    await expect(sectionClose).toBeVisible();
    await page.locator(`#${section} .paper`).first().click();
    await expect(page.locator('.paper-open .paper-card-close')).toBeVisible();
    await expect(sectionClose).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.locator('.paper-open')).toHaveCount(0);
    await expect(sectionClose).toBeVisible();
  }
});

test('closing a paper during routing or resize does not leave an inert page', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/index.html#about');
  await page.locator('#about .paper').first().click();
  await page.evaluate(() => { location.hash = 'skills'; });
  await expect(page.locator('.paper-open')).toHaveCount(0);
  await page.locator('#skills .paper').first().click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.paper-open')).toHaveCount(0);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.locator('#skills .altar-close').click();
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.locator('#necro-menu a[href="#contact"]').click();
  await expect(page.locator('#contact')).toHaveClass(/active-section/);
});

test('compact cards keep their child links enabled after resize', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/index.html#about');
  await expect(page.locator('#about .paper-trigger, #skills .paper-trigger')).toHaveCount(8);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#about [data-paper][tabindex], #skills [data-paper][tabindex]')).toHaveCount(0);
  // Compact cards do not open, so their headings are plain headings again.
  await expect(page.locator('#about .paper-trigger, #skills .paper-trigger')).toHaveCount(0);
  await expect(page.locator('#about .slab-about h2')).toHaveText('Background');
  const email = page.locator('#about a[href="mailto:aris@zounarakis.com"]');
  await expect(email).toBeEnabled();
  await email.focus();
  await expect(email).toBeFocused();
  await page.setViewportSize({ width: 1366, height: 900 });
  await expect(page.locator('#about .paper-trigger, #skills .paper-trigger')).toHaveCount(8);
});

test('mobile menu and work dialog preserve keyboard focus and names', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html');
  const menu = page.getByRole('button', { name: 'Open menu', exact: true });
  await menu.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Main menu' })).toBeVisible();
  await audit(page, testInfo, 'menu');
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await menu.press('Enter');
  await page.locator('#necro-menu a[href="#work"]').press('Enter');
  const trigger = page.locator('.rail-node[data-id="adp"] .rail-dot-btn');
  await trigger.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'ADP', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('opacity', '1');
  await audit(page, testInfo, 'work-dialog');
  for (const key of ['Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    await expect.poll(() => dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('graphics controls and article reader remain accessible', async ({ page }, testInfo) => {
  await page.goto('/index.html');
  await page.locator('.graphics-control__toggle').press('Enter');
  await expect(page.locator('#graphics-profile-menu')).toBeVisible();
  await audit(page, testInfo, 'graphics-menu');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Graphics performance help' }).press('Enter');
  await audit(page, testInfo, 'graphics-help');
  await page.goto('/index.html#blog/codex/fail-fast-learn-faster');
  await expect(page.locator('#graphics-help-panel')).toBeHidden();
  await expect(page.locator('#graphics-profile-menu')).toBeHidden();
  await expect(page.locator('#blog-article-content h1')).toBeVisible();
  await audit(page, testInfo, 'article-reader');
});

test('contact validation, sending and unknown outcomes remain accessible', async ({ page }, testInfo) => {
  await stubVerification(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/contact', async route => {
    await pending;
    await route.fulfill({ status: 504, json: { success: false, state: 'unknown', error: 'Acceptance could not be confirmed.' } });
  });
  await page.goto('/index.html#contact');
  const submit = page.locator('button[type="submit"]');
  await submit.press('Enter');
  await expect(page.getByLabel('Your Name')).toBeFocused();
  await audit(page, testInfo, 'contact-validation');
  await fillContact(page);
  await submit.press('Enter');
  await expect(submit).toBeDisabled();
  try { await audit(page, testInfo, 'contact-sending'); }
  finally { release(); }
  await expect(page.locator('[data-status]')).toContainText('Acceptance could not be confirmed');
  await expect(page.locator('[data-status]')).toHaveAttribute('aria-live', 'polite');
  await audit(page, testInfo, 'contact-unknown');
});

test('reduced motion and repeated immediate paper exits clean up their dialogs', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/index.html#about');
  for (let index = 0; index < 3; index++) {
    await page.locator('#about .paper').first().press('Enter');
    await page.keyboard.press('Escape');
    await expect(page.locator('.paper-modal')).toHaveCount(0);
  }
  await page.locator('#about .paper').first().press('Enter');
  await page.evaluate(() => { location.hash = 'contact'; });
  await expect(page.locator('.paper-modal')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/paper-focus/);
  await expect(page.locator('#contact')).not.toHaveAttribute('inert');
});

test('paper child controls activate without toggling the containing card', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/index.html#about');
  await page.locator('#about .paper').first().click();
  const card = page.locator('.paper-open');
  await card.evaluate(el => {
    const link = document.createElement('a');
    link.href = '#contact';
    link.textContent = 'Fixture link';
    link.addEventListener('click', event => event.preventDefault());
    el.append(link);
  });
  await card.getByRole('link', { name: 'Fixture link' }).press('Enter');
  await expect(card).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
});
