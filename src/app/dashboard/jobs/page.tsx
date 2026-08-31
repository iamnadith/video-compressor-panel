import { FileVideoIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatBytes, formatDate, formatPercent } from "@/lib/format"
import { requireUser } from "@/lib/auth"
import { getJobs } from "@/lib/pipeline/queries"
import type { DashboardJob } from "@/lib/pipeline/queries"

export const metadata = { title: "Jobs" }

export default async function JobsPage() {
  await requireUser()
  const jobs = await getJobs()
  return (
    <>
      <PageHeader title="Jobs" description="Every discovered source object has one durable identity and retry history." />
      <Card>
        <CardHeader>
          <CardTitle>Pipeline queue</CardTitle>
          <CardDescription>{jobs.length} most recently updated jobs.</CardDescription>
        </CardHeader>
        <CardContent>
          {jobs.length ? (
            <Table>
              <TableHeader><TableRow><TableHead>Source</TableHead><TableHead>Status</TableHead><TableHead>Progress</TableHead><TableHead>Input</TableHead><TableHead>Output</TableHead><TableHead>Attempt</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader>
              <TableBody>
                {jobs.map((job: DashboardJob) => (
                  <TableRow key={job.id}>
                    <TableCell><div className="flex max-w-72 flex-col gap-1"><span className="truncate font-medium">{job.source_key.split("/").at(-1)}</span>{job.error_message ? <span className="truncate text-xs text-destructive">{job.error_message}</span> : null}</div></TableCell>
                    <TableCell><StatusBadge state={job.state} /></TableCell>
                    <TableCell><div className="flex min-w-32 flex-col gap-1"><Progress value={Number(job.progress)} /><span className="text-xs text-muted-foreground">{formatPercent(job.progress)} {job.current_pass ?? ""}</span></div></TableCell>
                    <TableCell>{formatBytes(Number(job.source_size))}</TableCell>
                    <TableCell>{job.output_size ? formatBytes(Number(job.output_size)) : "—"}</TableCell>
                    <TableCell>{job.attempt_count}/{job.max_attempts}</TableCell>
                    <TableCell>{formatDate(job.updated_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Empty>
              <EmptyHeader><EmptyMedia variant="icon"><FileVideoIcon /></EmptyMedia><EmptyTitle>No files discovered</EmptyTitle><EmptyDescription>The one-minute orchestrator scan will add eligible objects from the ingest prefix.</EmptyDescription></EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </>
  )
}
