import { describe, it, expect } from 'vitest';
import { resolveAll, fingerprintOf } from '../../src/core/resolver';
import { SecretBackend } from '../../src/backends';

class StubBackend implements SecretBackend {
  readonly name = 'stub'; readonly kind = 'stub';
  constructor(private values: Record<string, string>) {}
  set(k: string, v: string) { this.values[k] = v; }
  async resolve(refs: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const r of refs) if (this.values[r] !== undefined) out.set(r, this.values[r] as string);
    return out;
  }
}

describe('resolveAll', () => {
  it('maps env names onto backend references', async () => {
    const b = new StubBackend({ 'prod/db': 'pw', 'prod/api': 'key' });
    const r = await resolveAll(b, { DB_PASSWORD: 'prod/db', API_KEY: 'prod/api' });
    expect(r.env).toEqual({ DB_PASSWORD: 'pw', API_KEY: 'key' });
  });

  it('fails loudly on a missing secret instead of injecting an empty string', async () => {
    // An empty value starts the app and breaks it in a way that looks like an app bug.
    const b = new StubBackend({});
    await expect(resolveAll(b, { DB_PASSWORD: 'prod/db' }))
      .rejects.toThrow(/was not returned by the backend/);
  });

  it('asks for each distinct reference once even when two vars share it', async () => {
    let asked: string[] = [];
    const b: SecretBackend = {
      name: 'x', kind: 'x',
      async resolve(refs) { asked = refs; return new Map(refs.map((r) => [r, 'v'])); },
    };
    await resolveAll(b, { A: 'same', B: 'same' });
    expect(asked).toEqual(['same']);
  });
});

describe('fingerprintOf', () => {
  it('is stable regardless of key order', () => {
    expect(fingerprintOf({ A: '1', B: '2' })).toBe(fingerprintOf({ B: '2', A: '1' }));
  });

  it('changes when any value changes - this is what detects a rotation', () => {
    expect(fingerprintOf({ A: '1' })).not.toBe(fingerprintOf({ A: '2' }));
  });

  it('changes when a variable is added or removed', () => {
    expect(fingerprintOf({ A: '1' })).not.toBe(fingerprintOf({ A: '1', B: '2' }));
  });

  it('never contains the value itself', () => {
    const fp = fingerprintOf({ A: 'hunter2' });
    expect(fp).not.toContain('hunter2');
    expect(fp).toHaveLength(16);
  });
});
