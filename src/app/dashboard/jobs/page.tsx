import { FileVideoIcon, FilterIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatBytes, formatDate, formatPercent } from "@/lib/format"
import { requireUser } from "@/lib/auth"
import { getJobs, jobStatusFilters, type DashboardJob, type JobStatusFilter } from "@/lib/pipeline/queries"
import { RetryJobForm } from "@/app/dashboard/jobs/retry-job-form"

export const metadata = { title: "Jobs" }

type JobsSearchParams = Promise<{ [key: string]: string | string[] | undefined }>

const statusOptions: Array<{ value: JobStatusFilter; label: string }> = [
  { value: "all", label: "All jobs" },
  { value: "claimed", label: "Claimed" },
  { value: "processing", label: "Processing" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
]

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function parsePage(value: string | undefined) {
  const page = Number(value)
  return Number.isSafeInteger(page) && page > 0 ? page : 1
}

function parseStatus(value: string | undefined): JobStatusFilter {
  if (value === "all" || (value && (jobStatusFilters as readonly string[]).includes(value))) {
    return value as JobStatusFilter
  }
  return "all"
}

function jobsHref(page: number, status: JobStatusFilter) {
  const params = new URLSearchParams()
  if (status !== "all") params.set("status", status)
  if (page > 1) params.set("page", String(page))
  const query = params.toString()
  return query ? `/dashboard/jobs?${query}` : "/dashboard/jobs"
}

function paginationItems(currentPage: number, totalPages: number): Array<number | "ellipsis"> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1)
  if (currentPage <= 4) return [1, 2, 3, 4, 5, "ellipsis", totalPages]
  if (currentPage >= totalPages - 3) return [1, "ellipsis", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
  return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", totalPages]
}

export default async function JobsPage({ searchParams }: { searchParams: JobsSearchParams }) {
  await requireUser()
  const params = await searchParams
  const status = parseStatus(firstParam(params.status))
  const result = await getJobs(parsePage(firstParam(params.page)), status)
  const start = result.total ? (result.page - 1) * result.pageSize + 1 : 0
  const end = Math.min(result.page * result.pageSize, result.total)

  return (
    <>
      <PageHeader title="Jobs" description="Every discovered source object has one durable identity and retry history." />
      <Card>
        <CardHeader>
          <CardTitle>Pipeline queue</CardTitle>
          <CardDescription>
            {result.total} {status === "all" ? "jobs" : `${status} jobs`} found. Showing the newest updates first.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form method="get" action="/dashboard/jobs" className="flex flex-wrap items-end gap-3" aria-label="Filter jobs">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="job-status">Status</Label>
              <NativeSelect id="job-status" name="status" defaultValue={status} className="w-44">
                {statusOptions.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <Button type="submit" variant="outline">
              <FilterIcon data-icon="inline-start" />
              Apply filter
            </Button>
          </form>

          {result.jobs.length ? (
            <>
              <Table>
                <TableHeader><TableRow><TableHead>Source</TableHead><TableHead>Status</TableHead><TableHead>Progress</TableHead><TableHead>Input</TableHead><TableHead>Output</TableHead><TableHead>Attempt</TableHead><TableHead>Updated</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
                <TableBody>
                  {result.jobs.map((job: DashboardJob) => (
                    <TableRow key={job.id}>
                      <TableCell><div className="flex max-w-72 flex-col gap-1"><span className="truncate font-medium">{job.source_key.split("/").at(-1)}</span>{job.error_message ? <span className="truncate text-xs text-destructive">{job.error_message}</span> : null}</div></TableCell>
                      <TableCell><StatusBadge state={job.state} /></TableCell>
                      <TableCell><div className="flex min-w-32 flex-col gap-1"><Progress value={Number(job.progress)} /><span className="text-xs text-muted-foreground">{formatPercent(job.progress)} {job.current_pass ?? ""}</span></div></TableCell>
                      <TableCell>{formatBytes(Number(job.source_size))}</TableCell>
                      <TableCell>{job.output_size ? formatBytes(Number(job.output_size)) : "—"}</TableCell>
                      <TableCell>{job.attempt_count}/{job.max_attempts}</TableCell>
                      <TableCell>{formatDate(job.updated_at)}</TableCell>
                      <TableCell>{job.state === "failed" || (job.state === "cancelled" && !job.error_message?.includes("superseded")) ? <RetryJobForm jobId={job.id} /> : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex flex-col gap-4 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">Showing {start}–{end} of {result.total} jobs</p>
                {result.totalPages > 1 ? (
                  <Pagination className="mx-0 w-auto justify-start sm:justify-end">
                    <PaginationContent>
                      {result.page > 1 ? <PaginationItem><PaginationPrevious href={jobsHref(result.page - 1, status)} /></PaginationItem> : null}
                      {paginationItems(result.page, result.totalPages).map((item, index) => (
                        <PaginationItem key={`${item}-${index}`}>
                          {item === "ellipsis" ? <span className="flex size-8 items-center justify-center text-muted-foreground">…</span> : <PaginationLink href={jobsHref(item, status)} isActive={item === result.page}>{item}</PaginationLink>}
                        </PaginationItem>
                      ))}
                      {result.page < result.totalPages ? <PaginationItem><PaginationNext href={jobsHref(result.page + 1, status)} /></PaginationItem> : null}
                    </PaginationContent>
                  </Pagination>
                ) : null}
              </div>
            </>
          ) : (
            <Empty>
              <EmptyHeader><EmptyMedia variant="icon"><FileVideoIcon /></EmptyMedia><EmptyTitle>{status === "all" ? "No files discovered" : "No matching jobs"}</EmptyTitle><EmptyDescription>{status === "all" ? "The one-minute orchestrator scan will add eligible objects from the ingest prefix." : "Try another status filter to view more jobs."}</EmptyDescription></EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </>
  )
}
