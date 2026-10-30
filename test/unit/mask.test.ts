import { describe, it, expect, beforeEach } from 'vitest';
import { remember, mask, forgetAll, fingerprint } from '../../src/mask';

beforeEach(() => forgetAll());

describe('mask', () => {
  it('removes a known secret from anywhere in a string', () => {
    remember('hunter2');
    expect(mask('connect failed with hunter2 at line 3'))
      .toBe('connect failed with [redacted] at line 3');
  });

  it('removes every occurrence', () => {
    remember('s3cret');
    expect(mask('s3cret and s3cret')).toBe('[redacted] and [redacted]');
  });

  it('leaves unrelated text alone', () => {
    remember('hunter2');
    expect(mask('nothing to see')).toBe('nothing to see');
  });

  it('ignores values too short to be meaningful', () => {
    // Masking "abc" would redact ordinary words and make logs useless.
    remember('ab');
    expect(mask('ab cd')).toBe('ab cd');
  });

  it('forgets everything when the configuration changes', () => {
    remember('hunter2');
    forgetAll();
    expect(mask('hunter2')).toBe('hunter2');
  });
});

describe('fingerprint', () => {
  it('identifies a value without revealing it', () => {
    const fp = fingerprint('hunter2');
    expect(fp).not.toContain('hunter2');
    expect(fp).toBe(fingerprint('hunter2'));
    expect(fp).not.toBe(fingerprint('hunter3'));
  });
});
