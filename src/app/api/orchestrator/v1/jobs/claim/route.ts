import { getPipelineSettings, toWorkerConfig } from "@/lib/pipeline/config"
import { reconcilePipeline } from "@/lib/pipeline/reconcile"
import { parseJson, workerIdentitySchema } from "@/lib/pipeline/schemas"
import type { PipelineJob } from "@/lib/pipeline/types"
import { createJobTransferUrls, headObject } from "@/lib/r2"
import { requireOrchestrator } from "@/lib/secrets"
import { createAdminClient } from "@/lib/db-client"
import { requireWorkerToken } from "@/lib/worker-token"

async function claim(workerId: string, leaseSeconds: number) {
  const { data, error } = await createAdminClient().rpc("claim_next_pipeline_job", {
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  })
  if (error) throw error
  return data as PipelineJob | null
}

export async function POST(request: Request) {
  const unauthorized = await requireOrchestrator(request)
  if (unauthorized) return unauthorized
  const parsed = await parseJson(request, workerIdentitySchema)
  if (parsed.response) return parsed.response
  const invalidToken = await requireWorkerToken(request, parsed.data.worker_id)
  if (invalidToken) return invalidToken

  const settings = await getPipelineSettings()
  let job = await claim(parsed.data.worker_id, settings.lease_seconds)
  if (!job) {
    await reconcilePipeline("worker-empty-queue")
    job = await claim(parsed.data.worker_id, settings.lease_seconds)
  }
  if (!job) {
    return Response.json({ job: null, config: toWorkerConfig(settings) })
  }

  if (!job.claim_token || !job.output_key) {
    return Response.json({ error: "invalid_claim_state" }, { status: 500 })
  }

  try {
    const source = await headObject(job.source_key)
    if (!source || source.ContentLength !== Number(job.source_size)) {
      throw new Error("Source object verification failed.")
    }

    // The database lease is the atomic claim. Keep the multi-gigabyte object in
    // place and sign it directly instead of blocking this request on an R2 copy.
    const inputKey = job.source_key
    const admin = createAdminClient()
    const { data: ready, error: readyError } = await admin.rpc("mark_pipeline_job_ready", {
      p_job_id: job.id,
      p_worker_id: parsed.data.worker_id,
      p_claim_token: job.claim_token,
      p_claimed_key: inputKey,
      p_output_key: job.output_key,
    })
    if (readyError) throw readyError
    if (!ready) throw new Error("Claim ownership changed before storage preparation completed.")

    const transfer = await createJobTransferUrls(inputKey, job.output_key)
    return Response.json({
      job: {
        id: job.id,
        claim_token: job.claim_token,
        source_name: job.source_key.split("/").at(-1),
        source_size: Number(job.source_size),
        output_name: job.output_key.split("/").at(-1),
        download_url: transfer.downloadUrl,
        upload_url: transfer.uploadUrl,
        upload_content_type: "video/mp4",
        url_expires_in_seconds: transfer.expiresIn,
        attempt: job.attempt_count,
        settings: job.settings_snapshot,
      },
      config: toWorkerConfig(settings),
    })
  } catch (error) {
    await createAdminClient().rpc("fail_pipeline_job", {
      p_job_id: job.id,
      p_worker_id: parsed.data.worker_id,
      p_claim_token: job.claim_token,
      p_error_code: "claim_storage_failed",
      p_error_message: error instanceof Error ? error.message : "Storage claim failed.",
      p_retryable: true,
    })
    return Response.json({
      error: "claim_storage_failed",
      message: error instanceof Error ? error.message : "Storage claim failed.",
    }, { status: 503 })
  }
}
