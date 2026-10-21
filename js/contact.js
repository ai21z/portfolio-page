import { ContactAttempt } from './contact-attempt.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUBJECT_LIMIT = { min: 5, max: 60 };
const MESSAGE_LIMIT = { min: 10, max: 350 };
const NAME_LIMIT = { min: 2, max: 80 };
const DIRECT_EMAIL = 'aris@zounarakis.com';
// How long a press of Send waits for the spam check before offering email instead. Turnstile
// retries a failed check about every 10 s on its own.
const VERIFY_WAIT_MS = 12000;

// The spam check (Cloudflare Turnstile) runs out of sight from the moment Contact opens, and how
// it fares stays quiet until the visitor presses Send. Send is never held back for it: the server
// refuses any message without a valid token, so a disabled button protected nothing and only made
// the form look broken where the check is blocked or slow. Send waits for the check instead, and
// where it cannot finish, the draft goes by email.
class NotebookContact {
  constructor() {
    this.form = null;
    this.inputs = {};
    this.statusEl = null;
    this.charCountEl = null;
    this.submitBtn = null;
    this.submitLabel = null;
    this.turnstileContainer = null;
    this.turnstileWidgetId = null;
    this.turnstileToken = '';
    this.turnstileRequired = true;
    this.verificationStarted = false;
    // idle, loading, running, ready, failed (the check ran and did not clear) or unavailable
    // (the script did not load or mount).
    this.verification = 'idle';
    this.tokenWaiter = null;
    this.visibilityListener = (event) => {
      if (event.detail?.visible) this.startVerification();
    };
    // A script that arrives after the load timeout still mounts.
    this.lateLoadListener = () => {
      if (this.verification === 'unavailable' && window.turnstile?.render) this.mountTurnstile();
    };
    this.formDisabled = false;
    this.isSubmitting = false;
    this.submitListener = (event) => this.handleSubmit(event);
  }

  init() {
    if (this.form) return;
    this.form = document.getElementById('contact-form');
    if (!this.form) return;
    let storage;
    try { storage = window.sessionStorage; } catch {}
    this.attempt = new ContactAttempt(storage);

    this.inputs.name = this.form.querySelector('#name');
    this.inputs.email = this.form.querySelector('#email');
    this.inputs.subject = this.form.querySelector('#subject');
    this.inputs.message = this.form.querySelector('#message');
    this.inputs.honeypot = this.form.querySelector('#nickname');
    this.statusEl = this.form.querySelector('[data-status]');
    this.charCountEl = this.form.querySelector('.char-count');
    this.submitBtn = this.form.querySelector('[data-submit]');
    this.submitLabel = this.form.querySelector('[data-submit-label]');
    this.turnstileContainer = this.form.querySelector('[data-turnstile]');
    this.turnstileRequired = Boolean(this.turnstileContainer && this.turnstileContainer.dataset.sitekey);

    this.wireFieldValidation();
    this.updateCharCount();

    this.form.addEventListener('submit', this.submitListener);

    this.updateSubmitState();

    if (this.turnstileRequired) {
      window.addEventListener('contact:visible', this.visibilityListener);
      document.addEventListener('turnstile-loaded', this.lateLoadListener);
      if (this.form.closest('.active-section')) this.startVerification();
    } else {
      this.formDisabled = true;
      this.showStatus('Verification widget is not configured. Contact form is disabled.', 'error');
      this.updateSubmitState();
      if (this.submitBtn) {
        this.submitBtn.disabled = true;
      }
    }
  }

  // Once per page when Contact opens, and once more from Send when the script did not load.
  startVerification({ reload = false } = {}) {
    if (!this.turnstileRequired || (this.verificationStarted && !reload)) return;
    this.verificationStarted = true;
    this.verification = 'loading';
    this.waitForTurnstile({ reload })
      .then(() => this.mountTurnstile())
      .catch(() => this.verificationEnded('unavailable'));
  }

  verificationEnded(state) {
    this.turnstileToken = '';
    this.verification = state;
    this.settleTokenWaiter('');
  }

