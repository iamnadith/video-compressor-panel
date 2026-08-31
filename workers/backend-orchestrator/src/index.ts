interface Env {
  PANEL_URL: string
  ORCHESTRATOR_SECRET: string
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

function panelUrl(env: Env, pathname: string) {
  const base = env.PANEL_URL.replace(/\/$/, "")
  return `${base}/api/orchestrator${pathname}`
}

async function forward(request: Request, env: Env, workerSecret: string) {
  const url = new URL(request.url)
  const headers = new Headers(request.headers)
  headers.delete("authorization")
  headers.set("x-orchestrator-secret", env.ORCHESTRATOR_SECRET)
  headers.set("x-worker-secret", workerSecret)
  headers.set("x-forwarded-host", url.host)

  const upstream = new Request(panelUrl(env, url.pathname), {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  })
  return fetch(upstream)
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
    const url = `${env.PANEL_URL.replace(/\/$/, "")}/api/orchestrator/v1/reconcile`
    ctx.waitUntil(fetch(url, {
      method: "POST",
      headers: { "x-orchestrator-secret": env.ORCHESTRATOR_SECRET },
    }))
  },
}

export default orchestrator
