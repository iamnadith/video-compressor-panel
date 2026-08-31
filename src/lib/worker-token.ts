import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"

import { createAdminClient } from "@/lib/db-client"

type WorkerTokenPayload = {
  worker_id: string
  instance_id: string
  issued_at: number
}

let cachedSigningKey: { value: string; expiresAt: number } | undefined

async function signingKey() {
  if (cachedSigningKey && cachedSigningKey.expiresAt > Date.now()) {
    return cachedSigningKey.value
  }
  const { data, error } = await createAdminClient()
    .from("pipeline_settings")
    .select("worker_secret_hash")
    .eq("id", 1)
    .single()
  if (error) throw error
  const secretHash = (data as { worker_secret_hash?: string | null } | null)?.worker_secret_hash || "unconfigured"
  const value = `processor-session\0${secretHash}`
  cachedSigningKey = { value, expiresAt: Date.now() + 30_000 }
  return value
}

async function sign(encodedPayload: string) {
  return createHmac("sha256", await signingKey())
    .update(`processor-session\0${encodedPayload}`, "utf8")
    .digest("base64url")
}

export async function issueWorkerToken(workerId: string, instanceId: string) {
  const encoded = Buffer.from(JSON.stringify({
    worker_id: workerId,
    instance_id: instanceId,
    issued_at: Date.now(),
  } satisfies WorkerTokenPayload)).toString("base64url")
  return `${encoded}.${await sign(encoded)}`
}

export async function verifyWorkerToken(token: string, expectedWorkerId: string) {
  const [encoded, signature] = token.split(".")
  if (!encoded || !signature) return false
  const expected = await sign(encoded)
  if (expected.length !== signature.length) return false
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return false
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as WorkerTokenPayload
    return payload.worker_id === expectedWorkerId
      && Date.now() - payload.issued_at < 1000 * 60 * 60 * 24 * 90
  } catch {
    return false
  }
}

export async function requireWorkerToken(request: Request, workerId: string): Promise<Response | null> {
  const token = request.headers.get("x-worker-token") ?? ""
  return await verifyWorkerToken(token, workerId)
    ? null
    : Response.json({ error: "invalid_worker_session" }, { status: 401 })
}