  // Resolves with a token, or with '' once the check has failed or VERIFY_WAIT_MS has passed.
  // A check that asks the visitor for a tick waits for the tick.
  waitForToken() {
    if (this.turnstileToken) return Promise.resolve(this.turnstileToken);
    if (this.verification === 'unavailable' || this.verification === 'idle') {
      this.startVerification({ reload: true });
    } else if (this.verification === 'failed') {
      this.verification = 'running';
      this.resetTurnstile();
    }
    return new Promise((resolve) => {
      this.tokenWaiter = { resolve, timer: 0 };
      if (this.verification === 'unavailable' || this.verification === 'failed') this.settleTokenWaiter('');
      else if (this.turnstileContainer?.classList.contains('is-interactive')) this.setInteractive(true);
      else this.armTokenWaiter();
    });
  }

  armTokenWaiter() {
    if (!this.tokenWaiter) return;
    window.clearTimeout(this.tokenWaiter.timer);
    this.tokenWaiter.timer = window.setTimeout(() => this.settleTokenWaiter(''), VERIFY_WAIT_MS);
  }

  settleTokenWaiter(token) {
    const waiter = this.tokenWaiter;
    if (!waiter) return;
    this.tokenWaiter = null;
    window.clearTimeout(waiter.timer);
    waiter.resolve(token);
  }

  // Turnstile shows a checkbox only to a visitor it is unsure about.
  setInteractive(on) {
    this.turnstileContainer?.classList.toggle('is-interactive', on);
    if (!this.tokenWaiter) return;
    if (on) {
      window.clearTimeout(this.tokenWaiter.timer);
      this.showStatus('Tick the box and your message is on its way.', 'info');
      // The box opens just above Send: bring both into view once it has its size.
      window.requestAnimationFrame(() => this.submitBtn?.scrollIntoView({ block: 'nearest' }));
    } else {
      this.armTokenWaiter();
    }
  }

  wireFieldValidation() {
    if (!this.form) return;

    const validators = {
      name: {
        test: (value) => {
          const trimmed = value.trim();
          return trimmed.length >= NAME_LIMIT.min && trimmed.length <= NAME_LIMIT.max;
        },
        message: `Name must be ${NAME_LIMIT.min}-${NAME_LIMIT.max} characters`
      },
      email: {
        test: (value) => EMAIL_REGEX.test(value.trim()),
        message: 'Please enter a valid email address'
      },
      subject: {
        test: (value) => {
          const trimmed = value.trim();
          return trimmed.length >= SUBJECT_LIMIT.min && trimmed.length <= SUBJECT_LIMIT.max;
        },
        message: `Subject must be ${SUBJECT_LIMIT.min}-${SUBJECT_LIMIT.max} characters`
      },
      message: {
        test: (value) => {
          const trimmed = value.trim();
          return trimmed.length >= MESSAGE_LIMIT.min && trimmed.length <= MESSAGE_LIMIT.max;
        },
        message: `Message must be ${MESSAGE_LIMIT.min}-${MESSAGE_LIMIT.max} characters`
      }
    };

    this.validators = validators;

    const fields = ['name', 'email', 'subject', 'message'];
    fields.forEach((key) => {
      const input = this.inputs[key];
      if (!input) return;

      input.addEventListener('blur', () => this.validateField(key));
      input.addEventListener('input', () => {
        if (key === 'message') {
          this.updateCharCount();
        }
        this.validateField(key, { silent: true });
      });
    });
  }

  getErrorNode(input) {
    const field = input?.closest('.notebook-field');
    if (!field) return null;
    return field.querySelector('.validation-msg');
  }

  validateField(key, options = {}) {
    const input = this.inputs[key];
    const rules = this.validators?.[key];
    if (!input || !rules) return true;

    const value = input.value ?? '';
    const isValid = rules.test(value);
    const errorNode = this.getErrorNode(input);
    if (errorNode) {
      if (!errorNode.id) errorNode.id = `${key}-error`;
      if (!errorNode.getAttribute('role')) errorNode.setAttribute('role', 'alert');
    }

    if (isValid) {
      input.classList.remove('error');
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
      if (errorNode) errorNode.textContent = '';
    } else if (!options.silent) {
      input.classList.add('error');
      input.setAttribute('aria-invalid', 'true');
      if (errorNode) {
        errorNode.textContent = rules.message;
        input.setAttribute('aria-describedby', errorNode.id);
      }
    }

    return isValid;
  }

  validateAll() {
    const fields = ['name', 'email', 'subject', 'message'];
    const results = fields.map((field) => this.validateField(field));
    return results.every(Boolean);
  }

