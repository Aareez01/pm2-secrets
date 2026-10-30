import { mkdir, writeFile, rename, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Pm2Client, ApplyMethod } from '../pm2/client';
import { Pm2Process } from '../pm2/types';
import { log } from '../log';

/**
 * Two ways to deliver secrets, with genuinely different security properties.
 *
 *   mode: "env"  - merge the values into pm2_env.env. Simple, works with any app, and
 *                  NOT private: `pm2 env`, `pm2 jlist` and (after `pm2 save`) a
 *                  world-readable dump.pm2 all expose the value in plaintext.
 *
 *   mode: "file" - write the values to a 0600 JSON file owned by this user and inject
 *                  only its PATH. Keeps values out of pm2_env entirely, at the cost of
 *                  the app having to read the file.
 *
 * "env" is the default because it works with apps as they are. The exposure is warned
 * about once at boot rather than buried, because the module's whole purpose is security
 * and a user who does not know this would be worse off than before.
 */

export type InjectMode = 'env' | 'file';

export interface InjectResult {
  applied: number;
  method: ApplyMethod;
}

function methodFor(proc: Pm2Process): ApplyMethod {
  // A fork app has no sibling to take traffic, so a reload is not available to it.
  return (proc.pm2_env?.exec_mode ?? '').startsWith('cluster')
    ? 'reloadProcessId'
    : 'restartProcessId';
}

export async function writeSecretFile(
  dir: string,
  app: string,
  env: Record<string, string>,
): Promise<string> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const target = join(dir, `${app}.json`);
  const tmp = `${target}.${process.pid}.tmp`;
  // Written restrictively BEFORE it holds anything, so there is no window where the
  // file exists with secrets in it and permissive bits.
  await writeFile(tmp, JSON.stringify(env), { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, target);
  await chmod(dirname(target), 0o700).catch(() => undefined);
  return target;
}

export async function inject(
  client: Pm2Client,
  app: string,
  procs: Pm2Process[],
  env: Record<string, string>,
): Promise<InjectResult> {
  let applied = 0;
  let method: ApplyMethod = 'restartProcessId';

  for (const proc of procs) {
    const pmId = proc.pm_id ?? proc.pm2_env?.pm_id;
    if (typeof pmId !== 'number') continue;
    method = methodFor(proc);
    try {
      await client.applyEnv(pmId, env, method);
      applied++;
    } catch (err) {
      log.error('could not apply secrets to instance', {
        app, pm_id: pmId, method, error: (err as Error).message,
      });
    }
  }

  return { applied, method };
}
