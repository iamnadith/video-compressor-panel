interface Env {
  PANEL_URL?: string
  ORCHESTRATOR_SECRET?: string
}

interface SchedulerEvent {
  scheduledTime: number
  cron: string
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void
}

const CONFIG_TTL_SECONDS = 60

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

function bearer(request: Request) {
  const value = request.headers.get("authorization") ?? ""
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : ""
}

function workerConfigError(env: Env): Response | null {
  const missing = [
    ["PANEL_URL", env.PANEL_URL],
    ["ORCHESTRATOR_SECRET", env.ORCHESTRATOR_SECRET],
  ]
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name)

  if (missing.length) {
    console.error("Worker configuration is missing required secrets", { missing })
    return json({ error: "worker_misconfigured", missing }, 500)
  }

  try {
    const parsed = new URL(env.PANEL_URL!)
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error("PANEL_URL must be an origin without a path, query, or hash")
    }
  } catch (error) {
    console.error("Worker PANEL_URL is invalid", error)
    return json({ error: "worker_misconfigured", message: "PANEL_URL must be a valid panel origin." }, 500)
  }

  return null
}

function panelUrl(env: Env, pathname: string) {
  return `${new URL(env.PANEL_URL!).origin}/api/orchestrator${pathname}`
}

async function forward(request: Request, env: Env, workerSecret: string) {
  const url = new URL(request.url)
  const headers = new Headers(request.headers)
  headers.delete("authorization")
  headers.set("x-orchestrator-secret", env.ORCHESTRATOR_SECRET!)
  headers.set("x-worker-secret", workerSecret)
  headers.set("x-forwarded-host", url.host)

  try {
    const upstream = new Request(panelUrl(env, url.pathname), {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    })
    return await fetch(upstream)
  } catch (error) {
    console.error("Panel upstream request failed", error)
    return json({ error: "panel_unreachable", message: "The panel origin could not be reached." }, 502)
  }
}

async function cachedConfig(request: Request, env: Env, workerSecret: string) {
  const cache = (caches as unknown as { default: Cache }).default
  const cacheKey = new Request(`${new URL(request.url).origin}/__cache/runtime-config`)
  const cached = await cache.match(cacheKey)
  if (cached) return cached

  const upstream = await forward(request, env, workerSecret)
  if (!upstream.ok) return upstream
  const response = new Response(upstream.body, upstream)
  response.headers.set("Cache-Control", `public, max-age=${CONFIG_TTL_SECONDS}`)
  await cache.put(cacheKey, response.clone())
  return response
}

async function handle(request: Request, env: Env) {
  const url = new URL(request.url)
  if (url.pathname === "/health") {
    return json({ ok: true, service: "video-pipeline-orchestrator" })
  }
  if (!url.pathname.startsWith("/v1/")) return json({ error: "not_found" }, 404)

  const workerSecret = bearer(request)
  if (!workerSecret) {
    return json({ error: "unauthorized" }, 401)
  }

  const configurationError = workerConfigError(env)
  if (configurationError) return configurationError

  if (request.method === "GET" && url.pathname === "/v1/config") {
    return cachedConfig(request, env, workerSecret)
  }
  return forward(request, env, workerSecret)
}

const orchestrator = {
  fetch(request: Request, env: Env) {
    return handle(request, env)
  },

  async scheduled(_controller: SchedulerEvent, env: Env, ctx: WorkerExecutionContext) {
    const configurationError = workerConfigError(env)
    if (configurationError) return

    const url = `${new URL(env.PANEL_URL!).origin}/api/orchestrator/v1/reconcile`
    ctx.waitUntil((async () => {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "x-orchestrator-secret": env.ORCHESTRATOR_SECRET! },
        })
        if (!response.ok) console.error("Panel reconciliation failed", { status: response.status })
      } catch (error) {
        console.error("Panel reconciliation request failed", error)
      }
    })())
  },
}

export default orchestrator
