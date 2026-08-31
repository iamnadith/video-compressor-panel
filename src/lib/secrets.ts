import "server-only"

import { createHash, timingSafeEqual } from "node:crypto"

import { query } from "@/lib/db"
import { createAdminClient } from "@/lib/db-client"

type SecretKind = "worker" | "orchestrator"

export async function hashSharedSecret(secret: string, kind: SecretKind): Promise<string> {
  const result = await query<{ secret_hash_salt: string }>("select secret_hash_salt from public.pipeline_settings where id = 1")
  const salt = result.rows[0]?.secret_hash_salt ?? "uninitialized"
  return createHash("sha256")
    .update(`${kind}\0${secret}\0${salt}`, "utf8")
    .digest("hex")
}

function equalHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"))
}

export async function verifySharedSecret(secret: string, kind: SecretKind): Promise<boolean> {
  if (!secret) return false
  const admin = createAdminClient()
  const column = kind === "worker" ? "worker_secret_hash" : "orchestrator_secret_hash"
  const { data, error } = await admin
    .from("pipeline_settings")
    .select(column)
    .eq("id", 1)
    .single()

  if (error) throw error
  const stored = data?.[column as keyof typeof data]
  const expected = typeof stored === "string" && stored ? stored : ""

  return Boolean(expected) && equalHex(await hashSharedSecret(secret, kind), expected)
}

export async function requireOrchestrator(request: Request): Promise<Response | null> {
  const secret = request.headers.get("x-orchestrator-secret") ?? ""
  if (!(await verifySharedSecret(secret, "orchestrator"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }
  return null
}

export async function requireWorkerSecret(request: Request): Promise<Response | null> {
  const secret = request.headers.get("x-worker-secret") ?? ""
  if (!(await verifySharedSecret(secret, "worker"))) {
    return Response.json({ error: "invalid_worker_secret" }, { status: 401 })
  }
  return null
}
