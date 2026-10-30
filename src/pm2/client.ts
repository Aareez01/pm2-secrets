import { Pm2Process } from './types';

/**
 * PM2 client, including the one call the public API does not expose.
 *
 * `pm2.restart(name, { env })` does NOT inject variables - PM2 reads `env` as an
 * environment NAME and refuses with "Using --env [env] without passing the
 * ecosystem.config.js does not work".
 *
 * The daemon RPC does accept an env object: restartProcessId, reloadProcessId and
 * softReloadProcessId all run Utility.extend(proc.pm2_env.env, opts.env) before acting.
 * Reaching it means going through pm2.Client.executeRemote, which is an INTERNAL surface.
 * That is a deliberate, documented dependency, and one to re-verify on PM2 upgrades.
 */
interface RemoteClient {
  executeRemote(method: string, opts: unknown, cb: (err: Error | null, res?: unknown) => void): void;
}

interface Pm2Api {
  connect(cb: (err: Error | null) => void): void;
  disconnect(): void;
  list(cb: (err: Error | null, list: Pm2Process[]) => void): void;
  Client: RemoteClient;
}

function resolvePm2(): Pm2Api {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('pm2') as Pm2Api;
  } catch (err) {
    throw new Error(
      'could not require("pm2"). pm2-secrets is a PM2 module and needs the pm2 package ' +
        'resolvable from its install directory. Original error: ' + (err as Error).message,
    );
  }
}

export type ApplyMethod = 'reloadProcessId' | 'restartProcessId';

export class Pm2Client {
  private api: Pm2Api | null = null;

  async connect(): Promise<void> {
    const api = resolvePm2();
    await new Promise<void>((res, rej) => api.connect((e) => (e ? rej(e) : res())));
    this.api = api;
    if (typeof api.Client?.executeRemote !== 'function') {
      throw new Error(
        'this PM2 build does not expose Client.executeRemote, which is the only way to ' +
          'inject environment variables into another app. pm2-secrets cannot work here.',
      );
    }
  }

  disconnect(): void {
    try { this.api?.disconnect(); } catch { /* shutting down */ }
  }

  async list(): Promise<Pm2Process[]> {
    const api = this.require();
    return new Promise((res, rej) => api.list((e, l) => (e ? rej(e) : res(l ?? []))));
  }

  /**
   * Merge `env` into an instance and bring it back with the new values.
   *
   * Cluster instances reload (zero downtime); fork instances must restart, because
   * there is no second worker to take traffic.
   */
  async applyEnv(pmId: number, env: Record<string, string>, method: ApplyMethod): Promise<void> {
    const api = this.require();
    await new Promise<void>((resolve, reject) => {
      api.Client.executeRemote(method, { id: pmId, env }, (err) =>
        err ? reject(err) : resolve());
    });
  }

  private require(): Pm2Api {
    if (!this.api) throw new Error('pm2 client not connected');
    return this.api;
  }
}
