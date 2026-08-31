import { completeSchema, parseJson } from "@/lib/pipeline/schemas"
import { deleteClaimedObject, headObject } from "@/lib/r2"
import { requireOrchestrator } from "@/lib/secrets"
import { createAdminClient } from "@/lib/db-client"
import { requireWorkerToken } from "@/lib/worker-token"

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const unauthorized = await requireOrchestrator(request)
  if (unauthorized) return unauthorized
  const parsed = await parseJson(request, completeSchema)
  if (parsed.response) return parsed.response
  const invalidToken = await requireWorkerToken(request, parsed.data.worker_id)
  if (invalidToken) return invalidToken
  const { jobId } = await context.params
  const admin = createAdminClient()
  const { data: job, error: jobError } = await admin
    .from("jobs")
    .select("output_key,claimed_key,source_size,settings_snapshot")
    .eq("id", jobId)
    .eq("assigned_worker_id", parsed.data.worker_id)
    .eq("claim_token", parsed.data.claim_token)
    .single()
  if (jobError || !job?.output_key) return Response.json({ error: "claim_lost" }, { status: 409 })

  const output = await headObject(job.output_key)
  if (!output || !output.ContentLength) {
    return Response.json({ error: "output_not_verified" }, { status: 409 })
  }

  const targetSizeMb = Number(job.settings_snapshot?.target_size_mb)
  const compressionExpected = Number.isFinite(targetSizeMb)
    && Number(job.source_size) > targetSizeMb * 1024 * 1024
  if (compressionExpected && output.ContentLength >= Number(job.source_size)) {
    const { error: failError } = await admin.rpc("fail_pipeline_job", {
      p_job_id: jobId,
      p_worker_id: parsed.data.worker_id,
      p_claim_token: parsed.data.claim_token,
      p_error_code: "output_not_compressed",
      p_error_message: "The encoded output is not smaller than the source file.",
      p_retryable: true,
    })
    if (failError) {
      return Response.json({ error: "output_validation_failed", message: failError.message }, { status: 500 })
    }
    return Response.json({ error: "output_not_compressed" }, { status: 409 })
  }

  const { data, error } = await admin.rpc("complete_pipeline_job", {
    p_job_id: jobId,
    p_worker_id: parsed.data.worker_id,
    p_claim_token: parsed.data.claim_token,
    p_output_etag: (output.ETag ?? "").replaceAll('"', ""),
    p_output_size: output.ContentLength,
  })
  if (error) return Response.json({ error: "completion_failed", message: error.message }, { status: 500 })
  if (!data) return Response.json({ error: "claim_lost" }, { status: 409 })

  if (job.claimed_key) {
    try {
      await deleteClaimedObject(job.claimed_key, job.output_key)
    } catch {
      // Reconciliation retries cleanup; completion remains durable.
    }
  }
  return Response.json({ ok: true })
}
