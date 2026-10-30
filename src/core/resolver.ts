import { createHash } from 'node:crypto';
import { SecretBackend } from '../backends';
import { remember } from '../mask';

/**
 * Turns a mapping of { ENV_NAME: reference } into { ENV_NAME: value }, and gives the set
 * a fingerprint so rotation can be detected without ever comparing or logging values.
 */

export interface ResolvedSet {
  env: Record<string, string>;
  /** Changes if, and only if, some value changed. */
  fingerprint: string;
}

export function fingerprintOf(env: Record<string, string>): string {
  const h = createHash('sha256');
  for (const key of Object.keys(env).sort()) {
    h.update(key).update('\0').update(env[key] as string).update('\0');
  }
  return h.digest('hex').slice(0, 16);
}

export async function resolveAll(
  backend: SecretBackend,
  mapping: Record<string, string>,
): Promise<ResolvedSet> {
  const refs = [...new Set(Object.values(mapping))];
  const values = refs.length > 0 ? await backend.resolve(refs) : new Map<string, string>();

  const env: Record<string, string> = {};
  for (const [envName, ref] of Object.entries(mapping)) {
    const v = values.get(ref);
    if (v === undefined) {
      // Never inject an empty string for a missing secret: the app would start and fail
      // in a way that looks like a bug in the app.
      throw new Error(`secret "${ref}" (for ${envName}) was not returned by the backend`);
    }
    env[envName] = v;
    remember(v);   // so it can never appear in this module's own logs
  }

  return { env, fingerprint: fingerprintOf(env) };
}
