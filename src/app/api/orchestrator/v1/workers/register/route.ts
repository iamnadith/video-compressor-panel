import { getPipelineSettings, toWorkerConfig } from "@/lib/pipeline/config"
import { parseJson, registerWorkerSchema } from "@/lib/pipeline/schemas"
import { requireOrchestrator, requireWorkerSecret } from "@/lib/secrets"
import { createAdminClient } from "@/lib/db-client"
import { issueWorkerToken } from "@/lib/worker-token"

export async function POST(request: Request) {
  const unauthorized = await requireOrchestrator(request)
  if (unauthorized) return unauthorized
  const invalidWorker = await requireWorkerSecret(request)
  if (invalidWorker) return invalidWorker
  const parsed = await parseJson(request, registerWorkerSchema)
  if (parsed.response) return parsed.response

  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null
  const { data: worker, error } = await createAdminClient().rpc("register_pipeline_worker", {
    p_instance_id: parsed.data.instance_id,
    p_display_name: parsed.data.display_name,
    p_hostname: parsed.data.hostname,
    p_platform: parsed.data.platform,
    p_architecture: parsed.data.architecture,
    p_agent_version: parsed.data.agent_version,
    p_capabilities: parsed.data.capabilities,
    p_last_ip: forwarded,
    p_metadata: parsed.data.metadata,
  })
  if (error) return Response.json({ error: "registration_failed", message: error.message }, { status: 500 })
  if (worker.state === "disabled") return Response.json({ error: "worker_disabled" }, { status: 403 })

  return Response.json({
    worker_id: worker.id,
    worker_token: await issueWorkerToken(worker.id, worker.instance_id),
    state: worker.state,
    config: toWorkerConfig(await getPipelineSettings()),
  })
}
