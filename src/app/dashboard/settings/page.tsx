import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { SettingsForm } from "@/app/dashboard/settings/settings-form"
import { createAdminClient } from "@/lib/db-client"
import { requireUser } from "@/lib/auth"

export const metadata = { title: "Settings" }

export default async function SettingsPage() {
  await requireUser()
  const { data: settings, error } = await createAdminClient()
    .from("pipeline_settings")
    .select("r2_account_id,r2_access_key_id,r2_bucket,orchestrator_url,ingest_prefix,claimed_prefix,processed_prefix,max_resolution,target_size_mb,minimum_input_size_mb,ffmpeg_preset,audio_bitrate_kbps,minimum_video_bitrate_kbps,lease_seconds,worker_stale_seconds,max_attempts,worker_secret_updated_at,orchestrator_secret_updated_at,updated_at")
    .eq("id", 1)
    .single()
  if (error) throw error
  if (!settings) throw new Error("Pipeline settings row is missing. Apply the PostgreSQL migration.")
  return (
    <>
      <PageHeader
        title="Settings"
        description="Database-backed settings are versioned and refreshed by processors without redeployment."
        actions={<div className="flex gap-2"><Badge variant={settings.worker_secret_updated_at ? "secondary" : "outline"}>Worker secret {settings.worker_secret_updated_at ? "set" : "missing"}</Badge><Badge variant={settings.orchestrator_secret_updated_at ? "secondary" : "outline"}>Orchestrator secret {settings.orchestrator_secret_updated_at ? "set" : "missing"}</Badge></div>}
      />
      <SettingsForm settings={settings as Parameters<typeof SettingsForm>[0]["settings"]} />
    </>
  )
}