  updateCharCount() {
    if (!this.charCountEl || !this.inputs.message) return;
    const length = this.inputs.message.value.length;
    this.charCountEl.textContent = `${length}/${MESSAGE_LIMIT.max}`;
    // Colours live in contact.css, where they are checked against the paper.
    this.charCountEl.classList.toggle('over-limit', length > MESSAGE_LIMIT.max);
  }

  async handleSubmit(event) {
    event.preventDefault();
    if (this.isSubmitting || this.formDisabled) return;
    if (!this.validateAll()) {
      this.showStatus('Please fix the highlighted fields before sending.', 'error');
      this.form.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }

    this.isSubmitting = true;
    this.setSubmittingState(true);
    this.showStatus('Sending your message...', 'info');
    if (this.turnstileRequired && !(await this.waitForToken())) {
      this.isSubmitting = false;
      this.setSubmittingState(false);
      this.updateSubmitState();
      this.showEmailFallback(this.verification === 'unavailable'
        ? 'The spam check could not run in this browser. Your message is still here, and you can'
        : 'The spam check did not clear this time. Press Send to try again, or');
      return;
    }
    const controller = new AbortController();
    this.submissionController = controller;
    const timer = window.setTimeout(() => controller.abort(), 30000);
    let requestStarted = false;
    try {
      const payload = this.buildPayload();
      Object.assign(payload, await this.attempt.forPayload(payload));
      controller.signal.throwIfAborted();
      requestStarted = true;
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const result = await this.parseJson(response);
      if (!response.ok || !result?.success || result.state !== 'accepted') {
        this.showResultError(result?.error || 'The result could not be confirmed. Your message may already have been accepted.');
        return;
      }
      this.showStatus('Message accepted. Thank you for getting in touch.', 'success');
      this.form.reset();
      this.attempt.clear();
      this.updateCharCount();
    } catch (error) {
      if (requestStarted) {
        this.showDirectEmailStatus('The result could not be confirmed. Your message may already have been accepted. You can retry unchanged content or');
      } else {
        this.showResultError(error.message || 'This attempt could not start.');
      }
    } finally {
      window.clearTimeout(timer);
      this.submissionController = null;
      this.resetTurnstile();
      this.isSubmitting = false;
      this.setSubmittingState(false);
      this.updateSubmitState();
    }
  }

