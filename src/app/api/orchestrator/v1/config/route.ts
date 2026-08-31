import { getPipelineSettings, toWorkerConfig } from "@/lib/pipeline/config"
import { requireOrchestrator, requireWorkerSecret } from "@/lib/secrets"

export async function GET(request: Request) {
  const unauthorized = await requireOrchestrator(request)
  if (unauthorized) return unauthorized
  const invalidWorker = await requireWorkerSecret(request)
  if (invalidWorker) return invalidWorker
  const config = toWorkerConfig(await getPipelineSettings())
  return Response.json(config, {
    headers: {
      "Cache-Control": "private, max-age=0, no-store",
      ETag: `"${config.version}"`,
    },
  })
}
