# Video Compressor Panel

A durable video-compression pipeline for Cloudflare R2. The dashboard runs on Vercel, any compatible PostgreSQL database provides authentication and pipeline state, a lightweight Cloudflare Worker acts as the processor gateway and one-minute scheduler, and any number of Python processors can claim and encode videos.

## Architecture

```text
R2 ingest/ -> Vercel panel API + PostgreSQL queue -> R2 claimed/
                         ^                         |
                         |                         v
Cloudflare orchestrator <- processors -> FFmpeg -> R2 processed/
```

- The panel is the only component with the PostgreSQL connection and R2 credentials.
- The Cloudflare Worker only proxies bounded API requests and triggers reconciliation every minute, keeping its work within the Free-plan CPU limits.
- A processor connects only to the orchestrator. It needs exactly `ORCHESTRATOR_URL` and `WORKER_SHARED_SECRET`.
- Atomic database claims, leases, stable processor identities, object ETags, and durable local checkpoints prevent two healthy workers from processing the same source object.
- Runtime compression, R2, and lease settings live in PostgreSQL. Processors receive current settings through the orchestrator, so changes do not require redeployment.

## Local setup

Requirements: Node.js 20+, pnpm 10.20+, Python 3.9+, FFmpeg/FFprobe, any compatible PostgreSQL database, and an R2 bucket.

```powershell
pnpm install
Copy-Item .env.example .env.local
pnpm run migrate
pnpm dev
```

The migration runner applies every numbered SQL migration transactionally, records checksums, and serializes concurrent runs with a PostgreSQL advisory lock. After it completes, open `http://localhost:3000/setup` and create the first administrator. The authenticated application is rooted at `/dashboard`; there is no `/panel` route.

Configure this single Vercel environment variable from `.env.example`:

- `DATABASE_URL` (use `?sslmode=disable` when connecting through a transaction pooler that requires SSL disabled). The panel also strips libpq SSL query options and enforces `ssl: false` in `pg`.

The custom Next.js deployment uses the repository root as its Vercel project root, `pnpm install` for dependencies, `pnpm build` for the build command, and `pnpm start` for a self-hosted production server. `pnpm build` runs the migration runner before `next build`, so a deployment stops if its database schema cannot be safely upgraded. No panel URL prefix or `/panel` route is required; the dashboard URL is `/dashboard`.

R2 credentials and runtime gateway settings are entered in Dashboard > Settings and stored in PostgreSQL. R2 credentials are used only by the panel; processors receive signed object URLs and current compression settings. Worker and orchestrator secrets are stored as salted hashes; changing the processor secret invalidates existing processor sessions within the short signing-key cache window.

## Cloudflare backend orchestrator

The source is in `workers/backend-orchestrator`. Deploy it to Cloudflare Workers with these deployment values:

```powershell
cd workers/backend-orchestrator
$env:PANEL_URL = "https://your-panel.example.com"
$env:ORCHESTRATOR_SECRET = "the-secret-from-dashboard-settings"
pnpm run deploy
```

For Cloudflare Workers Builds, add `PANEL_URL` and encrypted `ORCHESTRATOR_SECRET` under Build Variables and Secrets. The deploy script promotes them to runtime bindings securely; it never bundles the secret into Worker source. The orchestrator secret must match the value entered in Dashboard > Settings. The deployed Worker is `video-compressor-panel`; the cron in `wrangler.jsonc` runs every minute. The gateway caches only non-secret processor configuration for 60 seconds.

The Worker build entrypoint is `workers/backend-orchestrator/src/index.ts`, configured by `workers/backend-orchestrator/wrangler.jsonc`; deploy commands must be run from `workers/backend-orchestrator` (or passed that directory explicitly).

## Video processors

The processor is in `workers/video-processor` and can run on Windows, macOS, Linux, or GitHub Actions:

```powershell
python -m pip install -r workers/video-processor/requirements.txt
$env:ORCHESTRATOR_URL = "https://your-orchestrator.workers.dev"
$env:WORKER_SHARED_SECRET = "the-secret-from-dashboard-settings"
python workers/video-processor/processor.py
```

Copy `workers/video-processor/.env.example` for the two required processor variables. FFmpeg and FFprobe are not Python packages; install them separately. The durable `.video-processor` directory is created automatically and should be kept on persistent storage.

No processor identity, name, database URL, panel URL, R2 credential, or other setting is configured externally. The processor generates its identity internally and persists it under `.video-processor`; preserve that directory across restarts to resume transfers and jobs safely.

The processor reproduces the supplied two-pass settings: libx264, `scale=-2:height`, AAC audio, and video bitrate `max(minimum_video_kbps, target_size_mb * 8192 / duration - audio_kbps)`. It resumes partial downloads, refreshes expiring signed URLs, heartbeats its lease during transfers and encoding, aborts when ownership is lost, and only reports completion after the panel verifies the R2 output.

## GitHub Actions processor

`.github/workflows/video-processor.yml` is intentionally the only GitHub Actions workflow. Add repository secrets:

- `ORCHESTRATOR_URL`
- `WORKER_SHARED_SECRET`

It runs the processor every 15 minutes and can also be started manually. Each run installs FFmpeg/FFprobe with the `libx264` encoder, polls continuously for up to six hours, and exits ten minutes early so a job in progress can be stopped and requeued safely. The workflow concurrency group prevents overlapping processor runs. It does not deploy the panel or Cloudflare Worker.

## Verification

```powershell
pnpm lint
pnpm exec tsc --noEmit
pnpm --dir workers/backend-orchestrator run typecheck
python -m py_compile workers/video-processor/processor.py
pnpm build
```

Do not commit `.env*`, `.dev.vars`, processor checkpoints, FFmpeg pass logs, local media parts, nested worker dependencies, Wrangler state, or local migration-tool state; all are covered by `.gitignore`.
