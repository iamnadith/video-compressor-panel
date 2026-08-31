import "server-only"

import { randomBytes, createHash, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"
import { cache } from "react"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { isPanelConfigured } from "@/lib/env"
import { query } from "@/lib/db"

const scrypt = promisify(nodeScrypt)
const SESSION_COOKIE = "video_pipeline_session"
const SESSION_DAYS = 30

export type PanelUser = { id: string; email: string }

function sessionHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex")
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url")
  const derived = await scrypt(password, salt, 64) as Buffer
  return `scrypt$${salt}$${derived.toString("base64url")}`
}

export async function verifyPassword(password: string, encoded: string) {
  const [, salt, expected] = encoded.split("$")
  if (!salt || !expected) return false
  const actual = await scrypt(password, salt, 64) as Buffer
  const expectedBuffer = Buffer.from(expected, "base64url")
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer)
}

export async function createPanelSession(userId: string) {
  const token = randomBytes(32).toString("base64url")
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000)
  await query(
    "insert into public.panel_sessions (token_hash, user_id, expires_at) values ($1, $2, $3)",
    [sessionHash(token), userId, expiresAt.toISOString()],
  )
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  })
}

export async function deletePanelSession() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (token) await query("delete from public.panel_sessions where token_hash = $1", [sessionHash(token)])
  cookieStore.delete(SESSION_COOKIE)
}

export const getCurrentUser = cache(async (): Promise<PanelUser | null> => {
  if (!isPanelConfigured()) return null
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null
  const result = await query<PanelUser>(
    `select u.id, u.email
       from public.panel_sessions s
       join public.panel_users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now()`,
    [sessionHash(token)],
  )
  const user = result.rows[0] ?? null
  if (user) {
    await query("update public.panel_sessions set last_seen_at = now() where token_hash = $1", [sessionHash(token)])
  }
  return user
})

export const requireUser = cache(async () => {
  if (!isPanelConfigured()) redirect("/setup")
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  return user
})
