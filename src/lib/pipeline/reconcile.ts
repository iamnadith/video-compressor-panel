import "server-only"

import path from "node:path"

import { getPipelineSettings } from "@/lib/pipeline/config"
import { deleteClaimedObject, getR2Config, listPrefixPage } from "@/lib/r2"
import { createAdminClient } from "@/lib/db-client"

const VIDEO_EXTENSIONS = new Set([".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv"])

function relativeKey(key: string, prefix: string) {
  const normalized = `${prefix.replace(/\/$/, "")}/`
  return key.startsWith(normalized) ? key.slice(normalized.length) : key
}

function outputKey(sourceKey: string, sourceEtag: string, ingest: string, processed: string) {
  const relative = relativeKey(sourceKey, ingest)
  const extension = path.posix.extname(relative)
  const stem = extension ? relative.slice(0, -extension.length) : relative
  const identity = sourceEtag.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "object"
  return `${processed.replace(/\/$/, "")}/${stem}--${identity}.mp4`
}

async function readPrefixPage(prefix: string) {
  const admin = createAdminClient()
  const { data: cursor, error: cursorError } = await admin
    .from("reconcile_cursors")
    .select("continuation_token,completed_cycles")
    .eq("prefix", prefix)
    .single()
  if (cursorError) throw cursorError

  const page = await listPrefixPage(prefix, cursor?.continuation_token ?? undefined)
  return { page, completedCycles: cursor?.completed_cycles ?? 0 }
}

async function commitPrefixPage(
  prefix: string,
  page: Awaited<ReturnType<typeof listPrefixPage>>,
  completedCycles: number,
) {
  const admin = createAdminClient()
  const { error: updateError } = await admin.from("reconcile_cursors").upsert({
    prefix,
    continuation_token: page.nextContinuationToken ?? null,
    completed_cycles: completedCycles + (page.cycleComplete ? 1 : 0),
    updated_at: new Date().toISOString(),
  })
  if (updateError) throw updateError
}

export async function reconcilePipeline(triggerSource: string) {
  const admin = createAdminClient()
  const { data: leaseToken, error: leaseError } = await admin
    .rpc("begin_pipeline_reconcile", { p_lease_seconds: 240 })
  if (leaseError) throw leaseError
  if (!leaseToken) return { skipped: true, reason: "reconcile_already_running" }

  let settings: Awaited<ReturnType<typeof getPipelineSettings>>
  let r2Bucket: string
  let run: { id: number }
  try {
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
  let requeued = 0

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
            etag,
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

    for (const object of claimed.page.objects) {
      const { data: job, error } = await admin
        .from("jobs")
        .select("id,state")
        .eq("claimed_key", object.key)
        .maybeSingle()
      if (error) throw error
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

    for (const object of processed.page.objects) {
      const { data: job, error } = await admin
        .from("jobs")
        .select("id,state,assigned_worker_id")
        .eq("output_key", object.key)
        .maybeSingle()
      if (error) throw error
      if (job && job.state !== "completed" && job.state !== "cancelled") {
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
      if (job?.claimed_key && job.state !== "cancelled") {
        try {
          await deleteClaimedObject(job.claimed_key)
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

    const { data: expired, error: expiredError } = await admin
      .rpc("reconcile_expired_pipeline_leases")
    if (expiredError) throw expiredError
    requeued = Number(expired ?? 0)

    await admin.from("reconcile_runs").update({
      discovered_count: discovered,
      repaired_count: repaired,
      requeued_count: requeued,
      status: "completed",
      completed_at: new Date().toISOString(),
    }).eq("id", run.id)

    await admin.rpc("finish_pipeline_reconcile", { p_lease_token: leaseToken })

    return { discovered, repaired, requeued, settingsVersion: settings.updated_at }
  } catch (error) {
    await admin.from("reconcile_runs").update({
      status: "failed",
      error_message: error instanceof Error ? error.message.slice(0, 2000) : "Unknown error",
      completed_at: new Date().toISOString(),
    }).eq("id", run.id)
    await admin.rpc("finish_pipeline_reconcile", { p_lease_token: leaseToken })
    throw error
  }
}
