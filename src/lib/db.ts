/* eslint-disable @typescript-eslint/no-explicit-any -- the provider-neutral query adapter returns dynamic SQL rows. */
import "server-only"

import { Pool, type QueryResultRow } from "pg"

import { getServerEnv } from "@/lib/env"

type DbResult<T = any> = { data: T | null; error: Error | null; count?: number | null }
type Filter = { column: string; operator: "=" | "ANY"; value: unknown }
type SelectOptions = { count?: "exact"; head?: boolean }

const TABLES = new Set([
  "pipeline_settings", "workers", "jobs", "pipeline_events",
  "reconcile_runs", "reconcile_cursors", "reconcile_control",
  "panel_users", "panel_sessions",
])

let pool: Pool | undefined

/**
 * node-postgres turns any sslmode query parameter into an SSL object before it
 * applies the explicit `ssl` option.  Strip those libpq SSL parameters so the
 * panel can enforce plaintext PostgreSQL connections for transaction poolers,
 * even when a provider's copied URL contains `sslmode=require`.
 */
function connectionStringWithoutSslOptions(connectionString: string) {
  try {
    const url = new URL(connectionString)
    for (const key of ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert", "sslnegotiation"]) {
      url.searchParams.delete(key)
    }
    return url.toString()
  } catch {
    // DATABASE_URL is documented as a URL. Preserve non-URL libpq strings for
    // compatibility; `ssl: false` still handles strings without SSL options.
    return connectionString
  }
}

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: connectionStringWithoutSslOptions(getServerEnv().databaseUrl),
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: false,
    })
  }
  return pool
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
  return getPool().query<T>(text, values)
}

