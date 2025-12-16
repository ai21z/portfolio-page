// Contact form controller

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUBJECT_LIMIT = { min: 5, max: 60 };
const MESSAGE_LIMIT = { min: 10, max: 350 };
const NAME_LIMIT = { min: 2, max: 80 };

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
    this.turnstileAvailable = true;
    this.isSubmitting = false;
    this.submitListener = (event) => this.handleSubmit(event);
  }

  init() {
    this.form = document.getElementById('contact-form');
    if (!this.form) return;

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
      this.waitForTurnstile()
        .then(() => this.mountTurnstile())
        .catch(() => {
          this.turnstileAvailable = false;
          this.showStatus('Verification widget failed to load. Please refresh and try again.', 'error');
          this.updateSubmitState();
        });
    } else {
      this.turnstileAvailable = false;
      this.showStatus('Verification widget is not configured. Contact form is disabled.', 'error');
      this.updateSubmitState();
      if (this.submitBtn) {
        this.submitBtn.disabled = true;
      }
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

    if (isValid) {
      input.classList.remove('error');
      if (errorNode) errorNode.textContent = '';
    } else if (!options.silent) {
      input.classList.add('error');
      if (errorNode) errorNode.textContent = rules.message;
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
    const color = length > MESSAGE_LIMIT.max ? '#8B0000' : length < MESSAGE_LIMIT.min ? '#8B7D6B' : '#5A5040';
    this.charCountEl.style.color = color;
  }

  async handleSubmit(event) {
    event.preventDefault();
    if (this.isSubmitting) return;

    const valid = this.validateAll();
    if (!valid) {
      this.showStatus('Please fix the highlighted fields before sending.', 'error');
      return;
    }

    if (this.turnstileRequired && !this.turnstileToken) {
      if (window.turnstile && this.turnstileWidgetId) {
        this.showStatus('Verifying you are human…', 'info');
        const maxWait = 5000;
        const startTime = Date.now();
        while (!this.turnstileToken && (Date.now() - startTime) < maxWait) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (!this.turnstileToken) {
          this.showStatus('Verification timed out. Please refresh and try again.', 'error');
          return;
        }
      } else {
        this.showStatus('Verification widget unavailable. Please refresh the page.', 'error');
        return;
      }
    }

    const payload = this.buildPayload();

    this.isSubmitting = true;
    this.setSubmittingState(true);
    this.showStatus('Sending your message…', 'info');

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const result = await this.parseJson(response);

      if (!response.ok || !result?.success) {
        const message = result?.error || 'Unable to send message right now. Please try again later.';
        throw new Error(message);
      }

      this.showStatus('Message sent. I will reply soon.', 'success');
      this.form.reset();
      this.updateCharCount();
      this.resetTurnstile();
    } catch (error) {
      this.showStatus(error?.message || 'Something went wrong. Please try again.', 'error');
      this.resetTurnstile();
    } finally {
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

  updateSubmitState() {
    if (!this.submitBtn) return;
    const disabled = this.isSubmitting || (this.turnstileRequired && (!this.turnstileToken || !this.turnstileAvailable));
    this.submitBtn.disabled = disabled;
  }

  async parseJson(response) {
    try {
      return await response.json();
    } catch (error) {
      return null;
    }
  }

  async waitForTurnstile() {
    if (window.turnstile && typeof window.turnstile.render === 'function') {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        document.removeEventListener('turnstile-loaded', onLoad);
        reject(new Error('Turnstile timed out'));
      }, 8000);

      const onLoad = () => {
        window.clearTimeout(timeout);
        if (window.turnstile && typeof window.turnstile.render === 'function') {
          resolve();
        } else {
          reject(new Error('Turnstile unavailable'));
        }
      };

      document.addEventListener('turnstile-loaded', onLoad, { once: true });
    });
  }

  mountTurnstile() {
    if (!this.turnstileContainer || !window.turnstile) return;

    this.turnstileContainer.innerHTML = '';
    this.turnstileAvailable = true;
    this.updateSubmitState();

    try {
      this.turnstileWidgetId = window.turnstile.render(this.turnstileContainer, {
        sitekey: this.turnstileContainer.dataset.sitekey || '',
        action: 'contact_form',
        theme: 'light',
        appearance: 'execute',
        callback: (token) => {
          this.turnstileToken = token;
          this.updateSubmitState();
        },
        'error-callback': () => {
          this.turnstileToken = '';
          this.updateSubmitState();
          this.showStatus('Verification failed. Please retry the challenge.', 'error');
        },
        'expired-callback': () => {
          this.turnstileToken = '';
          this.updateSubmitState();
          this.showStatus('Verification expired. Complete the challenge again.', 'error');
        }
      });
    } catch (error) {
      console.error('Turnstile render failed', error);
      this.turnstileAvailable = false;
      this.showStatus('Verification widget is unavailable. Contact form is disabled.', 'error');
      this.updateSubmitState();
    }
  }

  resetTurnstile() {
    if (this.turnstileWidgetId && window.turnstile && typeof window.turnstile.reset === 'function') {
      window.turnstile.reset(this.turnstileWidgetId);
    }
    this.turnstileToken = '';
    this.updateSubmitState();
  }

  destroy() {
    if (!this.form) return;
    this.form.removeEventListener('submit', this.submitListener);
    if (this.turnstileWidgetId && window.turnstile && typeof window.turnstile.remove === 'function') {
      window.turnstile.remove(this.turnstileWidgetId);
    }
  }
}

export const notebookContact = new NotebookContact();
