import { redirect } from "next/navigation"
import { BoxesIcon } from "lucide-react"

import { LoginForm } from "@/app/login/login-form"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { isPanelConfigured } from "@/lib/env"
import { getCurrentUser } from "@/lib/auth"

export default async function LoginPage() {
  if (isPanelConfigured()) {
    if (await getCurrentUser()) redirect("/dashboard")
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center justify-center gap-2">
          <BoxesIcon />
          <span className="font-medium">Transcode</span>
        </div>
        {!isPanelConfigured() ? (
          <Alert>
            <AlertTitle>Setup required</AlertTitle>
            <AlertDescription>Add the variables from .env.example before signing in.</AlertDescription>
          </Alert>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>Welcome back</CardTitle>
            <CardDescription>Sign in with an administrator account stored in PostgreSQL.</CardDescription>
          </CardHeader>
          <CardContent><LoginForm /></CardContent>
        </Card>
      </div>
    </main>
  )
}
