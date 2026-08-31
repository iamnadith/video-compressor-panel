import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

function requiredBuildValue(name) {
  const value = process.env[name]
  if (!value?.trim()) {
    throw new Error(
      `${name} is missing from Cloudflare Settings > Build > Build Variables and Secrets`,
    )
  }
  return value
}

function validatePanelUrl(raw) {
  const url = new URL(raw.trim())
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error("PANEL_URL must be an HTTPS origin without a path, query, hash, or credentials")
  }
  return url.origin
}

async function run(command, args, env) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit", shell: false })
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Wrangler was terminated by ${signal}`))
      else resolve(code ?? 1)
    })
  })
}

const orchestratorSecret = requiredBuildValue("ORCHESTRATOR_SECRET")
const panelUrl = validatePanelUrl(requiredBuildValue("PANEL_URL"))
const temporaryDirectory = await mkdtemp(join(tmpdir(), "video-orchestrator-deploy-"))
const secretsFile = join(temporaryDirectory, "secrets.json")

try {
  await writeFile(
    secretsFile,
    JSON.stringify({ ORCHESTRATOR_SECRET: orchestratorSecret }),
    { encoding: "utf8", mode: 0o600 },
  )

  const childEnvironment = { ...process.env }
  delete childEnvironment.ORCHESTRATOR_SECRET

  const wranglerEntryPoint = fileURLToPath(
    new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
  )
  const exitCode = await run(
    process.execPath,
    [
      wranglerEntryPoint,
      "deploy",
      "--var",
      `PANEL_URL:${panelUrl}`,
      "--secrets-file",
      secretsFile,
      ...process.argv.slice(2),
    ],
    childEnvironment,
  )
  process.exitCode = exitCode
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
