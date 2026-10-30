/**
 * Keeps secret VALUES out of this module's own output.
 *
 * It cannot keep them out of PM2's: once a value is in `pm2_env.env` it is visible via
 * `pm2 env`, `pm2 jlist`, and `dump.pm2` after `pm2 save`. That is a property of PM2, not
 * something a module can mask. All this does is ensure we never add to the problem.
 */
const registry = new Set<string>();

export function remember(value: string): void {
  if (value && value.length >= 4) registry.add(value);
}

export function forgetAll(): void {
  registry.clear();
}

/** Replace any known secret value appearing anywhere in a string. */
export function mask(text: string): string {
  let out = text;
  for (const v of registry) {
    if (v && out.includes(v)) out = out.split(v).join('[redacted]');
  }
  return out;
}

/** A stable, non-reversible identifier for logging which value changed. */
export function fingerprint(value: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require('node:crypto');
  return (createHash('sha256').update(value).digest('hex') as string).slice(0, 12);
}
