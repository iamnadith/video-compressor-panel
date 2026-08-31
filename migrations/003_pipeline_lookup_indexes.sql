-- Reconciliation resolves object keys back to jobs. These lookups must stay
-- indexed as the number of workers and completed objects grows.
create index if not exists jobs_claimed_key_idx
  on public.jobs (claimed_key)
  where claimed_key is not null;

create index if not exists jobs_output_key_idx
  on public.jobs (output_key)
  where output_key is not null;

create index if not exists workers_current_job_idx
  on public.workers (current_job_id)
  where current_job_id is not null;
