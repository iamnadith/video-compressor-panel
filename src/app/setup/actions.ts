"use server"

import { redirect } from "next/navigation"
import { z } from "zod"

import { hashPassword } from "@/lib/auth"
import { isPanelConfigured } from "@/lib/env"
import { query } from "@/lib/db"

const schema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(12, "Use at least 12 characters."),
  confirm_password: z.string(),
}).refine((value) => value.password === value.confirm_password, {
  message: "Passwords do not match.", path: ["confirm_password"],
})

export type SetupState = { message?: string; errors?: Record<string, string[]> }

export async function createInitialAdminAction(_state: SetupState, formData: FormData): Promise<SetupState> {
  if (!isPanelConfigured()) return { message: "Set DATABASE_URL before creating the administrator." }
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors, message: "Review the highlighted fields." }
  const count = await query<{ count: number }>("select count(*)::int as count from public.panel_users")
  if (Number(count.rows[0]?.count ?? 0) > 0) return { message: "An administrator already exists. Sign in instead." }
  await query(
    "insert into public.panel_users (email, password_hash) values (lower($1), $2)",
    [parsed.data.email, await hashPassword(parsed.data.password)],
  )
  redirect("/login")
}
