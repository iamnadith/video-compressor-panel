import "server-only"

type ServerEnv = {
  databaseUrl: string
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export function getServerEnv(): ServerEnv {
  return {
    databaseUrl: required("DATABASE_URL"),
  }
}

export function isPanelConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim())
}
