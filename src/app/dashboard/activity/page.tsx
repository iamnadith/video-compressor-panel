import { ActivityIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDate } from "@/lib/format"
import { requireUser } from "@/lib/auth"
import { getActivity } from "@/lib/pipeline/queries"
import type { DashboardEvent } from "@/lib/pipeline/queries"

export const metadata = { title: "Activity" }

export default async function ActivityPage() {
  await requireUser()
  const events = await getActivity()
  return (
    <>
      <PageHeader title="Activity" description="Append-only operational events for claims, retries, failures, and completions." />
      <Card>
        <CardHeader><CardTitle>Event log</CardTitle><CardDescription>The latest {events.length} events retained in this view.</CardDescription></CardHeader>
        <CardContent>
          {events.length ? (
            <Table>
              <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Level</TableHead><TableHead>Event</TableHead><TableHead>Message</TableHead><TableHead>File</TableHead><TableHead>Worker</TableHead></TableRow></TableHeader>
              <TableBody>
                {events.map((event: DashboardEvent) => (
                  <TableRow key={event.id}>
                    <TableCell>{formatDate(event.created_at)}</TableCell>
                    <TableCell><StatusBadge state={event.level} /></TableCell>
                    <TableCell className="font-medium">{event.kind}</TableCell>
                    <TableCell className="max-w-96 truncate">{event.message}</TableCell>
                    <TableCell className="max-w-48 truncate">{event.jobs?.[0]?.source_key?.split("/").at(-1) ?? "—"}</TableCell>
                    <TableCell>{event.workers?.[0]?.display_name ?? "System"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Empty><EmptyHeader><EmptyMedia variant="icon"><ActivityIcon /></EmptyMedia><EmptyTitle>No events yet</EmptyTitle><EmptyDescription>Worker and reconciliation events will appear here.</EmptyDescription></EmptyHeader></Empty>
          )}
        </CardContent>
      </Card>
    </>
  )
}
