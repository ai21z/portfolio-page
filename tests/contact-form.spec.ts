import { test, expect } from '@playwright/test';

const turnstileStubScript = `
  window.turnstile = {
    render: function (container, options) {
      var widgetId = 'stub-widget';
      setTimeout(function () {
        if (options && typeof options.callback === 'function') {
          options.callback('test-turnstile-token');
        }
      }, 10);
      return widgetId;
    },
    reset: function () {},
    remove: function () {}
  };
  if (typeof window.__turnstileOnLoad === 'function') {
    window.__turnstileOnLoad();
  } else {
    document.dispatchEvent(new CustomEvent('turnstile-loaded'));
  }
`;

const turnstileErrorStubScript = `
  window.__checks = 0;
  var fail = function (options) {
    window.__checks++;
    setTimeout(function () {
      if (options && typeof options['error-callback'] === 'function') {
        options['error-callback']('600010');
      }
    }, 10);
  };
  var widget;
  window.turnstile = {
    render: function (container, options) {
      widget = options;
      fail(options);
      return 'stub-widget';
    },
    reset: function () { fail(widget); },
    remove: function () {}
  };
  if (typeof window.__turnstileOnLoad === 'function') {
    window.__turnstileOnLoad();
  } else {
    document.dispatchEvent(new CustomEvent('turnstile-loaded'));
  }
`;

async function routeTurnstile(page, body = turnstileStubScript) {
  await page.route('https://challenges.cloudflare.com/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body
    });
  });
}

test.describe('Contact form', () => {
  test('submits successfully when fields are valid', async ({ page }) => {
    await routeTurnstile(page);
    await page.route('**/api/contact', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, state: 'accepted' })
      });
    });

    await page.goto('/index.html#contact');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => {
      const contact = document.getElementById('contact');
      return !!contact && contact.classList.contains('active-section');
    });
    await page.waitForSelector('#contact-form');

    await page.getByLabel('Your Name').fill('Test Visitor');
    await page.getByLabel('Your Email').fill('visitor@example.com');
    await page.getByLabel('Subject').fill('Testing contact channel');
    await page.getByLabel('Message').fill('This is a test of the secure contact flow.');

    await expect(page.getByRole('button', { name: /send message/i })).toBeEnabled();

    await page.getByRole('button', { name: /send message/i }).click();

    await expect(page.locator('[data-status]')).toHaveText(/message accepted/i);
    await expect(page.getByLabel('Message')).toHaveValue('');
  });

  test('shows backend error feedback when API responds with failure', async ({ page }) => {
    await routeTurnstile(page);
    await page.route('**/api/contact', (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Contact service misconfigured.' })
      });
    });

    await page.goto('/index.html#contact');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => {
      const contact = document.getElementById('contact');
      return !!contact && contact.classList.contains('active-section');
    });
    await page.waitForSelector('#contact-form');

    await page.getByLabel('Your Name').fill('Failing Visitor');
    await page.getByLabel('Your Email').fill('fail@example.com');
    await page.getByLabel('Subject').fill('Expecting failure');
    await page.getByLabel('Message').fill('Please simulate a backend failure so we can assert UI behaviour.');

    await page.getByRole('button', { name: /send message/i }).click();

    await expect(page.locator('[data-status]')).toHaveText(/misconfigured/i);
  });

  test('a failing spam check stays quiet until Send, which then retries it and offers the draft by email', async ({ page }) => {
    await routeTurnstile(page, turnstileErrorStubScript);
    let posts = 0;
    await page.route('**/api/contact', (route) => { posts++; return route.abort(); });

    await page.goto('/index.html#contact');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => {
      const contact = document.getElementById('contact');
      return !!contact && contact.classList.contains('active-section');
    });
    await page.waitForSelector('#contact-form');
    await expect.poll(() => page.evaluate(() => (window as any).__checks)).toBe(1);
    await page.waitForTimeout(100);

    // Nothing to read before the visitor asks to send.
    await expect(page.locator('[data-status]')).toHaveText('');
    const send = page.getByRole('button', { name: /send message/i });
    await expect(send).toBeEnabled();

    await page.getByLabel('Your Name').fill('Test Visitor');
    await page.getByLabel('Your Email').fill('visitor@example.com');
    await page.getByLabel('Subject').fill('Testing contact channel');
    await page.getByLabel('Message').fill('A note that goes by email instead.');
    await send.click();

    const status = page.locator('[data-status]');
    await expect(status).toHaveText(/spam check did not clear this time\. press send to try again, or send it by email\./i);
    await expect(status).not.toHaveClass(/error/);
    const href = await status.locator('a').getAttribute('href');
    expect(href).toBe('mailto:aris@zounarakis.com?subject=Testing%20contact%20channel&body=A%20note%20that%20goes%20by%20email%20instead.%0A%0ATest%20Visitor');
    // Send ran the check once more, and no message went out without a token.
    expect(await page.evaluate(() => (window as any).__checks)).toBe(2);
    expect(posts).toBe(0);
    await expect(send).toBeEnabled();
    await expect(page.getByLabel('Message')).toHaveValue('A note that goes by email instead.');
    await expect(page.getByLabel('Message')).toBeEditable();
  });

  test('a server message that already points to email gets one email link', async ({ page }) => {
    await routeTurnstile(page);
    await page.route('**/api/contact', (route) => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ state: 'not_sent', error: 'Contact service unavailable. Please email me directly.' })
    }));
    await page.goto('/index.html#contact');
    await page.waitForSelector('#contact-form');
    await page.getByLabel('Your Name').fill('Test Visitor');
    await page.getByLabel('Your Email').fill('visitor@example.com');
    await page.getByLabel('Subject').fill('Testing contact channel');
    await page.getByLabel('Message').fill('A note for a service that is down.');
    await page.getByRole('button', { name: /send message/i }).click();
    const status = page.locator('[data-status]');
    await expect(status).toHaveText('Contact service unavailable. Please email me directly.');
    await expect(status.locator('a')).toHaveCount(1);
  });

  test('keeps the message and shows an error when email delivery is rejected', async ({ page }) => {
    await routeTurnstile(page);
    await page.route('**/api/contact', route => route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Failed to deliver message. Please try again later.' })
    }));

    await page.goto('/index.html#contact');
    await page.getByLabel('Your Name').fill('Test Visitor');
    await page.getByLabel('Your Email').fill('visitor@example.test');
    await page.getByLabel('Subject').fill('Please keep my message');
    await page.getByLabel('Message').fill('This message must remain available after a failed send.');
    await page.getByRole('button', { name: /send message/i }).click();

    await expect(page.locator('[data-status]')).toContainText('Failed to deliver message. Please try again later.');
    await expect(page.locator('[data-status]')).toHaveClass(/error/);
    await expect(page.getByLabel('Your Name')).toHaveValue('Test Visitor');
    await expect(page.getByLabel('Your Email')).toHaveValue('visitor@example.test');
    await expect(page.getByLabel('Subject')).toHaveValue('Please keep my message');
    await expect(page.getByLabel('Message')).toHaveValue('This message must remain available after a failed send.');
  });
});
