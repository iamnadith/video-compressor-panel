import "server-only"

import path from "node:path"

import { query } from "@/lib/db"
import { getPipelineSettings } from "@/lib/pipeline/config"
import { outputKey } from "@/lib/pipeline/keys"
import { deleteClaimedObject, getR2Config, listPrefixPage } from "@/lib/r2"
import { createAdminClient } from "@/lib/db-client"

const VIDEO_EXTENSIONS = new Set([".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv"])
type ClaimedJob = { id: string; state: string; claimed_key: string | null }
type ProcessedJob = {
  id: string
  state: string
  assigned_worker_id: string | null
  claimed_key: string | null
  output_key: string | null
  source_size: number
  settings_snapshot: Record<string, string | number> | null
}

function relativeKey(key: string, prefix: string) {
  const normalized = `${prefix.replace(/\/$/, "")}/`
  return key.startsWith(normalized) ? key.slice(normalized.length) : key
}

async function readPrefixPage(prefix: string) {
  const admin = createAdminClient()
  // Settings can change the prefixes. Initialize the cursor lazily so a
  // renamed prefix is still audited instead of failing with a missing row.
  const { error: initializeError } = await admin
    .from("reconcile_cursors")
    .upsert({ prefix }, { onConflict: "prefix", ignoreDuplicates: true })
  if (initializeError) throw initializeError
  const { data: cursor, error: cursorError } = await admin
    .from("reconcile_cursors")
    .select("continuation_token,completed_cycles")
    .eq("prefix", prefix)
    .single()
  if (cursorError) throw cursorError

  const page = await listPrefixPage(prefix, cursor?.continuation_token ?? undefined)
  return { page, completedCycles: BigInt(cursor?.completed_cycles ?? 0) }
}

async function commitPrefixPage(
  prefix: string,
  page: Awaited<ReturnType<typeof listPrefixPage>>,
  completedCycles: bigint,
) {
  const admin = createAdminClient()
  const { error: updateError } = await admin.from("reconcile_cursors").upsert({
    prefix,
    continuation_token: page.nextContinuationToken ?? null,
    completed_cycles: (completedCycles + BigInt(page.cycleComplete ? 1 : 0)).toString(),
    updated_at: new Date().toISOString(),
  })
  if (updateError) throw updateError
}