  buildPayload() {
    const scrubLine = (value) => value.replace(/[\r\n]+/g, ' ').replace(/[\u0000-\u001F\u007F]+/g, '').trim();
    const scrubMessage = (value) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]+/g, '').trim();

    return {
      name: scrubLine(this.inputs.name?.value || ''),
      email: this.inputs.email?.value.trim() || '',
      subject: scrubLine(this.inputs.subject?.value || ''),
      message: scrubMessage(this.inputs.message?.value || ''),
      turnstileToken: this.turnstileToken,
      honeypot: this.inputs.honeypot?.value || ''
    };
  }

  setSubmittingState(state) {
    for (const key of ['name', 'email', 'subject', 'message']) {
      if (this.inputs[key]) this.inputs[key].readOnly = state;
    }
    if (!this.submitBtn) return;

    if (state) {
      this.submitBtn.classList.add('is-loading');
      this.submitBtn.disabled = true;
      if (this.submitLabel) this.submitLabel.textContent = 'Sending…';
    } else {
      this.submitBtn.classList.remove('is-loading');
      if (this.submitLabel) this.submitLabel.textContent = 'Send Message';
    }
  }

  showStatus(message, level = 'info') {
    if (!this.statusEl) return;

    this.statusEl.textContent = message || '';
    this.statusEl.classList.remove('success', 'error');
    if (level === 'success') {
      this.statusEl.classList.add('success');
    } else if (level === 'error') {
      this.statusEl.classList.add('error');
    }
  }

  showDirectEmailStatus(message, level = 'error', link = this.emailLink('email me directly')) {
    if (!this.statusEl) return;

    this.showStatus('', level);
    this.statusEl.append(document.createTextNode(`${message} `));
    this.statusEl.append(link);
    this.statusEl.append(document.createTextNode('.'));
  }

  // A message that already ends by pointing to email gets its link there, the rest gain one.
  showResultError(message) {
    const pointsToEmail = /\s*email me directly\.?$/i;
    this.showDirectEmailStatus(pointsToEmail.test(message) ? message.replace(pointsToEmail, '') : `${message} You can`);
  }

  // Not an error of the visitor's, so it is written in ink, with the draft ready to go by email.
  showEmailFallback(message) {
    const draft = this.buildPayload();
    const params = new URLSearchParams({ subject: draft.subject, body: `${draft.message}\n\n${draft.name}` });
    // Mail clients read %20, not +, as a space.
    const link = this.emailLink('send it by email', `?${params.toString().replace(/\+/g, '%20')}`);
    this.showDirectEmailStatus(message, 'info', link);
  }

  emailLink(text, query = '') {
    const link = document.createElement('a');
    link.href = `mailto:${DIRECT_EMAIL}${query}`;
    link.textContent = text;
    return link;
  }

  updateSubmitState() {
    if (!this.submitBtn) return;
    this.submitBtn.disabled = this.isSubmitting || this.formDisabled;
  }

  async parseJson(response) {
    try {
      return await response.json();
    } catch (error) {
      return null;
    }
  }

  async waitForTurnstile({ reload = false } = {}) {
    if (window.turnstile && typeof window.turnstile.render === 'function') {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      // A script element that failed never loads again, so a second try needs a fresh one.
      if (reload) document.getElementById('turnstile-script')?.remove();
      let script = document.getElementById('turnstile-script');
      const cleanup = () => {
        window.clearTimeout(timeout);
        document.removeEventListener('turnstile-loaded', onLoad);
        script?.removeEventListener('error', onError);
      };
      const onError = () => {
        cleanup();
        reject(new Error('Turnstile unavailable'));
      };
      const onLoad = () => {
        cleanup();
        if (window.turnstile && typeof window.turnstile.render === 'function') {
          resolve();
        } else {
          reject(new Error('Turnstile unavailable'));
        }
      };
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error('Turnstile timed out'));
      }, 8000);
      document.addEventListener('turnstile-loaded', onLoad, { once: true });
      if (!script) {
        script = document.createElement('script');
        script.id = 'turnstile-script';
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__turnstileOnLoad';
        script.async = true;
        script.addEventListener('error', onError, { once: true });
        document.head.appendChild(script);
      } else {
        script.addEventListener('error', onError, { once: true });
      }
    });
  }

  mountTurnstile() {
    if (!this.turnstileContainer || !window.turnstile || this.turnstileWidgetId) return;

    this.turnstileContainer.innerHTML = '';
    this.verification = 'running';

    try {
      this.turnstileWidgetId = window.turnstile.render(this.turnstileContainer, {
        sitekey: this.turnstileContainer.dataset.sitekey || '',
        action: 'contact_form',
        theme: 'light',
        appearance: 'interaction-only',
        callback: (token) => {
          this.turnstileToken = token;
          this.verification = 'ready';
          this.setInteractive(false);
          this.settleTokenWaiter(token);
        },
        // Turnstile keeps retrying on its own, and a later success lands in callback. Returning
        // true marks the error as handled, so it is not logged as an uncaught one.
        'error-callback': () => {
          this.verificationEnded('failed');
          return true;
        },
        'timeout-callback': () => this.verificationEnded('failed'),
        // Turnstile renews an expired token by itself.
        'expired-callback': () => {
          this.turnstileToken = '';
          this.verification = 'running';
        },
        'before-interactive-callback': () => this.setInteractive(true),
        'after-interactive-callback': () => this.setInteractive(false)
      });
    } catch (error) {
      this.turnstileWidgetId = null;
      this.verificationEnded('unavailable');
    }
  }

  // Tokens are single use, so every send after the first runs the check again.
  resetTurnstile() {
    this.turnstileToken = '';
    if (this.turnstileWidgetId && window.turnstile && typeof window.turnstile.reset === 'function') {
      this.verification = 'running';
      window.turnstile.reset(this.turnstileWidgetId);
    }
    this.updateSubmitState();
  }

  destroy() {
    if (!this.form) return;
    this.submissionController?.abort();
    window.removeEventListener('contact:visible', this.visibilityListener);
    document.removeEventListener('turnstile-loaded', this.lateLoadListener);
    this.settleTokenWaiter('');
    this.form.removeEventListener('submit', this.submitListener);
    if (this.turnstileWidgetId && window.turnstile && typeof window.turnstile.remove === 'function') {
      window.turnstile.remove(this.turnstileWidgetId);
    }
  }
}

export const notebookContact = new NotebookContact();
