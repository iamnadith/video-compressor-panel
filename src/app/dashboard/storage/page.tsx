import { ArchiveIcon, CloudUploadIcon, DatabaseIcon, PackageCheckIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { formatBytes } from "@/lib/format"
import { requireUser } from "@/lib/auth"
import { getStorageSummary } from "@/lib/pipeline/queries"

export const metadata = { title: "Storage" }

export default async function StoragePage() {
  await requireUser()
  const storage = await getStorageSummary()
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
      <PageHeader title="Storage" description="Logical pipeline inventory derived from durable job records and R2 reconciliation." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([title, value, description, Icon]) => (
          <Card key={title}>
            <CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription><Icon /></CardHeader>
            <CardContent><span className="text-2xl font-semibold">{formatBytes(value)}</span></CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle>Compression footprint</CardTitle><CardDescription>Output bytes as a percentage of discovered source bytes.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Progress value={Math.min(100, ratio)} />
          <div className="flex items-center justify-between gap-4 text-sm"><span className="text-muted-foreground">{formatBytes(storage.outputBytes)} output</span><span>{ratio.toFixed(1)}%</span><span className="text-muted-foreground">{formatBytes(storage.sourceBytes)} source</span></div>
        </CardContent>
      </Card>
    </>
  )
}
