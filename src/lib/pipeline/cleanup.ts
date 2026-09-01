import "server-only"

import { withTransaction } from "@/lib/db"

export async function clearPipelineDatabase(prefixes: string[]) {
  const uniquePrefixes = [...new Set(prefixes.map((prefix) => prefix.trim()).filter(Boolean))]
  if (!uniquePrefixes.length) throw new Error("No pipeline prefixes are configured.")

  await withTransaction(async (client) => {
    await client.query(
      `truncate table public.pipeline_events, public.jobs, public.workers,
       public.reconcile_runs, public.reconcile_cursors, public.reconcile_control
       restart identity`,
    )
    await client.query(
      `insert into public.reconcile_cursors (prefix)
       select unnest($1::text[])
       on conflict (prefix) do nothing`,
      [uniquePrefixes],
    )
    await client.query("insert into public.reconcile_control (id) values (1)")
  })
}
