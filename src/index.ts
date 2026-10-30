/**
 * pm2-secrets entry point.
 *
 * Fetches secrets from a vault and injects them into PM2 apps, re-applying when they
 * rotate - zero downtime for cluster apps, a restart for fork apps.
 */
import { FSWatcher } from 'node:fs';
import { loadConfig, watchConfigFile } from './config/load';
import { ConfigError } from './config/schema';
import { Pm2Client } from './pm2/client';
import { Engine } from './core/engine';
import { registerMetrics } from './core/metrics';
import { log, setLogLevel } from './log';
import { mask } from './mask';

async function main(): Promise<void> {
  const loaded = loadConfig();
  setLogLevel(loaded.config.logLevel);
  registerMetrics();

  const client = new Pm2Client();
  await client.connect();

  const engine = new Engine(client, loaded.config);
  engine.start();

  let watcher: FSWatcher | null = null;
  if (loaded.source === 'file' && loaded.path) {
    watcher = watchConfigFile(loaded.path, (next) => {
      setLogLevel(next.config.logLevel);
      engine.updateConfig(next.config);
    });
  }

  const shutdown = (signal: string) => {
    log.info('shutting down', { signal });
    engine.stop();
    watcher?.close();
    client.disconnect();
    setTimeout(() => process.exit(0), 100).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Crash output is the most likely place for a secret to escape, so it is masked too.
process.on('unhandledRejection', (r) =>
  log.error('unhandled rejection', { reason: mask(String(r)) }));
process.on('uncaughtException', (e) =>
  log.error('uncaught exception', { error: mask(e.message), stack: mask(e.stack ?? '') }));

main().catch((err) => {
  if (err instanceof ConfigError) {
    log.error('startup aborted: invalid configuration', { issues: err.issues });
  } else {
    log.error('startup failed', { error: mask((err as Error).message) });
  }
  process.exit(1);
});
