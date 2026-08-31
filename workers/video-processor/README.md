# Video processor

The processor needs only an orchestrator URL and the shared processor secret. Use [`.env.example`](.env.example) as the variable reference. It generates a stable local identity, registers itself, downloads through signed URLs, runs the exact two-pass FFmpeg configuration, heartbeats its lease, uploads through a signed URL, and keeps a durable local checkpoint for restart recovery.

```powershell
python -m pip install -r requirements.txt
$env:ORCHESTRATOR_URL = "https://your-orchestrator.workers.dev"
$env:WORKER_SHARED_SECRET = "your-shared-secret"
python processor.py
```

The script path is `workers/video-processor/processor.py`; run it from the repository root or use an absolute path. FFmpeg and FFprobe are external runtime dependencies and must be installed on PATH, including the `libx264` encoder. The processor creates `.video-processor` automatically; preserve that directory between invocations for resumable downloads and job recovery.

There is no processor build or Cloudflare deployment step. GitHub Actions installs and verifies FFmpeg on every fresh Ubuntu runner, then keeps the processor alive for a six-hour job window. It gives the processor a ten-minute shutdown reserve so active work is requeued through the durable lease when the window ends. Self-hosted processors use the same two required variables.

The same agent is used by `.github/workflows/video-processor.yml`.
