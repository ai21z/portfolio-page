const STORAGE_KEY = 'portfolio.contact-attempt.v1';
export const RETRY_LIFETIME = 23 * 60 * 60 * 1000;

export class ContactAttempt {
  constructor(storage) {
    this.storage = storage;
    this.current = null;
    // Storage failure must not change the active attempt.
    try { this.current = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null'); }
    catch {}
  }

  async forPayload({ name, email, subject, message }) {
    const content = JSON.stringify([name, email, subject, message]);
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
    const digest = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
    if (this.current?.digest !== digest) {
      this.current = { id: crypto.randomUUID(), createdAt: Date.now(), digest };
      try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.current)); }
      catch {}
    }
    const age = Date.now() - this.current.createdAt;
    if (!Number.isFinite(age) || age > RETRY_LIFETIME || age < -60000) {
      throw new Error('This retry has expired. An earlier attempt may have been accepted. Please');
    }
    return { submissionId: this.current.id, submissionCreatedAt: this.current.createdAt };
  }

  clear() {
    this.current = null;
    try { this.storage?.removeItem(STORAGE_KEY); }
    catch {}
  }
}
