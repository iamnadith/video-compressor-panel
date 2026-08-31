"use server"

import { redirect } from "next/navigation"
import { z } from "zod"

import { isPanelConfigured } from "@/lib/env"
import { createPanelSession, deletePanelSession, verifyPassword } from "@/lib/auth"
import { query } from "@/lib/db"

const loginSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
})

export type LoginState = {
  errors?: { email?: string[]; password?: string[] }
  message?: string
}

export async function loginAction(_state: LoginState, formData: FormData): Promise<LoginState> {
  if (!isPanelConfigured()) return { message: "Complete the panel environment setup first." }
  const result = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  })
  if (!result.success) return { errors: result.error.flatten().fieldErrors }

  const resultUser = await query<{ id: string; password_hash: string }>(
    "select id, password_hash from public.panel_users where lower(email) = lower($1)",
    [result.data.email],
  )
  const user = resultUser.rows[0]
  if (!user || !(await verifyPassword(result.data.password, user.password_hash))) {
    return { message: "The email or password is incorrect." }
  }
  await query("update public.panel_users set last_login_at = now() where id = $1", [user.id])
  await createPanelSession(user.id)
  redirect("/dashboard")
}

export async function logoutAction() {
  if (isPanelConfigured()) await deletePanelSession()
  redirect("/login")
}
