import "server-only"

import { createAdminClient } from "@/lib/db-client"
import { listPrefixPage } from "@/lib/r2"
import { getPipelineSettings } from "@/lib/pipeline/config"

export type DashboardJob = {
  id: string; source_key: string; output_key?: string | null; state: string; progress: number
  current_pass?: string | null; source_size: number; output_size?: number | null
  attempt_count?: number; max_attempts?: number; error_message?: string | null
  discovered_at?: string; updated_at: string; workers?: { display_name?: string }[] | null
}
export type DashboardEvent = {
  id: number; level: string; kind: string; message: string; details?: Record<string, unknown>
  created_at: string; jobs?: { source_key?: string }[] | null; workers?: { display_name?: string }[] | null
}
export type DashboardWorker = {
  id: string; instance_id: string; display_name: string; hostname: string; platform: string
  architecture?: string | null; agent_version: string; state: string; last_seen_at: string
  first_seen_at: string; last_error?: string | null; current_job_id?: string | null
  capabilities?: Record<string, unknown>
}

export const jobStatusFilters = ["claimed", "processing", "completed", "failed"] as const
export type JobStatusFilter = "all" | (typeof jobStatusFilters)[number]

export const JOBS_PAGE_SIZE = 25

export type StorageDirectory = {
  id: "ingest" | "processing" | "output"
  label: string
  prefix: string
  fileCount: number
  totalBytes: number
}

export async function getDashboardData() {
  const admin = createAdminClient()
  const activeStates = ["claiming", "claimed", "processing", "uploading"]
  const [queued, active, completed, failed, workers, recentJobs, events] = await Promise.all([
    admin.from("jobs").select("id", { count: "exact", head: true }).eq("state", "queued"),
    admin.from("jobs").select("id", { count: "exact", head: true }).in("state", activeStates),
    admin.from("jobs").select("id", { count: "exact", head: true }).eq("state", "completed"),
    admin.from("jobs").select("id", { count: "exact", head: true }).eq("state", "failed"),
    admin.from("workers").select("id", { count: "exact", head: true }).in("state", ["online", "idle", "busy"]),
    admin.from<DashboardJob>("jobs").select("id,source_key,state,progress,current_pass,source_size,updated_at,workers(display_name)").order("updated_at", { ascending: false }).limit(8),
    admin.from<DashboardEvent>("pipeline_events").select("id,level,kind,message,created_at").order("created_at", { ascending: false }).limit(6),
  ])
  const firstError = [queued, active, completed, failed, workers, recentJobs, events].find((result) => result.error)?.error
  if (firstError) throw firstError
  return {
    counts: {
      queued: queued.count ?? 0,
      active: active.count ?? 0,
      completed: completed.count ?? 0,
      failed: failed.count ?? 0,
      workers: workers.count ?? 0,
    },
    recentJobs: (recentJobs.data ?? []) as DashboardJob[],
    events: (events.data ?? []) as DashboardEvent[],
  }
}

function jobsQuery(status: JobStatusFilter, page: number) {
  const query = createAdminClient()
    .from<DashboardJob>("jobs")
    .select("id,source_key,output_key,state,progress,current_pass,source_size,output_size,attempt_count,max_attempts,error_message,discovered_at,updated_at,workers(display_name)")
    .order("updated_at", { ascending: false })
    .range((page - 1) * JOBS_PAGE_SIZE, page * JOBS_PAGE_SIZE - 1)
  if (status !== "all") query.eq("state", status)
  return query
}

function jobsCountQuery(status: JobStatusFilter) {
  const query = createAdminClient().from("jobs").select("id", { count: "exact", head: true })
  if (status !== "all") query.eq("state", status)
  return query
}

export async function getJobs(page: number, status: JobStatusFilter) {
  const requestedPage = Math.max(1, Math.floor(page))
  const [jobsResult, countResult] = await Promise.all([
    jobsQuery(status, requestedPage),
    jobsCountQuery(status),
  ])
  if (jobsResult.error) throw jobsResult.error
  if (countResult.error) throw countResult.error

  const total = countResult.count ?? 0
  const totalPages = Math.ceil(total / JOBS_PAGE_SIZE)
  const currentPage = totalPages ? Math.min(requestedPage, totalPages) : 1
  let data = jobsResult.data ?? []

  if (currentPage !== requestedPage) {
    const corrected = await jobsQuery(status, currentPage)
    if (corrected.error) throw corrected.error
    data = corrected.data ?? []
  }

  return {
    jobs: data as DashboardJob[],
    total,
    totalPages,
    page: currentPage,
    pageSize: JOBS_PAGE_SIZE,
  }
}

export async function getWorkers() {
  const { data, error } = await createAdminClient()
    .from<DashboardWorker>("workers")
    .select("id,instance_id,display_name,hostname,platform,architecture,agent_version,state,last_seen_at,first_seen_at,last_error,current_job_id,capabilities")
    .in("state", ["online", "idle", "busy"])
    .order("last_seen_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as DashboardWorker[]
}

export async function getStorageSummary() {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from<DashboardJob>("jobs")
    .select("state,source_size,output_size,source_key,claimed_key,output_key")
  if (error) throw error
  const jobs = (data ?? []) as DashboardJob[]
  return {
    ingestBytes: jobs.filter((job: DashboardJob) => job.state === "queued").reduce((sum: number, job: DashboardJob) => sum + Number(job.source_size), 0),
    claimedBytes: jobs.filter((job: DashboardJob) => ["claiming", "claimed", "processing", "uploading"].includes(job.state)).reduce((sum: number, job: DashboardJob) => sum + Number(job.source_size), 0),
    processedBytes: jobs.filter((job: DashboardJob) => job.state === "completed").reduce((sum: number, job: DashboardJob) => sum + Number(job.source_size), 0),
    sourceBytes: jobs.reduce((sum: number, job: DashboardJob) => sum + Number(job.source_size), 0),
    outputBytes: jobs.reduce((sum: number, job: DashboardJob) => sum + Number(job.output_size ?? 0), 0),
    jobs,
  }
}

async function getPrefixStats(prefix: string) {
  let continuationToken: string | undefined
  let fileCount = 0
  let totalBytes = 0

  do {
    const page = await listPrefixPage(prefix, continuationToken, 500)
    fileCount += page.objects.length
    totalBytes += page.objects.reduce((sum, object) => sum + Number(object.size), 0)
    continuationToken = page.nextContinuationToken
  } while (continuationToken)

  return { fileCount, totalBytes }
}

export async function getStorageDirectories(): Promise<StorageDirectory[]> {
  const settings = await getPipelineSettings()
  const directories = [
    { id: "ingest", label: "Ingest", prefix: settings.ingest_prefix },
    { id: "processing", label: "Processing", prefix: settings.claimed_prefix },
    { id: "output", label: "Output", prefix: settings.processed_prefix },
  ] as const
  const stats = await Promise.all(directories.map(async (directory) => ({
    ...directory,
    ...(await getPrefixStats(directory.prefix)),
  })))
  return stats
}

export async function getActivity() {
  const { data, error } = await createAdminClient()
    .from<DashboardEvent>("pipeline_events")
    .select("id,level,kind,message,details,created_at,jobs(source_key),workers(display_name)")
    .order("created_at", { ascending: false })
    .limit(300)
  if (error) throw error
  return (data ?? []) as DashboardEvent[]
}
