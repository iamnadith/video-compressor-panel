# Backend orchestrator

This Cloudflare Worker is the public processor gateway and one-minute scheduler. It stays within the free-plan CPU budget by forwarding bounded requests only; file discovery, R2 operations, and database work run in the Next.js panel.

## Environment and deployment

Use [`.env.example`](.env.example) as the variable reference. Cloudflare does not deploy that file automatically. For a deployed Worker, configure the two encrypted runtime secrets from this directory:

In Cloudflare Workers > Settings > Builds, use these exact values:

```text
Root directory: workers/backend-orchestrator
Build command: leave blank
Deploy command: pnpm run deploy
Production branch: main
```

The root directory must contain this `wrangler.jsonc`; it is a Cloudflare Workers Builds setting, not a Worker runtime environment variable.

```powershell
cd workers/backend-orchestrator
pnpm install
pnpm exec wrangler deploy
pnpm exec wrangler secret put PANEL_URL
pnpm exec wrangler secret put ORCHESTRATOR_SECRET
pnpm exec wrangler deploy
```

`PANEL_URL` is the Vercel origin only, for example `https://compressor.example.com` (no `/api/orchestrator` suffix). `ORCHESTRATOR_SECRET` must match the value saved in Dashboard > Settings. `wrangler.jsonc` is the custom build/deployment configuration: it uses `src/index.ts`, the `video-pipeline-orchestrator` Worker name, and a one-minute cron. It does not set an explicit CPU limit, so it can deploy on Cloudflare's Free plan.

For local development, copy `.env.example` to `.dev.vars` and run `pnpm exec wrangler dev`. `.dev.vars` is ignored by Git. The root `pnpm-workspace.yaml` already includes this Worker, so `pnpm --dir workers/backend-orchestrator run typecheck` is available from the repository root.

Processors receive only non-secret runtime compression settings and signed, expiring object URLs.
