# pm2-secrets — Requirements

**Status:** Built (0.1.0) · **Date:** 2026-10-31 · **Licence:** MIT
**Verified against:** PM2 7.1.1 (source inspection **and** experiment)

Shared platform findings live in **`pm2-ops-contract`** (`00-platform-and-contract.md`),
notably **F14** (how env injection works) and **F15** (what it exposes). Read those first.

## 1. Problem

Secrets reach PM2 apps as plaintext `.env` files on the box: not rotated, not audited, easy to
commit by accident, and baked into images. Nothing in PM2 reads a vault.

## 2. What changed after measuring

The original gap analysis said this module "removes plaintext `.env` files from servers" and
required that values be "masked in `pm2 env` and `pm2 show` output".

**Both claims are wrong, and F15 shows why.** Anything in `pm2_env.env` is readable through
`pm2 env`, `pm2 jlist`, and — after `pm2 save` — `dump.pm2` at mode **0664, world-readable**. A
module cannot mask PM2's own output while injecting into the structure PM2 prints.

The honest position, which the README states plainly:

- Fetching from a vault is a real gain: central rotation, audit, nothing secret in git.
- A direct env injection is nonetheless **less private locally** than a `.env` at 0600.
- So there are two modes, and the trade is the user's to make.

## 3. Requirements

- **REQ-SE-01** — Resolve `ENV_NAME → reference` per app from a configured backend.
- **REQ-SE-02** — v1 backends: `file` (JSON), `aws-secrets-manager`, `aws-ssm`. The AWS SDK is an
  **optional** dependency, loaded lazily, with an error naming the package to install.
- **REQ-SE-03** — **Never accept an access key in configuration.** Credentials come from the
  SDK's default chain. A long-lived key in a config file is what a secret manager exists to remove.
- **REQ-SE-04** — A missing secret is an **error**, never an empty string: injecting `''` starts
  the app and breaks it in a way that looks like an application bug.
- **REQ-SE-05** — Inject via `pm2.Client.executeRemote(..., { id, env })` (F14). The public
  `pm2.restart(name, { env })` reads `env` as an environment *name* and refuses. Refuse to start
  if `executeRemote` is absent rather than failing later.
- **REQ-SE-06** — Cluster apps **reload** (zero downtime); fork apps restart.
- **REQ-SE-07** — Re-apply only when a **fingerprint** changes, so there is no restart loop.
  Log the fingerprint, never a value.
- **REQ-SE-08** — A failed fetch leaves the app untouched. An outage must never blank a working
  app's configuration.
- **REQ-SE-09** — `mode: file` writes `{secretsDir}/{app}.json` at 0600 in a 0700 directory and
  injects only the path, keeping values out of `pm2_env` entirely.
- **REQ-SE-10** — ~~Mask values in `pm2 env` output~~ — **not achievable** (F15). Instead: warn
  once at boot, mask the module's own logs including crash output, and offer REQ-SE-09.
- **REQ-SE-11** — Config is a file, not module config: mappings are structured, and the one thing
  that must never sit in `module_conf.json` is a value.

## 4. Acceptance criteria

Covered by lab scenario 50, all passing:

1. A running app with no secret receives one without being restarted from its ecosystem file.
2. Rotating the value in the backend updates the app automatically.
3. A cluster app is **reloaded**, not restarted.
4. The module's logs never contain a secret value.
5. In `file` mode the app receives a path, the file is 0600, and the value never appears in
   `pm2 jlist`.

## 5. Open questions

| # | Question | Default |
|---|---|---|
| Q1 | HashiCorp Vault, Azure Key Vault, GCP Secret Manager? | After demand. The backend interface is two methods |
| Q2 | Should `file` mode be the default? | No — it requires app changes. Warned about loudly instead |
| Q3 | Tighten `dump.pm2` permissions on the user's behalf? | No — too invasive. Warn, and document `mode: file` |
