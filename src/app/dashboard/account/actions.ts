"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { hashPassword, requireUser, verifyPassword } from "@/lib/auth"
import { query } from "@/lib/db"

const accountSchema = z.object({
  email: z.email("Enter a valid email address."),
  current_password: z.string().min(1, "Enter your current password."),
  new_password: z.string().optional().default(""),
  confirm_password: z.string().optional().default(""),
}).superRefine((value, context) => {
  if (value.new_password && value.new_password.length < 12) context.addIssue({ code: "custom", path: ["new_password"], message: "Use at least 12 characters." })
  if (value.new_password !== value.confirm_password) context.addIssue({ code: "custom", path: ["confirm_password"], message: "Passwords do not match." })
})

export type AccountState = { ok?: boolean; message?: string; errors?: Record<string, string[]> }

export async function updateAccountAction(_state: AccountState, formData: FormData): Promise<AccountState> {
  const user = await requireUser()
  const parsed = accountSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors, message: "Review the highlighted fields." }
  const current = await query<{ password_hash: string }>("select password_hash from public.panel_users where id = $1", [user.id])
  if (!current.rows[0] || !(await verifyPassword(parsed.data.current_password, current.rows[0].password_hash))) {
    return { message: "The current password is incorrect." }
  }
  const duplicate = await query<{ id: string }>("select id from public.panel_users where lower(email) = lower($1) and id <> $2", [parsed.data.email, user.id])
  if (duplicate.rows.length) return { message: "That email address is already in use." }
  if (parsed.data.new_password) {
    await query("update public.panel_users set email = lower($1), password_hash = $2 where id = $3", [parsed.data.email, await hashPassword(parsed.data.new_password), user.id])
  } else {
    await query("update public.panel_users set email = lower($1) where id = $2", [parsed.data.email, user.id])
  }
  revalidatePath("/dashboard/account")
  revalidatePath("/dashboard")
  return { ok: true, message: "Account updated." }
}
