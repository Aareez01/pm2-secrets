# pm2-secrets

Fetch secrets from a vault and inject them into PM2 apps — with rotation, and zero-downtime
reload for cluster apps.

```bash
pm2 install pm2-secrets
pm2 set pm2-secrets:configFile /etc/pm2-secrets/config.yaml
```

```yaml
refreshSeconds: 300

backends:
  aws: { type: aws-secrets-manager, region: eu-west-1 }

apps:
  api:
    secrets:
      DB_PASSWORD: prod/api/db
      STRIPE_KEY:  prod/api/stripe
    mode: env          # or "file" — read the next section before choosing
```

Your app gets `DB_PASSWORD` and `STRIPE_KEY` without a `.env` file on the box. When the secret
rotates in the vault, the app picks up the new value automatically — reloaded, not restarted,
if it runs in cluster mode.

---

## Read this before choosing `mode: env`

**Anything injected into PM2's environment is visible to anyone who can run `pm2`.** This is a
property of PM2, not of this module, and it is measured rather than assumed:

| Surface | What it shows |
| --- | --- |
| `pm2 env <id>` | the value, in plaintext |
| `pm2 jlist` | the value |
| `pm2 save` → `$PM2_HOME/dump.pm2` | the value, on disk, **mode 0664 — world-readable** |

So "no more plaintext `.env` files" is only half the story. Fetching from a vault is a real
gain — central rotation, an audit trail, nothing secret in git, no secret baked into an image —
but *locally*, a direct env injection is **less private** than a `.env` file at `0600`.

This module cannot mask PM2's own output; it is injecting into the structure PM2 prints. What it
does instead is tell you at boot, never log a value itself, and offer a mode that avoids the
problem.

### `mode: file`

```yaml
apps:
  api:
    secrets: { DB_PASSWORD: prod/api/db }
    mode: file
    fileEnvName: SECRETS_FILE     # default
```

Values are written to `{secretsDir}/api.json` at **0600** in a **0700** directory, and only the
*path* is injected. Nothing secret enters `pm2_env`, so `pm2 env`, `pm2 jlist` and `dump.pm2`
show a filename.

The cost is that your app must read the file:

```js
const secrets = JSON.parse(fs.readFileSync(process.env.SECRETS_FILE, 'utf8'));
```

`env` is the default because it works with apps exactly as they are. `file` is the right choice
if the host has other users, or if `pm2 save` is part of your boot process.

> Injection is additive: PM2 merges into the existing environment. Switching an app from `env`
> to `file` leaves the previously injected variables in place until that app is restarted from
> its ecosystem file.

---

## Backends

| Type | Config | Notes |
| --- | --- | --- |
| `file` | `path` | JSON object of `reference → value`. For development, and for hosts where something else already drops a secrets file |
| `aws-secrets-manager` | `region` | `GetSecretValue` per reference |
| `aws-ssm` | `region` | `GetParameters` with decryption, batched 10 at a time |

The AWS SDK is an **optional** dependency — most users of this suite are not on AWS, and nobody
should download a cloud SDK to read a local file. If an AWS backend is configured without it,
the error names the package to install.

**This module never accepts an access key in its own configuration.** Credentials come from the
SDK's default chain — instance role, task role, web identity. A long-lived key sitting in a
config file is precisely the thing a secret manager exists to remove.

## Rotation

Every `refreshSeconds` the secrets are re-fetched and fingerprinted. **Nothing happens unless a
value actually changed** — no restart loop, no churn. When one does change:

- **cluster apps** reload (`reloadProcessId`) — zero downtime
- **fork apps** restart, because there is no sibling instance to take traffic

A failed fetch leaves the app exactly as it is. A backend outage must never blank a working
app's configuration, and a missing secret is an error rather than an empty string — injecting
`''` would start the app and break it in a way that looks like an application bug.

## How injection works

`pm2.restart(name, { env })` does **not** do this: PM2 reads `env` as an environment *name*
(`--env production`) and refuses. The daemon RPC does accept an env object, so this module calls
`pm2.Client.executeRemote('restartProcessId' | 'reloadProcessId', { id, env })`.

That is an **internal PM2 surface**, not a documented API. It is pinned by the lab and should be
re-verified when upgrading PM2. The module refuses to start if `executeRemote` is absent rather
than failing mysteriously later.

## Troubleshooting

**Nothing is injected** — check `pm2 logs pm2-secrets`. Apps are matched by PM2 name, must be
`online`, and the module skips itself and other modules.

**Values are not updating** — the fingerprint only changes when a value changes. Confirm the
vault really rotated it; the log records a fingerprint, never a value.

**`pm2` commands hang forever** — your `PM2_HOME` path is too long. PM2 binds
`$PM2_HOME/rpc.sock`, and Linux caps socket paths at 107 characters.

## Requirements

Node 18 or newer — tested on 18, 20, 22, 24 and 26 — with PM2 5 or newer.

## Development

```bash
npm install && npm run build && npm test
```

## License

MIT
