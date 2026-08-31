"use client"

import { useActionState } from "react"
import { LockKeyholeIcon } from "lucide-react"

import { loginAction, type LoginState } from "@/app/login/actions"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

const initialState: LoginState = {}

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, initialState)
  return (
    <form action={action}>
      <FieldGroup>
        <Field data-invalid={Boolean(state.errors?.email)}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={Boolean(state.errors?.email)} />
          <FieldError errors={state.errors?.email?.map((message) => ({ message }))} />
        </Field>
        <Field data-invalid={Boolean(state.errors?.password)}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input id="password" name="password" type="password" autoComplete="current-password" required aria-invalid={Boolean(state.errors?.password)} />
          <FieldError errors={state.errors?.password?.map((message) => ({ message }))} />
        </Field>
        {state.message ? <FieldDescription role="alert">{state.message}</FieldDescription> : null}
        <Field>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : <LockKeyholeIcon data-icon="inline-start" />}
            {pending ? "Signing in" : "Sign in"}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}

