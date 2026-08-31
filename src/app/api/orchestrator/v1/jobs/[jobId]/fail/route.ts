import { failSchema, parseJson } from "@/lib/pipeline/schemas"
import { requireOrchestrator } from "@/lib/secrets"
import { createAdminClient } from "@/lib/db-client"
import { requireWorkerToken } from "@/lib/worker-token"

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const unauthorized = await requireOrchestrator(request)
  if (unauthorized) return unauthorized
  const parsed = await parseJson(request, failSchema)
  if (parsed.response) return parsed.response
  const invalidToken = await requireWorkerToken(request, parsed.data.worker_id)
  if (invalidToken) return invalidToken
  const { jobId } = await context.params
  const { data, error } = await createAdminClient().rpc("fail_pipeline_job", {
    p_job_id: jobId,
    p_worker_id: parsed.data.worker_id,
    p_claim_token: parsed.data.claim_token,
    p_error_code: parsed.data.error_code,
    p_error_message: parsed.data.error_message,
    p_retryable: parsed.data.retryable,
  })
  if (error) return Response.json({ error: "failure_report_failed", message: error.message }, { status: 500 })
  if (!data) return Response.json({ error: "claim_lost" }, { status: 409 })
  return Response.json({ ok: true })
}
