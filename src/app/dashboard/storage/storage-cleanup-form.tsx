"use client"

import { useActionState } from "react"
import { Trash2Icon } from "lucide-react"

import { cleanupStorageAction, type CleanupScope, type CleanupState } from "@/app/dashboard/storage/actions"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

const confirmations: Record<CleanupScope, string> = {
  ingest: "DELETE INGEST",
  processing: "DELETE PROCESSING",
  output: "DELETE OUTPUT",
  bucket: "DELETE WHOLE BUCKET",
  database: "CLEAR PIPELINE DATABASE",
}

export function StorageCleanupForm({ scope, buttonLabel = "Delete files" }: { scope: CleanupScope; buttonLabel?: string }) {
  const [state, action, pending] = useActionState<CleanupState, FormData>(cleanupStorageAction, {})
  const confirmation = confirmations[scope]
  const inputId = `cleanup-confirmation-${scope}`

  return (
    <form action={action} className="flex w-full flex-col gap-3">
      <input type="hidden" name="scope" value={scope} />
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor={inputId}>Type {confirmation} to confirm</FieldLabel>
          <Input id={inputId} name="confirmation" placeholder={confirmation} autoComplete="off" />
          <FieldDescription>This cannot be undone.</FieldDescription>
        </Field>
      </FieldGroup>
      <Button type="submit" variant="destructive" disabled={pending}>
        {pending ? <Spinner data-icon="inline-start" /> : <Trash2Icon data-icon="inline-start" />}
        {pending ? "Deleting" : buttonLabel}
      </Button>
      {state.message ? <p className={state.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>{state.message}</p> : null}
    </form>
  )
}