export async function withTransaction<T>(callback: (client: { query: (text: string, values?: unknown[]) => Promise<any> }) => Promise<T>) {
  const client = await getPool().connect()
  try {
    await client.query("begin")
    const result = await callback({ query: (text: string, values: unknown[] = []) => client.query(text, values) })
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

function identifier(value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Invalid database identifier: ${value}`)
  return `"${value}"`
}

function tableName(value: string) {
  if (!TABLES.has(value)) throw new Error(`Unsupported database table: ${value}`)
  return `public.${identifier(value)}`
}

function splitColumns(columns: string) {
  const result: string[] = []
  let depth = 0
  let current = ""
  for (const character of columns) {
    if (character === "(") depth += 1
    if (character === ")") depth -= 1
    if (character === "," && depth === 0) {
      result.push(current.trim())
      current = ""
    } else current += character
  }
  if (current.trim()) result.push(current.trim())
  return result
}

const relations: Record<string, { table: string; foreignKey: string }> = {
  workers: { table: "workers", foreignKey: "assigned_worker_id" },
  jobs: { table: "jobs", foreignKey: "job_id" },
}

function selectSql(table: string, columns: string) {
  const base = identifier(table)
  const fields = splitColumns(columns)
  if (fields.length === 1 && fields[0] === "*") return { sql: `${base}.*`, nested: [] as string[] }
  const expressions: string[] = []
  const nested: string[] = []
  for (const field of fields) {
    const nestedMatch = field.match(/^([A-Za-z_][A-Za-z0-9_]*)\(([^()]*)\)$/)
    if (nestedMatch) {
      const [, relation, inner] = nestedMatch
      const relationInfo = relations[relation]
      if (!relationInfo) throw new Error(`Unsupported relation: ${relation}`)
      for (const child of splitColumns(inner)) {
        expressions.push(`${identifier(relation)}.${identifier(child)} AS ${identifier(`__relation_${relation}_${child}`)}`)
        nested.push(`${relation}:${child}`)
      }
      continue
    }
    expressions.push(`${base}.${identifier(field)}`)
  }
  return { sql: expressions.join(", "), nested }
}

function hydrateRelations(row: QueryResultRow, nested: string[]) {
  if (!nested.length) return row
  const hydrated: Record<string, unknown> = { ...row }
  for (const item of nested) {
    const [relation, child] = item.split(":")
    const key = `__relation_${relation}_${child}`
    const value = hydrated[key]
    delete hydrated[key]
    const existing = hydrated[relation]
    const current = (Array.isArray(existing) ? existing[0] : existing) as Record<string, unknown> | null | undefined ?? {}
    current[child] = value
    hydrated[relation] = Object.values(current).some((entry) => entry !== null && entry !== undefined) ? [current] : []
  }
  return hydrated
}

type SingleQuery<T extends QueryResultRow> = Omit<QueryBuilder<T>, "then" | "execute"> & PromiseLike<DbResult<T>>

class QueryBuilder<T extends QueryResultRow = Record<string, any>> implements PromiseLike<DbResult<any>> {
  private operation: "select" | "insert" | "update" | "upsert" = "select"
  private columns = "*"
  private options: SelectOptions = {}
  private values: Record<string, unknown>[] = []
  private filters: Filter[] = []
  private sort: { column: string; ascending: boolean } | undefined
  private maxRows: number | undefined
  private conflict: { columns: string[]; ignore: boolean } | undefined
  private cardinality: "many" | "single" | "maybeSingle" = "many"

  constructor(private readonly table: string) {
    tableName(table)
  }

  select(columns = "*", options: SelectOptions = {}) {
    this.columns = columns
    this.options = options
    return this
  }

  insert(values: Record<string, unknown> | Record<string, unknown>[]) {
    this.operation = "insert"
    this.values = Array.isArray(values) ? values : [values]
    return this
  }

  update(values: Record<string, unknown>) {
    this.operation = "update"
    this.values = [values]
    return this
  }

  upsert(values: Record<string, unknown> | Record<string, unknown>[], options: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.operation = "upsert"
    this.values = Array.isArray(values) ? values : [values]
    const defaultConflict = this.table === "reconcile_cursors" ? "prefix" : "id"
    this.conflict = { columns: (options.onConflict ?? defaultConflict).split(",").map((value) => value.trim()), ignore: Boolean(options.ignoreDuplicates) }
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, operator: "=", value })
    return this
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ column, operator: "ANY", value })
    return this
  }

  order(column: string, options: { ascending?: boolean } = {}) {
    this.sort = { column, ascending: options.ascending !== false }
    return this
  }

  limit(value: number) {
    this.maxRows = value
    return this
  }

  single(): SingleQuery<T> {
    this.cardinality = "single"
    return this as unknown as SingleQuery<T>
  }

  maybeSingle(): SingleQuery<T> {
    this.cardinality = "maybeSingle"
    return this as unknown as SingleQuery<T>
  }

  async execute(): Promise<DbResult<any>> {
    try {
      const result = await this.run()
      return result
    } catch (error) {
      return { data: null, error: error instanceof Error ? error : new Error(String(error)) }
    }
  }

  then<TResult1 = DbResult<any>, TResult2 = never>(
    onfulfilled?: ((value: DbResult<any>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected)
  }

  private parameters(start: number) {
    const values: unknown[] = []
    const clauses: string[] = []
    let index = start
    for (const filter of this.filters) {
      if (filter.operator === "ANY") {
        clauses.push(`${identifier(this.table)}.${identifier(filter.column)} = ANY($${index})`)
      } else clauses.push(`${identifier(this.table)}.${identifier(filter.column)} = $${index}`)
      values.push(filter.value)
      index += 1
    }
    return { clauses, values, next: index }
  }

  private async run(): Promise<DbResult<any>> {
    if (this.operation === "select") return this.runSelect()
    const rows = this.values
    if (!rows.length) throw new Error("A database write requires values")
    const keys = Object.keys(rows[0])
    if (!keys.length) throw new Error("A database write requires columns")
    const values: unknown[] = []
    const tuples = rows.map((row) => `(${keys.map((key) => { values.push(row[key]); return `$${values.length}` }).join(", ")})`)
    const returning = this.columns === "*"
      ? "*"
      : splitColumns(this.columns).map((column) => identifier(column)).join(", ")
    let sql = ""
    if (this.operation === "insert") {
      sql = `insert into ${tableName(this.table)} (${keys.map(identifier).join(", ")}) values ${tuples.join(", ")} returning ${returning}`
    } else if (this.operation === "upsert") {
      const conflict = this.conflict?.columns.map(identifier).join(", ")
      const updates = this.conflict?.ignore ? "do nothing" : `do update set ${keys.filter((key) => !this.conflict?.columns.includes(key)).map((key) => `${identifier(key)} = excluded.${identifier(key)}`).join(", ")}`
      sql = `insert into ${tableName(this.table)} (${keys.map(identifier).join(", ")}) values ${tuples.join(", ")} on conflict (${conflict}) ${updates} returning ${returning}`
    } else {
      const assignments = keys.map((key) => `${identifier(key)} = $${values.push(rows[0][key])}`)
      const parameters = this.parameters(values.length + 1)
      sql = `update ${tableName(this.table)} set ${assignments.join(", ")} where ${parameters.clauses.join(" and ") || "true"} returning ${returning}`
      values.push(...parameters.values)
    }
    const result = await query<T>(sql, values)
    return this.cardinal(result.rows)
  }

  private async runSelect(): Promise<DbResult<any>> {
    const selected = selectSql(this.table, this.columns)
    const parameters = this.parameters(1)
    const joins: string[] = []
    for (const relation of selected.nested.map((value) => value.split(":")[0])) {
      const info = relations[relation]
      const joinColumn = this.table === "pipeline_events"
        ? relation === "jobs" ? "job_id" : "worker_id"
        : "assigned_worker_id"
      joins.push(`left join ${tableName(info.table)} as ${identifier(relation)} on ${identifier(relation)}.${identifier("id")} = ${identifier(this.table)}.${identifier(joinColumn)}`)
    }
    const where = parameters.clauses.length ? ` where ${parameters.clauses.join(" and ")}` : ""
    const order = this.sort ? ` order by ${identifier(this.table)}.${identifier(this.sort.column)} ${this.sort.ascending ? "asc" : "desc"}` : ""
    const limit = this.maxRows ? ` limit ${Math.max(0, Math.floor(this.maxRows))}` : ""
    if (this.options.head) {
      const countResult = await query<{ count: number }>(`select count(*)::int as count from ${tableName(this.table)}${where}`, parameters.values)
      return { data: null, error: null, count: Number(countResult.rows[0]?.count ?? 0) }
    }
    const result = await query<T>(`select ${selected.sql} from ${tableName(this.table)} ${joins.join(" ")}${where}${order}${limit}`, parameters.values)
    return this.cardinal(result.rows.map((row) => hydrateRelations(row, selected.nested) as T))
  }

  private cardinal(rows: T[]): DbResult<any> {
    if (this.cardinality === "single") {
      if (rows.length !== 1) return { data: null, error: new Error(rows.length ? "Expected one row" : "No rows found") }
      return { data: rows[0], error: null }
    }
    if (this.cardinality === "maybeSingle") {
      if (rows.length > 1) return { data: null, error: new Error("Expected zero or one row") }
      return { data: rows[0] ?? null, error: null }
    }
    return { data: rows, error: null }
  }
}

const rpcParameters: Record<string, string[]> = {
  register_pipeline_worker: ["p_instance_id", "p_display_name", "p_hostname", "p_platform", "p_architecture", "p_agent_version", "p_capabilities", "p_last_ip", "p_metadata"],
  claim_next_pipeline_job: ["p_worker_id", "p_lease_seconds"],
  mark_pipeline_job_ready: ["p_job_id", "p_worker_id", "p_claim_token", "p_claimed_key", "p_output_key"],
  heartbeat_pipeline_job: ["p_job_id", "p_worker_id", "p_claim_token", "p_progress", "p_current_pass", "p_state", "p_lease_seconds"],
  complete_pipeline_job: ["p_job_id", "p_worker_id", "p_claim_token", "p_output_etag", "p_output_size"],
  fail_pipeline_job: ["p_job_id", "p_worker_id", "p_claim_token", "p_error_code", "p_error_message", "p_retryable"],
  reconcile_expired_pipeline_leases: [],
  begin_pipeline_reconcile: ["p_lease_seconds"],
  finish_pipeline_reconcile: ["p_lease_token"],
}

class DbClient {
  from<T extends QueryResultRow = QueryResultRow>(table: string) {
    return new QueryBuilder<T>(table)
  }

  async rpc<T extends QueryResultRow = QueryResultRow>(name: string, args: Record<string, unknown> = {}): Promise<DbResult<any>> {
    try {
      const parameterNames = rpcParameters[name]
      if (!parameterNames) throw new Error(`Unsupported database function: ${name}`)
      const values = parameterNames.map((parameter) => args[parameter] ?? null)
      const placeholders = values.map((_, index) => `$${index + 1}`).join(", ")
      const result = await query<Record<string, unknown>>(`select * from public.${identifier(name)}(${placeholders})`, values)
      if (["reconcile_expired_pipeline_leases"].includes(name)) return { data: result.rows[0]?.[name] ?? 0, error: null }
      if (["mark_pipeline_job_ready", "heartbeat_pipeline_job", "complete_pipeline_job", "fail_pipeline_job", "finish_pipeline_reconcile"].includes(name)) {
        return { data: result.rows[0]?.[name] ?? false, error: null }
      }
      if (name === "begin_pipeline_reconcile") return { data: result.rows[0]?.[name] ?? null, error: null }
      const row = result.rows[0]
      if (!row || Object.values(row).every((value) => value === null)) return { data: null, error: null }
      return { data: row as T, error: null }
    } catch (error) {
      return { data: null, error: error instanceof Error ? error : new Error(String(error)) }
    }
  }
}

export function createDbClient() {
  return new DbClient()
}
