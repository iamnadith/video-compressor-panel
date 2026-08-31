"use client"

import { useActionState } from "react"
import { SaveIcon } from "lucide-react"

import { updateAccountAction, type AccountState } from "@/app/dashboard/account/actions"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

export function AccountForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<AccountState, FormData>(updateAccountAction, {})
  return (
    <form action={action} className="max-w-2xl">
      {state.message ? <Alert className="mb-4"><AlertTitle>{state.ok ? "Updated" : "Could not update"}</AlertTitle><AlertDescription>{state.message}</AlertDescription></Alert> : null}
      <Card>
        <CardHeader><CardTitle>Account</CardTitle><CardDescription>Manage the PostgreSQL-backed dashboard administrator account.</CardDescription></CardHeader>
        <CardContent><FieldGroup>
          <Field data-invalid={Boolean(state.errors?.email)}><FieldLabel htmlFor="account-email">Email</FieldLabel><Input id="account-email" name="email" type="email" defaultValue={email} required autoComplete="email" aria-invalid={Boolean(state.errors?.email)} /><FieldError errors={state.errors?.email?.map((message) => ({ message }))} /></Field>
          <Field data-invalid={Boolean(state.errors?.current_password)}><FieldLabel htmlFor="current-password">Current password</FieldLabel><Input id="current-password" name="current_password" type="password" required autoComplete="current-password" aria-invalid={Boolean(state.errors?.current_password)} /><FieldError errors={state.errors?.current_password?.map((message) => ({ message }))} /></Field>
          <Field data-invalid={Boolean(state.errors?.new_password)}><FieldLabel htmlFor="new-password">New password</FieldLabel><Input id="new-password" name="new_password" type="password" minLength={12} autoComplete="new-password" aria-invalid={Boolean(state.errors?.new_password)} /><FieldError errors={state.errors?.new_password?.map((message) => ({ message }))} /></Field>
          <Field data-invalid={Boolean(state.errors?.confirm_password)}><FieldLabel htmlFor="confirm-password">Confirm new password</FieldLabel><Input id="confirm-password" name="confirm_password" type="password" minLength={12} autoComplete="new-password" aria-invalid={Boolean(state.errors?.confirm_password)} /><FieldError errors={state.errors?.confirm_password?.map((message) => ({ message }))} /></Field>
        </FieldGroup></CardContent>
        <CardFooter><Button type="submit" disabled={pending}>{pending ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}{pending ? "Saving" : "Save account"}</Button></CardFooter>
      </Card>
    </form>
  )
}
