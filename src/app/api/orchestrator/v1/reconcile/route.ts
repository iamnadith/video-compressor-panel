import { reconcilePipeline } from "@/lib/pipeline/reconcile"
import { requireOrchestrator } from "@/lib/secrets"

export async function POST(request: Request) {
  const unauthorized = await requireOrchestrator(request)
  if (unauthorized) return unauthorized
  try {
    return Response.json(await reconcilePipeline("cloudflare-cron"))
  } catch (error) {
    return Response.json({
      error: "reconcile_failed",
      message: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 })
  }
}

