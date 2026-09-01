import { ArchiveIcon, CloudUploadIcon, DatabaseIcon, PackageCheckIcon, TriangleAlertIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { formatBytes } from "@/lib/format"
import { requireUser } from "@/lib/auth"
import { getStorageDirectories, getStorageSummary } from "@/lib/pipeline/queries"
import { StorageCleanupForm } from "@/app/dashboard/storage/storage-cleanup-form"

export const metadata = { title: "Storage" }

export default async function StoragePage() {
  await requireUser()
  const storage = await getStorageSummary()
  let directories: Awaited<ReturnType<typeof getStorageDirectories>> = []
  let directoryError: string | null = null
  try {
    directories = await getStorageDirectories()
  } catch (error) {
    directoryError = error instanceof Error ? error.message : "R2 directory statistics could not be loaded."
  }

  const saved = Math.max(0, storage.sourceBytes - storage.outputBytes)
  const ratio = storage.sourceBytes ? (storage.outputBytes / storage.sourceBytes) * 100 : 0
  const cards = [
    ["Ingest", storage.ingestBytes, "Queued source objects", CloudUploadIcon],
    ["Claimed", storage.claimedBytes, "Reserved for active workers", ArchiveIcon],
    ["Processed", storage.processedBytes, "Verified compressed outputs", PackageCheckIcon],
    ["Space saved", saved, "Across completed output", DatabaseIcon],
  ] as const

  return (
    <>
      <PageHeader title="Storage" description="Inspect physical R2 directories and clean their contents with explicit confirmation." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([title, value, description, Icon]) => (
          <Card key={title}>
            <CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription><Icon /></CardHeader>
            <CardContent><span className="text-2xl font-semibold">{formatBytes(value)}</span></CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>R2 directories</CardTitle>
          <CardDescription>Physical object counts and storage, calculated from the configured bucket prefixes.</CardDescription>
        </CardHeader>
        <CardContent>
          {directoryError ? (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>Directory statistics unavailable</AlertTitle>
              <AlertDescription>{directoryError}</AlertDescription>
            </Alert>
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              {directories.map((directory) => (
                <Card key={directory.id} size="sm">
                  <CardHeader>
                    <CardTitle>{directory.label}</CardTitle>
                    <CardDescription className="truncate" title={`${directory.prefix}/`}>R2 prefix: {directory.prefix}/</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-1">
                    <span className="text-2xl font-semibold tabular-nums">{directory.fileCount}</span>
                    <span className="text-xs text-muted-foreground">{directory.fileCount === 1 ? "file" : "files"}</span>
                    <span className="text-sm text-muted-foreground">{formatBytes(directory.totalBytes)} used</span>
                  </CardContent>
                  <CardFooter>
                    <StorageCleanupForm scope={directory.id} buttonLabel={`Delete ${directory.label.toLowerCase()} files`} />
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Compression footprint</CardTitle>
          <CardDescription>Output bytes as a percentage of discovered source bytes.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Progress value={Math.min(100, ratio)} />
          <div className="flex items-center justify-between gap-4 text-sm"><span className="text-muted-foreground">{formatBytes(storage.outputBytes)} output</span><span>{ratio.toFixed(1)}%</span><span className="text-muted-foreground">{formatBytes(storage.sourceBytes)} source</span></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Destructive cleanup</CardTitle>
          <CardDescription>These operations permanently delete data and cannot be undone.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Use with care</AlertTitle>
            <AlertDescription>Deleting the whole bucket removes objects outside the three configured directories too. Clearing the pipeline database removes jobs, events, workers, and reconciliation history, but keeps the panel account and settings.</AlertDescription>
          </Alert>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="flex flex-col gap-2">
              <div><h3 className="font-medium">Whole R2 bucket</h3><p className="text-sm text-muted-foreground">Delete every object in the configured bucket.</p></div>
              <StorageCleanupForm scope="bucket" buttonLabel="Delete whole bucket" />
            </div>
            <div className="flex flex-col gap-2">
              <div><h3 className="font-medium">Pipeline database</h3><p className="text-sm text-muted-foreground">Clear all pipeline records while retaining access and configuration.</p></div>
              <StorageCleanupForm scope="database" buttonLabel="Clear pipeline database" />
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  )
}
