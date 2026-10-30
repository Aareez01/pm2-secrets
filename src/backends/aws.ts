import { SecretBackend, SecretError } from './types';

/**
 * AWS Secrets Manager and SSM Parameter Store.
 *
 * The AWS SDK is an OPTIONAL peer dependency, loaded lazily. Most of this suite's users
 * are not on AWS, and nobody should download a cloud SDK to read a secrets file. If the
 * backend is configured without it, the error says exactly what to install.
 *
 * Credentials come from the SDK's default chain - instance role, task role, web identity,
 * shared config. This module never accepts an access key in its own configuration: a
 * long-lived key in a config file is the thing a secret manager exists to remove.
 */

function load(mod: string, backend: string): unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(mod);
  } catch {
    throw new SecretError(
      `the ${backend} backend needs ${mod}, which is an optional dependency. ` +
        `Install it alongside this module: npm install ${mod}`,
      false,
    );
  }
}

export class SecretsManagerBackend implements SecretBackend {
  readonly kind = 'aws-secrets-manager';
  private client: { send(cmd: unknown): Promise<{ SecretString?: string }> } | null = null;

  constructor(readonly name: string, private readonly region?: string) {}

  private get sdk() {
    const m = load('@aws-sdk/client-secrets-manager', this.kind) as {
      SecretsManagerClient: new (o: unknown) => { send(c: unknown): Promise<{ SecretString?: string }> };
      GetSecretValueCommand: new (o: unknown) => unknown;
    };
    this.client ??= new m.SecretsManagerClient(this.region ? { region: this.region } : {});
    return { client: this.client, GetSecretValueCommand: m.GetSecretValueCommand };
  }

  async resolve(refs: string[]): Promise<Map<string, string>> {
    const { client, GetSecretValueCommand } = this.sdk;
    const out = new Map<string, string>();
    // No batch API for GetSecretValue; requests are small and run concurrently.
    await Promise.all(refs.map(async (ref) => {
      try {
        const res = await client.send(new GetSecretValueCommand({ SecretId: ref }));
        if (res.SecretString === undefined) {
          throw new SecretError(`${ref} has no SecretString (binary secrets unsupported)`, false);
        }
        out.set(ref, res.SecretString);
      } catch (err) {
        if (err instanceof SecretError) throw err;
        throw new SecretError(`could not read ${ref}: ${(err as Error).message}`);
      }
    }));
    return out;
  }
}

export class SsmBackend implements SecretBackend {
  readonly kind = 'aws-ssm';
  private client: { send(cmd: unknown): Promise<Record<string, unknown>> } | null = null;

  constructor(readonly name: string, private readonly region?: string) {}

  private get sdk() {
    const m = load('@aws-sdk/client-ssm', this.kind) as {
      SSMClient: new (o: unknown) => { send(c: unknown): Promise<Record<string, unknown>> };
      GetParametersCommand: new (o: unknown) => unknown;
    };
    this.client ??= new m.SSMClient(this.region ? { region: this.region } : {});
    return { client: this.client, GetParametersCommand: m.GetParametersCommand };
  }

  async resolve(refs: string[]): Promise<Map<string, string>> {
    const { client, GetParametersCommand } = this.sdk;
    const out = new Map<string, string>();
    // GetParameters takes at most 10 names per call.
    for (let i = 0; i < refs.length; i += 10) {
      const batch = refs.slice(i, i + 10);
      let res: Record<string, unknown>;
      try {
        res = await client.send(new GetParametersCommand({
          Names: batch, WithDecryption: true,
        }));
      } catch (err) {
        throw new SecretError(`could not read parameters: ${(err as Error).message}`);
      }
      for (const p of (res.Parameters as { Name: string; Value: string }[] ?? [])) {
        out.set(p.Name, p.Value);
      }
      const invalid = res.InvalidParameters as string[] | undefined;
      if (invalid && invalid.length > 0) {
        throw new SecretError(`parameters not found: ${invalid.join(', ')}`, false);
      }
    }
    return out;
  }
}
