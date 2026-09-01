"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireUser } from "@/lib/auth"
import { clearPipelineDatabase } from "@/lib/pipeline/cleanup"
import { getPipelineSettings } from "@/lib/pipeline/config"
import { deleteR2Bucket, deleteR2Prefix } from "@/lib/r2"

export const cleanupScopes = ["ingest", "processing", "output", "bucket", "database"] as const
export type CleanupScope = (typeof cleanupScopes)[number]
export type CleanupState = { ok?: boolean; message?: string }

const cleanupSchema = z.object({
  scope: z.enum(cleanupScopes),
  confirmation: z.string().trim(),
})

const confirmations: Record<CleanupScope, string> = {
  ingest: "DELETE INGEST",
  processing: "DELETE PROCESSING",
  output: "DELETE OUTPUT",
  bucket: "DELETE WHOLE BUCKET",
  database: "CLEAR PIPELINE DATABASE",
}

export async function cleanupStorageAction(_state: CleanupState, formData: FormData): Promise<CleanupState> {
  await requireUser()
  const parsed = cleanupSchema.safeParse({
    scope: formData.get("scope"),
    confirmation: formData.get("confirmation"),
  })
  if (!parsed.success) return { message: "The cleanup request is invalid." }

  const { scope, confirmation } = parsed.data
  if (confirmation !== confirmations[scope]) {
    return { message: `Type ${confirmations[scope]} exactly to confirm.` }
  }

  try {
    let message: string
    if (scope === "bucket") {
      const result = await deleteR2Bucket()
      message = `Deleted ${result.deleted} object${result.deleted === 1 ? "" : "s"} from the whole R2 bucket.`
    } else if (scope === "database") {
      const settings = await getPipelineSettings()
      await clearPipelineDatabase([settings.ingest_prefix, settings.claimed_prefix, settings.processed_prefix])
      message = "Cleared pipeline jobs, events, workers, and reconciliation history. Panel account and settings were preserved."
    } else {
      const settings = await getPipelineSettings()
      const prefix = {
        ingest: settings.ingest_prefix,
        processing: settings.claimed_prefix,
        output: settings.processed_prefix,
      }[scope]
      const result = await deleteR2Prefix(prefix)
      message = `Deleted ${result.deleted} object${result.deleted === 1 ? "" : "s"} from the ${scope} directory.`
    }

    revalidatePath("/dashboard/storage")
    revalidatePath("/dashboard/jobs")
    revalidatePath("/dashboard")
    return { ok: true, message }
  } catch (error) {
    console.error("Storage cleanup failed", error)
    return { message: error instanceof Error ? error.message : "The cleanup operation failed." }
  }
}
