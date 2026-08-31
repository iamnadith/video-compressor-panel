# Backend orchestrator

This Cloudflare Worker is the public processor gateway and one-minute scheduler. It stays within the free-plan CPU budget by forwarding bounded requests only; file discovery, R2 operations, and database work run in the Next.js panel.

## Environment and deployment

Use [`.env.example`](.env.example) as the variable reference. Cloudflare does not deploy that file automatically. Workers Builds supplies both deployment values; no runtime value is committed in `wrangler.jsonc`.

In Cloudflare Workers > Settings > Builds, use these exact values:

```text
Root directory: workers/backend-orchestrator
Build command: leave blank
Deploy command: pnpm run deploy
Production branch: main
```

Under **Build Variables and Secrets**, add:

```text
PANEL_URL=https://your-panel.example.com
ORCHESTRATOR_SECRET=<the exact orchestrator secret saved in the panel settings>
```

Set `ORCHESTRATOR_SECRET` as an encrypted build secret. The deploy script validates both values, passes `PANEL_URL` as a runtime variable, and uploads `ORCHESTRATOR_SECRET` through Wrangler's encrypted `--secrets-file` mechanism. The temporary secrets file is permission-restricted and deleted after every deployment.

The root directory must contain this `wrangler.jsonc`; it is a Cloudflare Workers Builds setting, not a Worker runtime environment variable.

For a manual deployment outside Workers Builds, set both values in the shell before running `pnpm run deploy`:

```powershell
cd workers/backend-orchestrator
pnpm install
$env:PANEL_URL = "https://your-panel.example.com"
$env:ORCHESTRATOR_SECRET = "the-secret-from-dashboard-settings"
pnpm run deploy
```

`PANEL_URL` is the Vercel origin only, for example `https://compressor.example.com` (no `/api/orchestrator` suffix). `ORCHESTRATOR_SECRET` must match the value saved in Dashboard > Settings. `wrangler.jsonc` is the custom build/deployment configuration: it uses `src/index.ts`, the existing `video-compressor-panel` Worker name, and a one-minute cron. It does not set an explicit CPU limit, so it can deploy on Cloudflare's Free plan.

For local development, copy `.env.example` to `.dev.vars` and run `pnpm exec wrangler dev`. `.dev.vars` is ignored by Git. The root `pnpm-workspace.yaml` already includes this Worker, so `pnpm --dir workers/backend-orchestrator run typecheck` is available from the repository root.

Processors receive only non-secret runtime compression settings and signed, expiring object URLs.
