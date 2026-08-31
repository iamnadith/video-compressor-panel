import "server-only"

import { createAdminClient } from "@/lib/db-client"
import type { PipelineSettings } from "@/lib/pipeline/types"

const publicColumns = [
  "id",
  "ingest_prefix",
  "claimed_prefix",
  "processed_prefix",
  "max_resolution",
  "target_size_mb",
  "minimum_input_size_mb",
  "ffmpeg_preset",
  "audio_bitrate_kbps",
  "minimum_video_bitrate_kbps",
  "lease_seconds",
  "worker_stale_seconds",
  "max_attempts",
  "updated_at",
].join(",")

export async function getPipelineSettings() {
  const { data, error } = await createAdminClient()
    .from("pipeline_settings")
    .select(publicColumns)
    .eq("id", 1)
    .single()
  if (error) throw error
  return data as unknown as PipelineSettings & { updated_at: string }
}

export function toWorkerConfig(settings: PipelineSettings & { updated_at: string }) {
  return {
    version: settings.updated_at,
    compression: {
      max_resolution: settings.max_resolution,
      target_size_mb: settings.target_size_mb,
      ffmpeg_preset: settings.ffmpeg_preset,
      audio_bitrate_kbps: settings.audio_bitrate_kbps,
      minimum_video_bitrate_kbps: settings.minimum_video_bitrate_kbps,
    },
    runtime: {
      lease_seconds: settings.lease_seconds,
      heartbeat_interval_seconds: Math.min(10, Math.max(5, Math.floor(settings.lease_seconds / 3))),
      idle_poll_seconds: 15,
    },
    formats: [".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv"],
  }
}
