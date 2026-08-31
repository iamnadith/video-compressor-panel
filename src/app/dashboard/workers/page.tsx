import { CpuIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDate } from "@/lib/format"
import { requireUser } from "@/lib/auth"
import { getWorkers } from "@/lib/pipeline/queries"
import type { DashboardWorker } from "@/lib/pipeline/queries"

export const metadata = { title: "Workers" }

export default async function WorkersPage() {
  await requireUser()
  const workers = await getWorkers()
  return (
    <>
      <PageHeader title="Workers" description="Processors identify themselves automatically from only the orchestrator URL and shared secret." />
      <Card>
        <CardHeader>
          <CardTitle>Processor fleet</CardTitle>
          <CardDescription>{workers.length} registered instances.</CardDescription>
        </CardHeader>
        <CardContent>
          {workers.length ? (
            <Table>
              <TableHeader><TableRow><TableHead>Worker</TableHead><TableHead>Status</TableHead><TableHead>Host</TableHead><TableHead>Platform</TableHead><TableHead>Version</TableHead><TableHead>Last seen</TableHead></TableRow></TableHeader>
              <TableBody>
                {workers.map((worker: DashboardWorker) => (
                  <TableRow key={worker.id}>
                    <TableCell><div className="flex max-w-64 flex-col gap-1"><span className="truncate font-medium">{worker.display_name}</span><code className="truncate text-xs text-muted-foreground">{worker.instance_id}</code></div></TableCell>
                    <TableCell><StatusBadge state={worker.state} /></TableCell>
                    <TableCell>{worker.hostname}</TableCell>
                    <TableCell><div className="flex flex-col gap-1"><span className="max-w-64 truncate">{worker.platform}</span>{worker.architecture ? <Badge variant="outline">{worker.architecture}</Badge> : null}</div></TableCell>
                    <TableCell>{worker.agent_version}</TableCell>
                    <TableCell>{formatDate(worker.last_seen_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Empty>
              <EmptyHeader><EmptyMedia variant="icon"><CpuIcon /></EmptyMedia><EmptyTitle>No processors registered</EmptyTitle><EmptyDescription>Start a server or GitHub Actions processor with the orchestrator URL and shared secret.</EmptyDescription></EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </>
  )
}
