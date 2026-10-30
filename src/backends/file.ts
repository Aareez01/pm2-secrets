import { readFile, stat } from 'node:fs/promises';
import { SecretBackend, SecretError } from './types';

/**
 * A JSON file of secrets.
 *
 * Present for development, for tests, and for hosts where something else (a sidecar, a
 * provisioning step) already drops a secrets file. It also makes the injection path
 * testable without reaching for a cloud account.
 */
export class FileBackend implements SecretBackend {
  readonly kind = 'file';

  constructor(readonly name: string, private readonly path: string) {}

  async resolve(refs: string[]): Promise<Map<string, string>> {
    let text: string;
    try {
      const st = await stat(this.path);
      // Warn loudly rather than refuse: the file may be managed by something else.
      if ((st.mode & 0o077) !== 0) {
        const { log } = await import('../log');
        log.warn('secrets file is readable by other users', {
          path: this.path, mode: (st.mode & 0o777).toString(8),
        });
      }
      text = await readFile(this.path, 'utf8');
    } catch (err) {
      throw new SecretError(`cannot read ${this.path}: ${(err as Error).message}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new SecretError(`${this.path} is not valid JSON: ${(err as Error).message}`, false);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new SecretError(`${this.path} must contain a JSON object`, false);
    }

    const obj = parsed as Record<string, unknown>;
    const out = new Map<string, string>();
    const missing: string[] = [];
    for (const ref of refs) {
      const v = obj[ref];
      if (v === undefined || v === null) { missing.push(ref); continue; }
      out.set(ref, String(v));
    }
    if (missing.length > 0) {
      throw new SecretError(`not found in ${this.path}: ${missing.join(', ')}`, false);
    }
    return out;
  }
}
