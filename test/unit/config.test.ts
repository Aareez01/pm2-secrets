import { describe, it, expect } from 'vitest';
import { parseConfig, ConfigError, backendNameFor } from '../../src/config/schema';

const base = {
  backends: { vault: { type: 'file', path: '/etc/secrets.json' } },
  apps: { api: { secrets: { DB_PASSWORD: 'prod/db' } } },
};

describe('config', () => {
  it('defaults to env mode and a five-minute refresh', () => {
    const c = parseConfig(base);
    expect(c.apps.api!.mode).toBe('env');
    expect(c.refreshSeconds).toBe(300);
    expect(c.injectOnStart).toBe(true);
  });

  it('rejects an app pointing at a backend that does not exist', () => {
    try {
      parseConfig({ ...base, apps: { api: { secrets: { A: 'b' }, backend: 'typo' } } });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as ConfigError).issues.join()).toMatch(/no backend named "typo"/);
    }
  });

  it('rejects an app with no secrets listed', () => {
    expect(() => parseConfig({ ...base, apps: { api: { secrets: {} } } }))
      .toThrow(ConfigError);
  });

  it('rejects apps when no backends are defined at all', () => {
    expect(() => parseConfig({ backends: {}, apps: { api: { secrets: { A: 'b' } } } }))
      .toThrow(ConfigError);
  });

  it('falls back to the single backend when an app names none', () => {
    expect(backendNameFor(parseConfig(base), 'api')).toBe('vault');
  });

  it('accepts file mode with a custom env name', () => {
    const c = parseConfig({ ...base,
      apps: { api: { secrets: { A: 'b' }, mode: 'file', fileEnvName: 'APP_SECRETS' } } });
    expect(c.apps.api!.mode).toBe('file');
    expect(c.apps.api!.fileEnvName).toBe('APP_SECRETS');
  });

  it('rejects an unknown backend type rather than guessing', () => {
    expect(() => parseConfig({ backends: { x: { type: 'hashicorp' } }, apps: {} }))
      .toThrow(ConfigError);
  });
});
