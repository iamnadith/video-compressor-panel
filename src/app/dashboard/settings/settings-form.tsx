"use client"

import { useActionState } from "react"
import { SaveIcon } from "lucide-react"

import { saveSettingsAction, type SettingsState } from "@/app/dashboard/settings/actions"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"

type Settings = {
  r2_account_id: string | null
  r2_access_key_id: string | null
  r2_bucket: string | null
  orchestrator_url: string | null
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

const presets = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow", "placebo"]

function ErrorFor({ state, name }: { state: SettingsState; name: string }) {
  return <FieldError errors={state.errors?.[name]?.map((message) => ({ message }))} />
}

export function SettingsForm({ settings }: { settings: Settings }) {
  const [state, action, pending] = useActionState(saveSettingsAction, {})
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.message ? (
        <Alert>
          <AlertTitle>{state.ok ? "Settings updated" : "Settings not saved"}</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Cloudflare R2</CardTitle><CardDescription>Stored in PostgreSQL and used only by the panel.</CardDescription></CardHeader>
          <CardContent>
            <FieldGroup>
              <Field data-invalid={Boolean(state.errors?.r2_account_id)}><FieldLabel htmlFor="r2_account_id">Account ID</FieldLabel><Input id="r2_account_id" name="r2_account_id" defaultValue={settings.r2_account_id ?? ""} required aria-invalid={Boolean(state.errors?.r2_account_id)} /><ErrorFor state={state} name="r2_account_id" /></Field>
              <Field data-invalid={Boolean(state.errors?.r2_access_key_id)}><FieldLabel htmlFor="r2_access_key_id">Access key ID</FieldLabel><Input id="r2_access_key_id" name="r2_access_key_id" defaultValue={settings.r2_access_key_id ?? ""} required aria-invalid={Boolean(state.errors?.r2_access_key_id)} /><ErrorFor state={state} name="r2_access_key_id" /></Field>
              <Field data-invalid={Boolean(state.errors?.r2_secret_access_key)}><FieldLabel htmlFor="r2_secret_access_key">Secret access key</FieldLabel><Input id="r2_secret_access_key" name="r2_secret_access_key" type="password" autoComplete="new-password" placeholder="Leave blank to keep the saved key" aria-invalid={Boolean(state.errors?.r2_secret_access_key)} /><FieldDescription>Never sent to processors.</FieldDescription><ErrorFor state={state} name="r2_secret_access_key" /></Field>
              <Field data-invalid={Boolean(state.errors?.r2_bucket)}><FieldLabel htmlFor="r2_bucket">Bucket</FieldLabel><Input id="r2_bucket" name="r2_bucket" defaultValue={settings.r2_bucket ?? ""} required aria-invalid={Boolean(state.errors?.r2_bucket)} /><ErrorFor state={state} name="r2_bucket" /></Field>
            </FieldGroup>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Routing</CardTitle><CardDescription>The edge gateway URL and R2 state prefixes.</CardDescription></CardHeader>
          <CardContent>
            <FieldGroup>
              <Field data-invalid={Boolean(state.errors?.orchestrator_url)}><FieldLabel htmlFor="orchestrator_url">Orchestrator URL</FieldLabel><Input id="orchestrator_url" name="orchestrator_url" type="url" defaultValue={settings.orchestrator_url ?? ""} placeholder="https://video-pipeline-orchestrator.workers.dev" aria-invalid={Boolean(state.errors?.orchestrator_url)} /><FieldDescription>Processors connect to this URL instead of the panel directly.</FieldDescription><ErrorFor state={state} name="orchestrator_url" /></Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field><FieldLabel htmlFor="ingest_prefix">Ingest</FieldLabel><Input id="ingest_prefix" name="ingest_prefix" defaultValue={settings.ingest_prefix} required /></Field>
                <Field><FieldLabel htmlFor="claimed_prefix">Claimed</FieldLabel><Input id="claimed_prefix" name="claimed_prefix" defaultValue={settings.claimed_prefix} required /></Field>
                <Field><FieldLabel htmlFor="processed_prefix">Processed</FieldLabel><Input id="processed_prefix" name="processed_prefix" defaultValue={settings.processed_prefix} required /></Field>
              </div>
            </FieldGroup>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Compression</CardTitle><CardDescription>Exact two-pass x264 settings from the supplied scripts.</CardDescription></CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field><FieldLabel htmlFor="max_resolution">Max height</FieldLabel><Input id="max_resolution" name="max_resolution" type="number" min="144" max="4320" defaultValue={settings.max_resolution} required /></Field>
                <Field><FieldLabel htmlFor="target_size_mb">Target size (MB)</FieldLabel><Input id="target_size_mb" name="target_size_mb" type="number" min="50" max="10000" defaultValue={settings.target_size_mb} required /></Field>
                <Field><FieldLabel htmlFor="minimum_input_size_mb">Minimum input (MB)</FieldLabel><Input id="minimum_input_size_mb" name="minimum_input_size_mb" type="number" min="0" max="10000" defaultValue={settings.minimum_input_size_mb} required /></Field>
                <Field><FieldLabel htmlFor="ffmpeg_preset">FFmpeg preset</FieldLabel><NativeSelect id="ffmpeg_preset" name="ffmpeg_preset" defaultValue={settings.ffmpeg_preset} className="w-full">{presets.map((preset) => <NativeSelectOption key={preset} value={preset}>{preset}</NativeSelectOption>)}</NativeSelect></Field>
                <Field><FieldLabel htmlFor="audio_bitrate_kbps">Audio bitrate (kbps)</FieldLabel><Input id="audio_bitrate_kbps" name="audio_bitrate_kbps" type="number" min="64" max="512" defaultValue={settings.audio_bitrate_kbps} required /></Field>
                <Field><FieldLabel htmlFor="minimum_video_bitrate_kbps">Minimum video bitrate</FieldLabel><Input id="minimum_video_bitrate_kbps" name="minimum_video_bitrate_kbps" type="number" min="50" defaultValue={settings.minimum_video_bitrate_kbps} required /></Field>
              </div>
            </FieldGroup>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Leases and retries</CardTitle><CardDescription>Crash recovery timing shared by every processor.</CardDescription></CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field><FieldLabel htmlFor="lease_seconds">Lease seconds</FieldLabel><Input id="lease_seconds" name="lease_seconds" type="number" min="30" max="3600" defaultValue={settings.lease_seconds} required /></Field>
                <Field><FieldLabel htmlFor="worker_stale_seconds">Offline after</FieldLabel><Input id="worker_stale_seconds" name="worker_stale_seconds" type="number" min="30" max="3600" defaultValue={settings.worker_stale_seconds} required /></Field>
                <Field><FieldLabel htmlFor="max_attempts">Max attempts</FieldLabel><Input id="max_attempts" name="max_attempts" type="number" min="1" max="25" defaultValue={settings.max_attempts} required /></Field>
              </div>
            </FieldGroup>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Gateway secrets</CardTitle><CardDescription>Leave blank to keep the current value. Only salted hashes are stored.</CardDescription></CardHeader>
          <CardContent>
            <FieldGroup>
              <Field data-invalid={Boolean(state.errors?.worker_secret)}><FieldLabel htmlFor="worker_secret">Shared worker secret</FieldLabel><Input id="worker_secret" name="worker_secret" type="password" autoComplete="new-password" aria-invalid={Boolean(state.errors?.worker_secret)} /><FieldDescription>The same bootstrap secret is used by every processor.</FieldDescription><ErrorFor state={state} name="worker_secret" /></Field>
              <Field data-invalid={Boolean(state.errors?.orchestrator_secret)}><FieldLabel htmlFor="orchestrator_secret">Orchestrator secret</FieldLabel><Input id="orchestrator_secret" name="orchestrator_secret" type="password" autoComplete="new-password" aria-invalid={Boolean(state.errors?.orchestrator_secret)} /><FieldDescription>Authenticates the Cloudflare gateway to the panel.</FieldDescription><ErrorFor state={state} name="orchestrator_secret" /></Field>
            </FieldGroup>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardFooter>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
            {pending ? "Saving" : "Save settings"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}
