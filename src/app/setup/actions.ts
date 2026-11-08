"use server"

import { redirect } from "next/navigation"
import { z } from "zod"

import { hashPassword } from "@/lib/auth"
import { isPanelConfigured } from "@/lib/env"
import { withTransaction } from "@/lib/db"

const schema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(12, "Use at least 12 characters."),
  confirm_password: z.string(),
}).refine((value) => value.password === value.confirm_password, {
  message: "Passwords do not match.", path: ["confirm_password"],
})

export type SetupState = { message?: string; errors?: Record<string, string[]> }

function setupDatabaseMessage(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : ""

  switch (code) {
    case "28P01":
    case "28000":
      return "The database rejected the configured credentials. Check DATABASE_URL in the deployment environment."
    case "3D000":
      return "The configured PostgreSQL database does not exist. Check DATABASE_URL in the deployment environment."
    case "42P01":
      return "The panel database tables are missing. Redeploy so the database migrations can run, then try again."
    case "42501":
      return "The configured database user cannot create panel accounts. Grant it write access to the panel tables."
    default:
      return code
        ? `The database could not create the account (PostgreSQL error ${code}). Check the deployment logs and DATABASE_URL.`
        : "The database could not create the account. Check the deployment logs and DATABASE_URL."
  }
}

export async function createInitialAdminAction(_state: SetupState, formData: FormData): Promise<SetupState> {
  if (!isPanelConfigured()) return { message: "Set DATABASE_URL before creating the administrator." }
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors, message: "Review the highlighted fields." }
  try {
    const result = await withTransaction(async (transaction) => {
      // Serialize bootstrap attempts so two requests cannot both observe an empty table.
      await transaction.query("select pg_advisory_xact_lock(hashtext($1))", ["video-compressor-panel:initial-admin"])
      const count = await transaction.query("select count(*)::int as count from public.panel_users")
      if (Number(count.rows[0]?.count ?? 0) > 0) return "exists"
      await transaction.query(
        "insert into public.panel_users (email, password_hash) values (lower($1), $2)",
        [parsed.data.email, await hashPassword(parsed.data.password)],
      )
      return "created"
    })
    if (result === "exists") return { message: "An administrator already exists. Sign in instead." }
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "unknown"
    console.error("Initial administrator creation failed", code)
    return { message: setupDatabaseMessage(error) }
  }
  redirect("/login")
}
