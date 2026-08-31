import Link from "next/link"
import { CheckCircle2Icon, CircleAlertIcon, DatabaseIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { isPanelConfigured } from "@/lib/env"
import { SetupForm } from "@/app/setup/setup-form"

const variables = [
  "DATABASE_URL",
]

export default function SetupPage() {
  const ready = isPanelConfigured()
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl items-center p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Panel bootstrap</CardTitle>
          <CardDescription>Only the PostgreSQL connection string belongs in deployment environment variables. R2 and gateway secrets are configured in the dashboard and synchronized through PostgreSQL.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Alert>
            {ready ? <CheckCircle2Icon /> : <CircleAlertIcon />}
            <AlertTitle>{ready ? "Environment ready" : "Environment incomplete"}</AlertTitle>
            <AlertDescription>The database URI stays panel-only and is never delivered to Cloudflare or processors. Complete R2 and secret setup after creating the first administrator.</AlertDescription>
          </Alert>
          <div className="grid gap-2 sm:grid-cols-2">
            {variables.map((name) => (
              <div key={name} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <code className="truncate text-xs">{name}</code>
                <Badge variant={process.env[name]?.trim() ? "secondary" : "outline"}>
                  {process.env[name]?.trim() ? "Set" : "Missing"}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
        <CardFooter>
          <Button render={<Link href={ready ? "/login" : "/setup"} />} nativeButton={false} disabled={!ready}>
            <DatabaseIcon data-icon="inline-start" />
            Continue to sign in
          </Button>
        </CardFooter>
        {ready ? <SetupForm /> : null}
      </Card>
    </main>
  )
}