export async function reconcilePipeline(triggerSource: string) {
  const admin = createAdminClient()
  const { data: leaseToken, error: leaseError } = await admin
    .rpc("begin_pipeline_reconcile", { p_lease_seconds: 900 })
  if (leaseError) throw leaseError
  if (!leaseToken) return { skipped: true, reason: "reconcile_already_running" }

  let settings: Awaited<ReturnType<typeof getPipelineSettings>>
  let r2Bucket: string
  let run: { id: number }
  let requeued = 0
  try {
    const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    await query(
      `update public.reconcile_runs
       set status = 'failed',
           error_message = 'Reconciliation run did not finish and was recovered by a later audit.',
           completed_at = coalesce(completed_at, now())
       where status = 'running' and started_at < $1`,
      [staleBefore],
    )

    const { data: expired, error: expiredError } = await admin
      .rpc("reconcile_expired_pipeline_leases")
    if (expiredError) throw expiredError
    requeued = Number(expired ?? 0)

    settings = await getPipelineSettings()
    r2Bucket = (await getR2Config()).r2Bucket
    const { data, error } = await admin
      .from("reconcile_runs")
      .insert({ trigger_source: triggerSource })
      .select("id")
      .single()
    if (error) throw error
    run = data as { id: number }
  } catch (error) {
    await admin.rpc("finish_pipeline_reconcile", { p_lease_token: leaseToken })
    throw error
  }

  let discovered = 0
  let repaired = 0

  try {
    const ingest = await readPrefixPage(settings.ingest_prefix)
    const candidates = ingest.page.objects.filter((object) => {
      const extension = path.posix.extname(object.key).toLowerCase()
      return VIDEO_EXTENSIONS.has(extension)
        && object.size > settings.minimum_input_size_mb * 1024 * 1024
    })

    if (candidates.length) {
      const rows = candidates.map((object) => {
        const etag = object.etag || `${object.size}-${object.lastModified?.toISOString() ?? "unknown"}`
        const relative = relativeKey(object.key, settings.ingest_prefix)
        return {
          source_bucket: r2Bucket,
          source_key: object.key,
          source_etag: etag,
          source_size: object.size,
          source_last_modified: object.lastModified?.toISOString() ?? null,
          claimed_key: `${settings.claimed_prefix.replace(/\/$/, "")}/${relative}`,
          output_key: outputKey(
            object.key,
            settings.ingest_prefix,
            settings.processed_prefix,
          ),
          state: "queued",
          max_attempts: settings.max_attempts,
        }
      })
      const { data, error } = await admin
        .from("jobs")
        .upsert(rows, {
          onConflict: "source_bucket,source_key,source_etag",
          ignoreDuplicates: true,
        })
        .select("id")
      if (error) throw error
      discovered = data?.length ?? 0
    }
    await commitPrefixPage(
      settings.ingest_prefix,
      ingest.page,
      ingest.completedCycles,
    )

    const [claimed, processed] = await Promise.all([
      readPrefixPage(settings.claimed_prefix),
      readPrefixPage(settings.processed_prefix),
    ])

    const claimedKeys = claimed.page.objects.map((object) => object.key)
    const claimedJobsResult = claimedKeys.length
      ? await admin
        .from("jobs")
        .select("id,state,claimed_key")
        .in("claimed_key", claimedKeys)
      : { data: [] as ClaimedJob[], error: null }
    if (claimedJobsResult.error) throw claimedJobsResult.error
    const claimedJobs = (claimedJobsResult.data ?? []) as ClaimedJob[]
    const claimedJobsByKey = new Map((claimedJobs ?? []).map((job) => [job.claimed_key, job]))

    for (const object of claimed.page.objects) {
      const job = claimedJobsByKey.get(object.key)
      if (job?.state === "claiming") {
        const { error: repairError } = await admin
          .from("jobs")
          .update({ state: "claimed", updated_at: new Date().toISOString() })
          .eq("id", job.id)
          .eq("state", "claiming")
        if (repairError) throw repairError
        repaired += 1
      } else if (job?.state === "completed") {
        await deleteClaimedObject(object.key)
        repaired += 1
      }
    }
    await commitPrefixPage(
      settings.claimed_prefix,
      claimed.page,
      claimed.completedCycles,
    )

    const processedKeys = processed.page.objects.map((object) => object.key)
    const processedJobsResult = processedKeys.length
      ? await admin
        .from("jobs")
        .select("id,state,assigned_worker_id,claimed_key,output_key,source_size,settings_snapshot")
        .in("output_key", processedKeys)
      : { data: [] as ProcessedJob[], error: null }
    if (processedJobsResult.error) throw processedJobsResult.error
    const processedJobs = (processedJobsResult.data ?? []) as ProcessedJob[]
    const processedJobsByKey = new Map((processedJobs ?? []).map((job) => [job.output_key, job]))

    for (const object of processed.page.objects) {
      const job = processedJobsByKey.get(object.key)
      const targetSizeMb = Number(job?.settings_snapshot?.target_size_mb ?? settings.target_size_mb)
      const compressionExpected = Boolean(
        job
        && Number.isFinite(targetSizeMb)
        && Number(job.source_size) > targetSizeMb * 1024 * 1024,
      )
      const outputVerified = !compressionExpected || object.size < Number(job?.source_size)
      const outputAccepted = Boolean(job && outputVerified && job.state !== "cancelled")
      if (job && outputVerified && job.state !== "completed" && job.state !== "cancelled") {
        const { error: repairError } = await admin
          .from("jobs")
          .update({
            state: "completed",
            progress: 100,
            output_etag: object.etag,
            output_size: object.size,
            leased_until: null,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id)
        if (repairError) throw repairError
        if (job.assigned_worker_id) {
          await admin.from("workers").update({
            state: "idle",
            current_job_id: null,
            last_seen_at: new Date().toISOString(),
          }).eq("id", job.assigned_worker_id)
        }
        repaired += 1
      }
      if (job?.claimed_key && outputAccepted) {
        try {
          await deleteClaimedObject(job.claimed_key, object.key)
        } catch {
          // Keep reconciliation durable; a later cycle retries completed-input cleanup.
        }
      }
    }
    await commitPrefixPage(
      settings.processed_prefix,
      processed.page,
      processed.completedCycles,
    )

    await query(
      `update public.reconcile_runs
       set discovered_count = $1,
           repaired_count = $2,
           requeued_count = $3,
           status = 'completed',
           completed_at = now()
       where id = $4`,
      [discovered, repaired, requeued, run.id],
    )

    await admin.rpc("finish_pipeline_reconcile", { p_lease_token: leaseToken })

    return { discovered, repaired, requeued, settingsVersion: settings.updated_at }
  } catch (error) {
    await query(
      `update public.reconcile_runs
       set status = 'failed',
           error_message = $1,
           completed_at = now()
       where id = $2`,
      [error instanceof Error ? error.message.slice(0, 2000) : "Unknown error", run.id],
    )
    await admin.rpc("finish_pipeline_reconcile", { p_lease_token: leaseToken })
    throw error
  }
}
