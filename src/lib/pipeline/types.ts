export type PipelineSettings = {
  id: number
  ingest_prefix: string
  claimed_prefix: string
  processed_prefix: string
  max_resolution: number
  target_size_mb: number
  minimum_input_size_mb: number
  ffmpeg_preset: string
  audio_bitrate_kbps: number
  minimum_video_bitrate_kbps: number
  lease_seconds: number
  worker_stale_seconds: number
  max_attempts: number
}

export type PipelineJob = {
  id: string
  source_bucket: string
  source_key: string
  source_etag: string
  source_size: number
  source_last_modified: string | null
  claimed_key: string | null
  output_key: string | null
  state: string
  assigned_worker_id: string | null
  claim_token: string | null
  leased_until: string | null
  attempt_count: number
  max_attempts: number
  progress: number
  current_pass: string | null
  settings_snapshot: Record<string, string | number> | null
}

