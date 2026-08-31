import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import nextEnv from "@next/env"
import { Client } from "pg"

const { loadEnvConfig } = nextEnv

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const migrationsDirectory = join(projectRoot, "migrations")
const migrationNamePattern = /^\d{3}_[a-z0-9_]+\.sql$/
const migrationLockName = "video-compressor-panel:schema-migrations"

loadEnvConfig(projectRoot)

function requiredDatabaseUrl() {
  const value = process.env.DATABASE_URL
  if (!value?.trim()) throw new Error("DATABASE_URL is required to run database migrations")
  return value
}

function connectionStringWithoutSslOptions(connectionString) {
  try {
    const url = new URL(connectionString)
    for (const key of ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert", "sslnegotiation"]) {
      url.searchParams.delete(key)
    }
    return url.toString()
  } catch {
    return connectionString
  }
}

function checksum(contents) {
  return createHash("sha256").update(contents).digest("hex")
}

async function loadMigrations() {
  const names = (await readdir(migrationsDirectory))
    .filter((name) => migrationNamePattern.test(name))
    .sort((left, right) => left.localeCompare(right))

  if (!names.length) throw new Error("No database migrations were found")

  return await Promise.all(names.map(async (name) => {
    const sql = await readFile(join(migrationsDirectory, name), "utf8")
    return { name, sql, checksum: checksum(sql) }
  }))
}

async function baselineLegacySchema(client, migrations) {
  const applied = await client.query("select count(*)::int as count from public.schema_migrations")
  if (applied.rows[0].count !== 0) return

  const legacyObjects = await client.query(`
    select
      to_regtype('public.worker_state') is not null as worker_state,
      to_regtype('public.job_state') is not null as job_state,
      to_regtype('public.event_level') is not null as event_level,
      to_regclass('public.panel_users') is not null as panel_users,
      to_regclass('public.panel_sessions') is not null as panel_sessions,
      to_regclass('public.pipeline_settings') is not null as pipeline_settings,
      to_regclass('public.workers') is not null as workers,
      to_regclass('public.jobs') is not null as jobs,
      to_regclass('public.pipeline_events') is not null as pipeline_events,
      to_regclass('public.reconcile_runs') is not null as reconcile_runs,
      to_regclass('public.reconcile_cursors') is not null as reconcile_cursors,
      to_regclass('public.reconcile_control') is not null as reconcile_control,
      to_regprocedure('public.register_pipeline_worker(text,text,text,text,text,text,jsonb,inet,jsonb)') is not null as register_pipeline_worker,
      to_regprocedure('public.claim_next_pipeline_job(uuid,integer)') is not null as claim_next_pipeline_job,
      to_regprocedure('public.reconcile_expired_pipeline_leases()') is not null as reconcile_expired_pipeline_leases
  `)
  const state = legacyObjects.rows[0]
  const present = Object.entries(state).filter(([, exists]) => exists).map(([name]) => name)
  if (!present.length) return

  const missing = Object.entries(state).filter(([, exists]) => !exists).map(([name]) => name)
  if (missing.length) {
    throw new Error(`Refusing to baseline a partial legacy schema; missing: ${missing.join(", ")}`)
  }

  const initial = migrations.find((migration) => migration.name === "001_initial_pipeline.sql")
  if (!initial) throw new Error("The legacy schema requires 001_initial_pipeline.sql")
  await client.query(
    "insert into public.schema_migrations (name, checksum) values ($1, $2)",
    [initial.name, initial.checksum],
  )
  console.log(`Baselined existing schema as ${initial.name}`)
}

async function run() {
  const migrations = await loadMigrations()
  const client = new Client({
    connectionString: connectionStringWithoutSslOptions(requiredDatabaseUrl()),
    connectionTimeoutMillis: 15_000,
    ssl: false,
  })

  await client.connect()
  try {
    await client.query("select pg_advisory_lock(hashtext($1))", [migrationLockName])
    await client.query(`
      create table if not exists public.schema_migrations (
        name text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `)
    await baselineLegacySchema(client, migrations)

    const result = await client.query("select name, checksum from public.schema_migrations")
    const applied = new Map(result.rows.map((row) => [row.name, row.checksum]))

    for (const migration of migrations) {
      const existingChecksum = applied.get(migration.name)
      if (existingChecksum) {
        if (existingChecksum !== migration.checksum) {
          throw new Error(`Applied migration checksum changed: ${migration.name}`)
        }
        console.log(`Already applied ${migration.name}`)
        continue
      }

      await client.query("begin")
      try {
        await client.query(migration.sql)
        await client.query(
          "insert into public.schema_migrations (name, checksum) values ($1, $2)",
          [migration.name, migration.checksum],
        )
        await client.query("commit")
        console.log(`Applied ${migration.name}`)
      } catch (error) {
        await client.query("rollback")
        throw error
      }
    }
  } finally {
    try {
      await client.query("select pg_advisory_unlock(hashtext($1))", [migrationLockName])
    } finally {
      await client.end()
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
