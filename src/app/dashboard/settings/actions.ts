"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireUser } from "@/lib/auth"
import { query } from "@/lib/db"
import { hashSharedSecret } from "@/lib/secrets"

const presets = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow", "placebo"] as const

export type SettingsState = { ok?: boolean; message?: string; errors?: Record<string, string[]> }

const r2Schema = z.object({
  r2_account_id: z.string().trim().min(1, "R2 account ID is required.").max(120),
  r2_access_key_id: z.string().trim().min(1, "R2 access key is required.").max(200),
  r2_secret_access_key: z.string().trim().max(300).optional().default(""),
  r2_bucket: z.string().trim().min(1, "R2 bucket is required.").max(120),
})

const routingSchema = z.object({
  orchestrator_url: z.union([z.literal(""), z.url()]),
  ingest_prefix: z.string().trim().min(1).max(120),
  claimed_prefix: z.string().trim().min(1).max(120),
  processed_prefix: z.string().trim().min(1).max(120),
})

const compressionSchema = z.object({
  max_resolution: z.coerce.number().int().min(144).max(4320),
  target_size_mb: z.coerce.number().int().min(50).max(10000),
  minimum_input_size_mb: z.coerce.number().int().min(0).max(10000),
  ffmpeg_preset: z.enum(presets),
  audio_bitrate_kbps: z.coerce.number().int().min(64).max(512),
  minimum_video_bitrate_kbps: z.coerce.number().int().min(50).max(10000),
})

const leaseSchema = z.object({
  lease_seconds: z.coerce.number().int().min(30).max(3600),
  worker_stale_seconds: z.coerce.number().int().min(30).max(3600),
  max_attempts: z.coerce.number().int().min(1).max(25),
})

const gatewaySecretsSchema = z.object({
  worker_secret: z.string().trim().optional().default("").refine((value) => !value || value.length >= 16, "Worker secret must be at least 16 characters."),
  orchestrator_secret: z.string().trim().optional().default("").refine((value) => !value || value.length >= 16, "Orchestrator secret must be at least 16 characters."),
})

function formValues(formData: FormData) {
  return Object.fromEntries(formData.entries())
}

function validationState(result: { error: { flatten: () => { fieldErrors: Record<string, string[]> } } }): SettingsState {
  return { errors: result.error.flatten().fieldErrors, message: "Review the highlighted fields." }
}

async function updateSettings(sql: string, values: unknown[], message: string): Promise<SettingsState> {
  try {
    const result = await query(sql, values)
    if (result.rowCount !== 1) return { message: "Pipeline settings row is missing. Apply the PostgreSQL migration first." }
  } catch (error) {
    console.error("Failed to save pipeline settings", error)
    return { message: error instanceof Error ? error.message : "The database update failed." }
  }
  revalidatePath("/dashboard/settings")
  revalidatePath("/dashboard")
  return { ok: true, message }
}

export async function saveR2SettingsAction(_state: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireUser()
  const result = r2Schema.safeParse(formValues(formData))
  if (!result.success) return validationState(result)

  return updateSettings(
    `update public.pipeline_settings
        set r2_account_id = $1::text,
            r2_access_key_id = $2::text,
            r2_secret_access_key = case when nullif($3::text, '') is null then r2_secret_access_key else $3::text end,
            r2_bucket = $4::text,
            updated_at = now(),
            updated_by = $5::uuid
      where id = 1`,
    [result.data.r2_account_id, result.data.r2_access_key_id, result.data.r2_secret_access_key, result.data.r2_bucket, user.id],
    "R2 settings saved.",
  )
}

export async function saveRoutingSettingsAction(_state: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireUser()
  const result = routingSchema.safeParse(formValues(formData))
  if (!result.success) return validationState(result)

  return updateSettings(
    `update public.pipeline_settings
        set orchestrator_url = nullif($1::text, ''),
            ingest_prefix = $2::text,
            claimed_prefix = $3::text,
            processed_prefix = $4::text,
            updated_at = now(),
            updated_by = $5::uuid
      where id = 1`,
    [result.data.orchestrator_url, result.data.ingest_prefix, result.data.claimed_prefix, result.data.processed_prefix, user.id],
    "Routing settings saved.",
  )
}

export async function saveCompressionSettingsAction(_state: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireUser()
  const result = compressionSchema.safeParse(formValues(formData))
  if (!result.success) return validationState(result)

  return updateSettings(
    `update public.pipeline_settings
        set max_resolution = $1::integer,
            target_size_mb = $2::integer,
            minimum_input_size_mb = $3::integer,
            ffmpeg_preset = $4::text,
            audio_bitrate_kbps = $5::integer,
            minimum_video_bitrate_kbps = $6::integer,
            updated_at = now(),
            updated_by = $7::uuid
      where id = 1`,
    [
      result.data.max_resolution,
      result.data.target_size_mb,
      result.data.minimum_input_size_mb,
      result.data.ffmpeg_preset,
      result.data.audio_bitrate_kbps,
      result.data.minimum_video_bitrate_kbps,
      user.id,
    ],
    "Compression settings saved.",
  )
}

export async function saveLeaseSettingsAction(_state: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireUser()
  const result = leaseSchema.safeParse(formValues(formData))
  if (!result.success) return validationState(result)

  return updateSettings(
    `update public.pipeline_settings
        set lease_seconds = $1::integer,
            worker_stale_seconds = $2::integer,
            max_attempts = $3::integer,
            updated_at = now(),
            updated_by = $4::uuid
      where id = 1`,
    [result.data.lease_seconds, result.data.worker_stale_seconds, result.data.max_attempts, user.id],
    "Lease and retry settings saved.",
  )
}

export async function saveGatewaySecretsAction(_state: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireUser()
  const result = gatewaySecretsSchema.safeParse(formValues(formData))
  if (!result.success) return validationState(result)

  const current = await query<{ worker_secret_hash: string | null; orchestrator_secret_hash: string | null }>(
    "select worker_secret_hash, orchestrator_secret_hash from public.pipeline_settings where id = 1",
  )
  if (!current.rows[0]) return { message: "Pipeline settings row is missing. Apply the PostgreSQL migration first." }
  if (!result.data.worker_secret && !current.rows[0].worker_secret_hash) {
    return { errors: { worker_secret: ["Worker secret is required the first time."] }, message: "Enter both initial gateway secrets." }
  }
  if (!result.data.orchestrator_secret && !current.rows[0].orchestrator_secret_hash) {
    return { errors: { orchestrator_secret: ["Orchestrator secret is required the first time."] }, message: "Enter both initial gateway secrets." }
  }

  const workerHash = result.data.worker_secret ? await hashSharedSecret(result.data.worker_secret, "worker") : null
  const orchestratorHash = result.data.orchestrator_secret ? await hashSharedSecret(result.data.orchestrator_secret, "orchestrator") : null
  return updateSettings(
    `update public.pipeline_settings
        set worker_secret_hash = coalesce($1::text, worker_secret_hash),
            worker_secret_updated_at = case when $1::text is null then worker_secret_updated_at else now() end,
            orchestrator_secret_hash = coalesce($2::text, orchestrator_secret_hash),
            orchestrator_secret_updated_at = case when $2::text is null then orchestrator_secret_updated_at else now() end,
            updated_at = now(),
            updated_by = $3::uuid
      where id = 1`,
    [workerHash, orchestratorHash, user.id],
    "Gateway secrets saved.",
  )
}
