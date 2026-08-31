import { completeSchema, parseJson } from "@/lib/pipeline/schemas"
import { createJobTransferUrls } from "@/lib/r2"
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
  const { data: job, error } = await createAdminClient()
    .from("jobs")
    .select("claimed_key,output_key,leased_until,state")
    .eq("id", jobId)
    .eq("assigned_worker_id", parsed.data.worker_id)
    .eq("claim_token", parsed.data.claim_token)
    .in("state", ["claimed", "processing", "uploading"])
    .single()
  if (error || !job?.claimed_key || !job.output_key || new Date(job.leased_until).getTime() < Date.now()) {
    return Response.json({ error: "claim_lost" }, { status: 409 })
  }
  const transfer = await createJobTransferUrls(job.claimed_key, job.output_key)
  return Response.json({
    download_url: transfer.downloadUrl,
    upload_url: transfer.uploadUrl,
    upload_content_type: "video/mp4",
    url_expires_in_seconds: transfer.expiresIn,
  })
}
