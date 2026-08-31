import { ActivityIcon, BoxesIcon, CheckCircle2Icon, CircleAlertIcon, UsersIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatBytes, formatDate, formatPercent } from "@/lib/format"
import { requireUser } from "@/lib/auth"
import { getDashboardData } from "@/lib/pipeline/queries"
import type { DashboardEvent, DashboardJob } from "@/lib/pipeline/queries"

export const metadata = { title: "Overview" }

const metricIcons = [BoxesIcon, ActivityIcon, CheckCircle2Icon, CircleAlertIcon, UsersIcon]

export default async function DashboardPage() {
  await requireUser()
  const data = await getDashboardData()
  const metrics = [
    ["Queued", data.counts.queued, "Waiting for a processor"],
    ["Active", data.counts.active, "Claimed or processing"],
    ["Completed", data.counts.completed, "Verified outputs"],
    ["Failed", data.counts.failed, "Needs attention"],
    ["Workers", data.counts.workers, "Online or recently active"],
  ] as const

  return (
    <>
      <PageHeader title="Overview" description="A live view of discovery, processing, delivery, and worker health." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map(([label, value, description], index) => {
          const Icon = metricIcons[index]
          return (
            <Card key={label} size="sm">
              <CardHeader>
                <CardDescription>{label}</CardDescription>
                <Icon />
              </CardHeader>
              <CardContent className="flex flex-col gap-1">
                <span className="text-2xl font-semibold tabular-nums">{value}</span>
                <span className="text-xs text-muted-foreground">{description}</span>
              </CardContent>
            </Card>
          )
        })}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Recent jobs</CardTitle>
            <CardDescription>Latest state transitions across the pipeline.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>File</TableHead><TableHead>Status</TableHead><TableHead>Progress</TableHead><TableHead>Size</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.recentJobs.map((job: DashboardJob) => (
                  <TableRow key={job.id}>
                    <TableCell className="max-w-64 truncate font-medium">{job.source_key.split("/").at(-1)}</TableCell>
                    <TableCell><StatusBadge state={job.state} /></TableCell>
                    <TableCell><div className="flex min-w-28 flex-col gap-1"><Progress value={Number(job.progress)} /><span className="text-xs text-muted-foreground">{formatPercent(job.progress)} {job.current_pass ?? ""}</span></div></TableCell>
                    <TableCell>{formatBytes(Number(job.source_size))}</TableCell>
                    <TableCell>{formatDate(job.updated_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Activity</CardTitle>
            <CardDescription>Most recent durable events.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {data.events.map((event: DashboardEvent) => (
              <div key={event.id} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">{event.kind}</span><StatusBadge state={event.level} /></div>
                <p className="text-sm text-muted-foreground">{event.message}</p>
                <span className="text-xs text-muted-foreground">{formatDate(event.created_at)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
