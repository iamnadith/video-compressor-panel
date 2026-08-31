"use client"

import { useActionState } from "react"
import { RotateCcwIcon } from "lucide-react"

import { retryJobAction, type RetryState } from "@/app/dashboard/jobs/actions"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

export function RetryJobForm({ jobId }: { jobId: string }) {
  const [state, action, pending] = useActionState<RetryState, FormData>(retryJobAction, {})
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="job_id" value={jobId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? <Spinner data-icon="inline-start" /> : <RotateCcwIcon data-icon="inline-start" />}
        {pending ? "Retrying" : "Retry"}
      </Button>
      {state.message ? <span className={state.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>{state.message}</span> : null}
    </form>
  )
}
