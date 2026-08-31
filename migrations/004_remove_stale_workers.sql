create or replace function public.reconcile_expired_pipeline_leases()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.jobs
    set state = case when attempt_count < max_attempts then 'queued'::public.job_state else 'failed'::public.job_state end,
        assigned_worker_id = case when attempt_count < max_attempts then null else assigned_worker_id end,
        claim_token = case when attempt_count < max_attempts then null else claim_token end,
        leased_until = null,
        error_code = 'lease_expired',
        error_message = 'Worker stopped heartbeating before the lease expired.',
        failed_at = case when attempt_count >= max_attempts then now() else failed_at end,
        updated_at = now()
    where state in ('claiming', 'claimed', 'processing', 'uploading')
      and leased_until < now()
    returning assigned_worker_id
  )
  select count(*) into v_count from expired;

  update public.workers w
  set state = 'offline', current_job_id = null
  where last_seen_at < now() - make_interval(secs => (
    select worker_stale_seconds from public.pipeline_settings where id = 1
  )) and state <> 'disabled';

  delete from public.workers w
  where w.state = 'offline'
    and w.last_seen_at < now() - make_interval(secs => (
      select worker_stale_seconds from public.pipeline_settings where id = 1
    ))
    and not exists (
      select 1
      from public.jobs j
      where j.assigned_worker_id = w.id
        and j.state in ('claiming', 'claimed', 'processing', 'uploading')
    );

  return v_count;
end;
$$;
