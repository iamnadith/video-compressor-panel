"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireUser } from "@/lib/auth"
import { query } from "@/lib/db"
import { getPipelineSettings } from "@/lib/pipeline/config"
import { outputKey } from "@/lib/pipeline/keys"
import { headObject } from "@/lib/r2"

type RetryJob = {
  id: string
  source_key: string
  source_etag: string
  source_size: number
  claimed_key: string | null
  state: string
}

export type RetryState = { ok?: boolean; message?: string }

const retrySchema = z.object({ job_id: z.uuid() })

export async function retryJobAction(_state: RetryState, formData: FormData): Promise<RetryState> {
  await requireUser()
  const parsed = retrySchema.safeParse({ job_id: formData.get("job_id") })
  if (!parsed.success) return { message: "The retry request is invalid." }

  const jobResult = await query<RetryJob>(
    "select id,source_key,source_etag,source_size,claimed_key,state from public.jobs where id = $1",
    [parsed.data.job_id],
  )
  const job = jobResult.rows[0]
  if (!job) return { message: "Job not found." }
  if (!['failed', 'cancelled'].includes(job.state)) {
    return { message: "Only failed or cancelled jobs can be retried." }
  }

  const replacement = await query<{ id: string; state: string }>(
    `select id,state
     from public.jobs
     where source_key = $1 and id <> $2
       and state in ('queued','claiming','claimed','processing','uploading','completed')
     limit 1`,
    [job.source_key, job.id],
  )
  if (replacement.rows[0]) {
    return { message: "This source already has another active or completed job." }
  }

  let inputKey: string | null = null
  let inputEtag = job.source_etag
  try {
    const candidates = [job.source_key, job.claimed_key].filter((key, index, keys): key is string => Boolean(key) && keys.indexOf(key) === index)
    for (const candidate of candidates) {
      const object = await headObject(candidate)
      if (object?.ContentLength === Number(job.source_size)) {
        inputKey = candidate
        if (candidate === job.source_key && object.ETag) inputEtag = object.ETag.replaceAll('"', '')
        break
      }
    }
  } catch (error) {
    return { message: error instanceof Error ? error.message : "The input object could not be verified." }
  }
  if (!inputKey) {
    return { message: "The original input is no longer available at its verified size." }
  }

  const settings = await getPipelineSettings()
  const normalizedOutputKey = outputKey(job.source_key, settings.ingest_prefix, settings.processed_prefix)
  const updated = await query(
    `update public.jobs
     set state = 'queued'::public.job_state,
         source_etag = $2,
         claimed_key = $3,
         output_key = $4,
         output_etag = null,
         output_size = null,
         assigned_worker_id = null,
         claim_token = null,
         leased_until = null,
         attempt_count = 0,
         progress = 0,
         current_pass = null,
         error_code = null,
         error_message = null,
         claimed_at = null,
         started_at = null,
         completed_at = null,
         failed_at = null,
         updated_at = now()
     where id = $1 and state in ('failed','cancelled')
     returning id`,
    [job.id, inputEtag, inputKey, normalizedOutputKey],
  )
  if (updated.rowCount !== 1) return { message: "The job changed before it could be retried." }

  await query(
    `insert into public.pipeline_events (level,kind,message,job_id,details)
     values ('info'::public.event_level,'job.retried','Job manually queued for another processing attempt.',$1,$2::jsonb)`,
    [job.id, JSON.stringify({ input_key: inputKey })],
  )
  revalidatePath("/dashboard/jobs")
  revalidatePath("/dashboard")
  return { ok: true, message: "Job queued for retry." }
}
