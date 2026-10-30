import { readFileSync, existsSync, watch, FSWatcher, statSync } from 'node:fs';
import { extname } from 'node:path';
import * as yaml from 'js-yaml';
import { parseConfig, SecretsConfig, ConfigError } from './schema';
import { log } from '../log';

export interface LoadedConfig {
  config: SecretsConfig;
  source: 'file' | 'module-config';
  path?: string;
}

function fromFile(path: string): LoadedConfig {
  if (!existsSync(path)) throw new ConfigError([`configFile: no such file: ${path}`]);
  const text = readFileSync(path, 'utf8');
  let raw: unknown;
  try {
    raw = extname(path).toLowerCase() === '.json' ? JSON.parse(text) : yaml.load(text);
  } catch (e) {
    throw new ConfigError([`configFile: could not parse ${path}: ${(e as Error).message}`]);
  }
  return { config: parseConfig(raw), source: 'file', path };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): LoadedConfig {
  const file = (env.configFile ?? '').trim();
  if (!file) {
    // Secret MAPPINGS are structured; a flat key-value store cannot express them, and
    // the one thing that must never go in module config is a value.
    const raw: Record<string, unknown> = {};
    if (env.logLevel) raw.logLevel = env.logLevel;
    if (env.refreshSeconds) raw.refreshSeconds = Number(env.refreshSeconds);
    const config = parseConfig(raw);
    log.warn(
      'no configFile set - pm2-secrets is idle. Point it at a config file: ' +
        'pm2 set pm2-secrets:configFile /etc/pm2-secrets/config.yaml',
    );
    return { config, source: 'module-config' };
  }
  const loaded = fromFile(file);
  log.info('configuration loaded', {
    path: loaded.path,
    backends: Object.keys(loaded.config.backends),
    apps: Object.keys(loaded.config.apps),
  });
  return loaded;
}

export function watchConfigFile(path: string, onChange: (c: LoadedConfig) => void): FSWatcher | null {
  // Deliberately NOT fs.watch. An editor, `sed -i`, or a config-management tool writes a
  // temp file and renames it over the target, which replaces the inode. fs.watch follows
  // the inode, so it fires for that rename and is then permanently dead - verified: zero
  // events for every edit after the first. Polling identity (inode + mtime + size) is
  // slower to notice and never stops working.
  let last: string | null = null;
  const probe = (): string | null => {
    try {
      const st = statSync(path);
      return `${st.ino}:${st.mtimeMs}:${st.size}`;
    } catch {
      return null;
    }
  };
  last = probe();

  const timer = setInterval(() => {
    const now = probe();
    if (now === null || now === last) return;
    last = now;
    try {
      onChange(fromFile(path)); log.info('configuration reloaded', { path });
    } catch (err) {
      log.error('config reload failed, keeping previous configuration', {
        path, error: (err as Error).message,
      });
    }
  }, 2000);
  timer.unref?.();

  // Shaped like an FSWatcher so callers need not care which mechanism is used.
  return { close: () => clearInterval(timer) } as unknown as FSWatcher;
}
