export const counters = {
  appsManaged: 0,
  secretsResolved: 0,
  refreshes: 0,
  rotationsApplied: 0,
  resolveFailures: 0,
  applyFailures: 0,
  lastRefreshAt: 0,
};
export type CounterName = keyof typeof counters;
export function inc(n: CounterName, by = 1): void { counters[n] += by; }
export function set(n: CounterName, v: number): void { counters[n] = v; }
export function registerMetrics(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const io = require('@pm2/io');
    for (const k of Object.keys(counters) as CounterName[]) {
      io.metric({ name: `secrets.${k}`, value: () => counters[k] });
    }
  } catch { /* optional */ }
}
