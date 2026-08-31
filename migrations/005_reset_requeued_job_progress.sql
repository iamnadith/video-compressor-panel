create or replace function public.fail_pipeline_job(
  p_job_id uuid,
  p_worker_id uuid,
  p_claim_token uuid,
  p_error_code text,
  p_error_message text,
  p_retryable boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_final_state public.job_state;
begin
  select case when p_retryable and attempt_count < max_attempts then 'queued'::public.job_state else 'failed'::public.job_state end
  into v_final_state from public.jobs
  where id = p_job_id and assigned_worker_id = p_worker_id and claim_token = p_claim_token;

  if v_final_state is null then return false; end if;

  update public.jobs set
    state = v_final_state,
    assigned_worker_id = case when v_final_state = 'queued' then null else assigned_worker_id end,
    claim_token = case when v_final_state = 'queued' then null else claim_token end,
    leased_until = null,
    progress = case when v_final_state = 'queued' then 0 else progress end,
    current_pass = case when v_final_state = 'queued' then null else current_pass end,
    output_etag = case when v_final_state = 'queued' then null else output_etag end,
    output_size = case when v_final_state = 'queued' then null else output_size end,
    claimed_at = case when v_final_state = 'queued' then null else claimed_at end,
    started_at = case when v_final_state = 'queued' then null else started_at end,
    error_code = left(coalesce(p_error_code, 'worker_error'), 120),
    error_message = left(coalesce(p_error_message, 'Worker reported an error.'), 2000),
    failed_at = case when v_final_state = 'failed' then now() else failed_at end,
    updated_at = now()
  where id = p_job_id and assigned_worker_id = p_worker_id and claim_token = p_claim_token
    and leased_until >= now();

  if not found then return false; end if;

  update public.workers set state = 'idle', current_job_id = null, last_seen_at = now(),
    last_error = left(coalesce(p_error_message, p_error_code), 1000)
  where id = p_worker_id;
  insert into public.pipeline_events (level, kind, message, job_id, worker_id, details)
  values (
    case when v_final_state = 'failed' then 'error'::public.event_level else 'warning'::public.event_level end,
    case when v_final_state = 'failed' then 'job.failed' else 'job.requeued' end,
    coalesce(p_error_message, 'Worker reported an error.'), p_job_id, p_worker_id,
    jsonb_build_object('code', p_error_code, 'retryable', p_retryable)
  );
  return true;
end;
$$;

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
        progress = case when attempt_count < max_attempts then 0 else progress end,
        current_pass = case when attempt_count < max_attempts then null else current_pass end,
        output_etag = case when attempt_count < max_attempts then null else output_etag end,
        output_size = case when attempt_count < max_attempts then null else output_size end,
        claimed_at = case when attempt_count < max_attempts then null else claimed_at end,
        started_at = case when attempt_count < max_attempts then null else started_at end,
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
