"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireUser } from "@/lib/auth"
import { hashSharedSecret } from "@/lib/secrets"
import { createAdminClient } from "@/lib/db-client"

const presets = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow", "placebo"] as const

const settingsSchema = z.object({
  r2_account_id: z.string().trim().min(1, "R2 account ID is required.").max(120),
  r2_access_key_id: z.string().trim().min(1, "R2 access key is required.").max(200),
  r2_secret_access_key: z.string().trim().max(300).optional().default(""),
  r2_bucket: z.string().trim().min(1, "R2 bucket is required.").max(120),
  orchestrator_url: z.union([z.literal(""), z.url()]),
  ingest_prefix: z.string().trim().min(1).max(120),
  claimed_prefix: z.string().trim().min(1).max(120),
  processed_prefix: z.string().trim().min(1).max(120),
  max_resolution: z.coerce.number().int().min(144).max(4320),
  target_size_mb: z.coerce.number().int().min(50).max(10000),
  minimum_input_size_mb: z.coerce.number().int().min(0).max(10000),
  ffmpeg_preset: z.enum(presets),
  audio_bitrate_kbps: z.coerce.number().int().min(64).max(512),
  minimum_video_bitrate_kbps: z.coerce.number().int().min(50).max(10000),
  lease_seconds: z.coerce.number().int().min(30).max(3600),
  worker_stale_seconds: z.coerce.number().int().min(30).max(3600),
  max_attempts: z.coerce.number().int().min(1).max(25),
  worker_secret: z.string().optional().default("").refine((value) => !value || value.length >= 16, "Worker secret must be at least 16 characters."),
  orchestrator_secret: z.string().optional().default("").refine((value) => !value || value.length >= 16, "Orchestrator secret must be at least 16 characters."),
})

export type SettingsState = { ok?: boolean; message?: string; errors?: Record<string, string[]> }

export async function saveSettingsAction(_state: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireUser()
  const raw = Object.fromEntries(formData.entries())
  const result = settingsSchema.safeParse(raw)
  if (!result.success) return { errors: result.error.flatten().fieldErrors, message: "Review the highlighted settings." }

  const { worker_secret, orchestrator_secret, r2_secret_access_key, ...settings } = result.data
  const admin = createAdminClient()
  const { data: current, error: currentError } = await admin
    .from("pipeline_settings")
    .select("r2_secret_access_key,worker_secret_hash,orchestrator_secret_hash")
    .eq("id", 1)
    .single()
  if (currentError || !current) return { message: "Pipeline settings are not initialized. Apply the PostgreSQL migration first." }
  const missing: Record<string, string[]> = {}
  if (!r2_secret_access_key && !current.r2_secret_access_key) missing.r2_secret_access_key = ["R2 secret access key is required the first time."]
  if (!worker_secret && !current.worker_secret_hash) missing.worker_secret = ["Worker secret is required the first time."]
  if (!orchestrator_secret && !current.orchestrator_secret_hash) missing.orchestrator_secret = ["Orchestrator secret is required the first time."]
  if (Object.keys(missing).length) return { errors: missing, message: "Enter the initial R2 and gateway secrets." }
  const now = new Date().toISOString()
  const update: Record<string, string | number | null> = {
    ...settings,
    orchestrator_url: settings.orchestrator_url || null,
    updated_at: now,
    updated_by: user.id,
  }
  update.r2_account_id = settings.r2_account_id
  update.r2_access_key_id = settings.r2_access_key_id
  update.r2_bucket = settings.r2_bucket
  if (r2_secret_access_key) update.r2_secret_access_key = r2_secret_access_key
  if (worker_secret) {
    update.worker_secret_hash = await hashSharedSecret(worker_secret, "worker")
    update.worker_secret_updated_at = now
  }
  if (orchestrator_secret) {
    update.orchestrator_secret_hash = await hashSharedSecret(orchestrator_secret, "orchestrator")
    update.orchestrator_secret_updated_at = now
  }

  const { error } = await admin.from("pipeline_settings").update(update).eq("id", 1)
  if (error) return { message: error.message }
  revalidatePath("/dashboard/settings")
  revalidatePath("/dashboard")
  return { ok: true, message: "Settings saved. Processors will refresh automatically." }
}
