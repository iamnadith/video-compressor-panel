"use client"

import { useActionState } from "react"
import { UserPlusIcon } from "lucide-react"

import { createInitialAdminAction, type SetupState } from "@/app/setup/actions"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

export function SetupForm() {
  const [state, action, pending] = useActionState<SetupState, FormData>(createInitialAdminAction, {})
  return (
    <form action={action} className="border-t p-6">
      <div className="mb-4"><h2 className="font-heading font-medium">Create the first administrator</h2><p className="text-sm text-muted-foreground">This account is stored in your PostgreSQL database.</p></div>
      {state.message ? <Alert className="mb-4"><AlertTitle>Setup</AlertTitle><AlertDescription>{state.message}</AlertDescription></Alert> : null}
      <FieldGroup>
        <Field data-invalid={Boolean(state.errors?.email)}><FieldLabel htmlFor="setup-email">Email</FieldLabel><Input id="setup-email" name="email" type="email" required autoComplete="email" aria-invalid={Boolean(state.errors?.email)} /><FieldError errors={state.errors?.email?.map((message) => ({ message }))} /></Field>
        <Field data-invalid={Boolean(state.errors?.password)}><FieldLabel htmlFor="setup-password">Password</FieldLabel><Input id="setup-password" name="password" type="password" minLength={12} required autoComplete="new-password" aria-invalid={Boolean(state.errors?.password)} /><FieldError errors={state.errors?.password?.map((message) => ({ message }))} /></Field>
        <Field data-invalid={Boolean(state.errors?.confirm_password)}><FieldLabel htmlFor="setup-confirm-password">Confirm password</FieldLabel><Input id="setup-confirm-password" name="confirm_password" type="password" minLength={12} required autoComplete="new-password" aria-invalid={Boolean(state.errors?.confirm_password)} /><FieldError errors={state.errors?.confirm_password?.map((message) => ({ message }))} /></Field>
        <Button type="submit" disabled={pending}>{pending ? <Spinner data-icon="inline-start" /> : <UserPlusIcon data-icon="inline-start" />}{pending ? "Creating" : "Create administrator"}</Button>
      </FieldGroup>
    </form>
  )
}
