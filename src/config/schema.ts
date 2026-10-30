import { z } from 'zod';

const backend = z.discriminatedUnion('type', [
  z.object({ type: z.literal('file'), path: z.string().min(1) }),
  z.object({ type: z.literal('aws-secrets-manager'), region: z.string().optional() }),
  z.object({ type: z.literal('aws-ssm'), region: z.string().optional() }),
]);

const appConfig = z.object({
  /**
   * ENV_NAME -> reference in the backend. The reference is opaque: a Secrets Manager
   * secret id, an SSM parameter name, or a key in the secrets file.
   */
  secrets: z.record(z.string().min(1)).refine((m) => Object.keys(m).length > 0, {
    message: 'an app with no secrets listed has nothing to inject',
  }),
  /** 'env' is convenient; 'file' keeps values out of pm2_env. See injector.ts. */
  mode: z.enum(['env', 'file']).default('env'),
  /** Env var that will carry the path, in file mode. */
  fileEnvName: z.string().default('SECRETS_FILE'),
  backend: z.string().optional(),
});

export const configSchema = z.object({
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  refreshSeconds: z.number().positive().default(300),
  /** Where 'file' mode writes. Created 0700. */
  secretsDir: z.string().default('/run/pm2-secrets'),
  /** Apply values on first sight, or wait for a rotation. */
  injectOnStart: z.boolean().default(true),
  backends: z.record(backend).default({}),
  apps: z.record(appConfig).default({}),
}).superRefine((c, ctx) => {
  const names = Object.keys(c.backends);
  for (const [app, cfg] of Object.entries(c.apps)) {
    const chosen = cfg.backend ?? names[0];
    if (!chosen) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['apps', app, 'backend'],
        message: 'no backends are defined, so there is nowhere to read secrets from' });
    } else if (!c.backends[chosen]) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['apps', app, 'backend'],
        message: `no backend named "${chosen}" is defined` });
    }
  }
});

export type SecretsConfig = z.infer<typeof configSchema>;
export type AppSecretsConfig = z.infer<typeof appConfig>;

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`invalid pm2-secrets configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

export function parseConfig(raw: unknown): SecretsConfig {
  const r = configSchema.safeParse(raw);
  if (r.success) return r.data;
  throw new ConfigError(
    r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  );
}

export function backendNameFor(cfg: SecretsConfig, app: string): string {
  return cfg.apps[app]?.backend ?? Object.keys(cfg.backends)[0] as string;
}
