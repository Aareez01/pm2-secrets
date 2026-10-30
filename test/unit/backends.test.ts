import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileBackend } from '../../src/backends';
import { SecretsManagerBackend, SsmBackend } from '../../src/backends';

const dir = mkdtempSync(join(tmpdir(), 'sec-'));

describe('FileBackend', () => {
  it('resolves references from a JSON object', async () => {
    const p = join(dir, 'ok.json');
    writeFileSync(p, JSON.stringify({ 'prod/db': 'pw', other: 'x' }), { mode: 0o600 });
    chmodSync(p, 0o600);
    const m = await new FileBackend('f', p).resolve(['prod/db']);
    expect(m.get('prod/db')).toBe('pw');
  });

  it('fails on a reference that is absent rather than returning nothing', async () => {
    const p = join(dir, 'partial.json');
    writeFileSync(p, JSON.stringify({ a: '1' }), { mode: 0o600 });
    await expect(new FileBackend('f', p).resolve(['a', 'missing']))
      .rejects.toThrow(/not found/);
  });

  it('reports a missing or malformed file clearly', async () => {
    await expect(new FileBackend('f', join(dir, 'nope.json')).resolve(['a']))
      .rejects.toThrow(/cannot read/);
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, 'not json', { mode: 0o600 });
    await expect(new FileBackend('f', bad).resolve(['a']))
      .rejects.toThrow(/not valid JSON/);
  });

  it('rejects a JSON array, which cannot express a mapping', async () => {
    const p = join(dir, 'arr.json');
    writeFileSync(p, '[1,2]', { mode: 0o600 });
    await expect(new FileBackend('f', p).resolve(['a']))
      .rejects.toThrow(/must contain a JSON object/);
  });

  it('coerces non-string values rather than injecting "[object Object]" silently', async () => {
    const p = join(dir, 'num.json');
    writeFileSync(p, JSON.stringify({ port: 5432 }), { mode: 0o600 });
    expect((await new FileBackend('f', p).resolve(['port'])).get('port')).toBe('5432');
  });
});

describe('AWS backends without the SDK installed', () => {
  it('say exactly what to install instead of failing obscurely', async () => {
    // The SDK is an optional peer dependency; most users are not on AWS.
    await expect(new SecretsManagerBackend('a').resolve(['x']))
      .rejects.toThrow(/npm install @aws-sdk\/client-secrets-manager/);
    await expect(new SsmBackend('b').resolve(['x']))
      .rejects.toThrow(/npm install @aws-sdk\/client-ssm/);
  });
});
