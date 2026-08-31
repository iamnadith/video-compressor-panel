import { z } from "zod"

export const registerWorkerSchema = z.object({
  instance_id: z.string().min(8).max(200),
  display_name: z.string().min(1).max(200),
  hostname: z.string().min(1).max(255),
  platform: z.string().min(1).max(120),
  architecture: z.string().max(120).optional().default("unknown"),
  agent_version: z.string().min(1).max(80),
  capabilities: z.record(z.string(), z.unknown()).optional().default({}),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
})

export const workerIdentitySchema = z.object({
  worker_id: z.uuid(),
})

export const heartbeatSchema = workerIdentitySchema.extend({
  claim_token: z.uuid(),
  progress: z.number().min(0).max(100),
  current_pass: z.string().max(40).nullable().optional(),
  state: z.enum(["claimed", "processing", "uploading"]),
})

export const completeSchema = workerIdentitySchema.extend({
  claim_token: z.uuid(),
})

export const failSchema = workerIdentitySchema.extend({
  claim_token: z.uuid(),
  error_code: z.string().min(1).max(120),
  error_message: z.string().min(1).max(2000),
  retryable: z.boolean().default(true),
})

export async function parseJson<T>(request: Request, schema: z.ZodType<T>) {
  try {
    const body = await request.json()
    const result = schema.safeParse(body)
    if (!result.success) {
      return { data: null, response: Response.json({
        error: "invalid_request",
        details: result.error.flatten(),
      }, { status: 400 }) }
    }
    return { data: result.data, response: null }
  } catch {
    return { data: null, response: Response.json({ error: "invalid_json" }, { status: 400 }) }
  }
}

