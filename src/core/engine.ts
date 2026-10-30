import { SecretsConfig, backendNameFor } from '../config/schema';
import { Pm2Client } from '../pm2/client';
import { Pm2Process, isModule } from '../pm2/types';
import { SecretBackend, FileBackend, SecretsManagerBackend, SsmBackend } from '../backends';
import { resolveAll } from './resolver';
import { inject, writeSecretFile } from './injector';
import { log, logOnce } from '../log';
import { forgetAll } from '../mask';
import * as metrics from './metrics';

export const SELF_NAME = 'pm2-secrets';

export class Engine {
  private backends = new Map<string, SecretBackend>();
  private fingerprints = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly client: Pm2Client,
    private config: SecretsConfig,
  ) {
    this.buildBackends();
  }

  private buildBackends(): void {
    this.backends.clear();
    for (const [name, b] of Object.entries(this.config.backends)) {
      if (b.type === 'file') this.backends.set(name, new FileBackend(name, b.path));
      else if (b.type === 'aws-secrets-manager')
        this.backends.set(name, new SecretsManagerBackend(name, b.region));
      else this.backends.set(name, new SsmBackend(name, b.region));
    }
  }

  updateConfig(next: SecretsConfig): void {
    this.config = next;
    this.buildBackends();
    // Values may be gone from the new config; stop masking what we no longer hold, and
    // force a fresh comparison rather than trusting fingerprints from another mapping.
    forgetAll();
    this.fingerprints.clear();
  }

  start(): void {
    const envMode = Object.values(this.config.apps).some((a) => a.mode === 'env');
    if (envMode) {
      // Said plainly and early. A user who does not know this is worse off than before,
      // because they believe the secret is now protected when it is more exposed.
      log.warn(
        'secrets injected in "env" mode are visible to anyone who can run pm2: ' +
          '`pm2 env`, `pm2 jlist`, and `dump.pm2` after `pm2 save` (mode 0664) all show ' +
          'them in plaintext. Use mode: "file" to keep values out of pm2_env.',
      );
    }
    void this.cycle();
    this.timer = setInterval(() => void this.cycle(), this.config.refreshSeconds * 1000);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  /** Resolve every app's secrets and apply only what actually changed. */
  async cycle(): Promise<void> {
    if (this.stopped || this.running) return;
    this.running = true;
    metrics.inc('refreshes');
    metrics.set('lastRefreshAt', Date.now());
    try {
      let list: Pm2Process[];
      try {
        list = await this.client.list();
      } catch (err) {
        log.warn('pm2 list failed', { error: (err as Error).message });
        return;
      }

      const apps = Object.keys(this.config.apps);
      metrics.set('appsManaged', apps.length);

      for (const app of apps) {
        if (app === SELF_NAME) continue;
        const procs = list.filter(
          (p) => p.name === app && !isModule(p) && p.pm2_env?.status === 'online');
        if (procs.length === 0) continue;
        await this.handleApp(app, procs);
      }
    } finally {
      this.running = false;
    }
  }

  private async handleApp(app: string, procs: Pm2Process[]): Promise<void> {
    const appCfg = this.config.apps[app];
    if (!appCfg) return;
    const backend = this.backends.get(backendNameFor(this.config, app));
    if (!backend) return;

    let resolved;
    try {
      resolved = await resolveAll(backend, appCfg.secrets);
      metrics.set('secretsResolved', Object.keys(resolved.env).length);
    } catch (err) {
      metrics.inc('resolveFailures');
      // Keep whatever the app already has: a failed fetch must never blank a working
      // app's configuration.
      logOnce(`resolve:${app}:${(err as Error).message}`, 'error',
        'could not resolve secrets; leaving the app as it is', {
          app, backend: backend.name, error: (err as Error).message });
      return;
    }

    const previous = this.fingerprints.get(app);
    if (previous === resolved.fingerprint) return;       // nothing rotated

    const first = previous === undefined;
    if (first && !this.config.injectOnStart) {
      this.fingerprints.set(app, resolved.fingerprint);
      return;
    }

    let env: Record<string, string>;
    if (appCfg.mode === 'file') {
      const path = await writeSecretFile(this.config.secretsDir, app, resolved.env);
      env = { [appCfg.fileEnvName]: path };
    } else {
      env = resolved.env;
    }

    const res = await inject(this.client, app, procs, env);
    if (res.applied === 0) {
      metrics.inc('applyFailures');
      return;    // do NOT record the fingerprint, so the next cycle tries again
    }

    this.fingerprints.set(app, resolved.fingerprint);
    if (!first) metrics.inc('rotationsApplied');
    log.info(first ? 'secrets injected' : 'rotated secrets applied', {
      app,
      mode: appCfg.mode,
      instances: res.applied,
      method: res.method === 'reloadProcessId' ? 'reload (zero downtime)' : 'restart',
      // The fingerprint, never the values.
      fingerprint: resolved.fingerprint,
    });
  }
}
