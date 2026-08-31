create extension if not exists pgcrypto;

create type public.worker_state as enum ('online', 'idle', 'busy', 'offline', 'disabled');
create type public.job_state as enum (
  'queued',
  'claiming',
  'claimed',
  'processing',
  'uploading',
  'completed',
  'failed',
  'cancelled'
);
create type public.event_level as enum ('info', 'warning', 'error');

create table public.panel_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table public.panel_sessions (
  token_hash text primary key,
  user_id uuid not null references public.panel_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index panel_sessions_user_idx on public.panel_sessions(user_id);
create index panel_sessions_expiry_idx on public.panel_sessions(expires_at);

create table public.pipeline_settings (
  id smallint primary key default 1 check (id = 1),
  ingest_prefix text not null default 'ingest',
  claimed_prefix text not null default 'claimed',
  processed_prefix text not null default 'processed',
  r2_account_id text,
  r2_access_key_id text,
  r2_secret_access_key text,
  r2_bucket text,
  orchestrator_url text,
  max_resolution integer not null default 720 check (max_resolution between 144 and 4320),
  target_size_mb integer not null default 300 check (target_size_mb between 50 and 10000),
  minimum_input_size_mb integer not null default 300 check (minimum_input_size_mb between 0 and 10000),
  ffmpeg_preset text not null default 'fast' check (
    ffmpeg_preset in ('ultrafast','superfast','veryfast','faster','fast','medium','slow','slower','veryslow','placebo')
  ),
  audio_bitrate_kbps integer not null default 128 check (audio_bitrate_kbps between 64 and 512),
  minimum_video_bitrate_kbps integer not null default 200 check (minimum_video_bitrate_kbps between 50 and 10000),
  lease_seconds integer not null default 180 check (lease_seconds between 30 and 3600),
  worker_stale_seconds integer not null default 120 check (worker_stale_seconds between 30 and 3600),
  max_attempts integer not null default 5 check (max_attempts between 1 and 25),
  worker_secret_hash text,
  orchestrator_secret_hash text,
  secret_hash_salt text not null default encode(gen_random_bytes(32), 'hex'),
  worker_secret_updated_at timestamptz,
  orchestrator_secret_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.panel_users(id) on delete set null
);

insert into public.pipeline_settings (id) values (1) on conflict do nothing;

create table public.workers (
  id uuid primary key default gen_random_uuid(),
  instance_id text not null unique,
  display_name text not null,
  hostname text not null,
  platform text not null,
  architecture text,
  agent_version text not null,
  capabilities jsonb not null default '{}'::jsonb,
  state public.worker_state not null default 'online',
  current_job_id uuid,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_ip inet,
  last_error text,
  metadata jsonb not null default '{}'::jsonb
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  source_bucket text not null,
  source_key text not null,
  source_etag text not null,
  source_size bigint not null check (source_size >= 0),
  source_last_modified timestamptz,
  source_content_type text,
  claimed_key text,
  output_key text,
  output_etag text,
  output_size bigint check (output_size is null or output_size >= 0),
  state public.job_state not null default 'queued',
  priority integer not null default 0,
  assigned_worker_id uuid references public.workers(id) on delete set null,
  claim_token uuid,
  leased_until timestamptz,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  progress numeric(5,2) not null default 0 check (progress between 0 and 100),
  current_pass text,
  settings_snapshot jsonb,
  error_code text,
  error_message text,
  discovered_at timestamptz not null default now(),
  claimed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (source_bucket, source_key, source_etag)
);

alter table public.workers
  add constraint workers_current_job_id_fkey
  foreign key (current_job_id) references public.jobs(id) on delete set null;

create index jobs_queue_order_idx on public.jobs (priority desc, source_last_modified asc, discovered_at asc)
  where state = 'queued';
create index jobs_lease_idx on public.jobs (leased_until)
  where state in ('claiming', 'claimed', 'processing', 'uploading');
create index jobs_worker_idx on public.jobs (assigned_worker_id, state);
create index workers_last_seen_idx on public.workers (last_seen_at desc);

create table public.pipeline_events (
  id bigint generated always as identity primary key,
  level public.event_level not null default 'info',
  kind text not null,
  message text not null,
  job_id uuid references public.jobs(id) on delete cascade,
  worker_id uuid references public.workers(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index pipeline_events_created_idx on public.pipeline_events (created_at desc);
create index pipeline_events_job_idx on public.pipeline_events (job_id, created_at desc);

create table public.reconcile_runs (
  id bigint generated always as identity primary key,
  trigger_source text not null,
  discovered_count integer not null default 0,
  repaired_count integer not null default 0,
  requeued_count integer not null default 0,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.reconcile_cursors (
  prefix text primary key,
  continuation_token text,
  completed_cycles bigint not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.reconcile_cursors (prefix) values ('ingest'), ('claimed'), ('processed')
on conflict do nothing;

create table public.reconcile_control (
  id smallint primary key default 1 check (id = 1),
  lease_token uuid,
  leased_until timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.reconcile_control (id) values (1) on conflict do nothing;

create or replace function public.register_pipeline_worker(
  p_instance_id text,
  p_display_name text,
  p_hostname text,
  p_platform text,
  p_architecture text,
  p_agent_version text,
  p_capabilities jsonb,
  p_last_ip inet default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.workers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker public.workers;
begin
  insert into public.workers (
    instance_id, display_name, hostname, platform, architecture,
    agent_version, capabilities, state, last_seen_at, last_ip, metadata
  ) values (
    p_instance_id, p_display_name, p_hostname, p_platform, p_architecture,
    p_agent_version, coalesce(p_capabilities, '{}'::jsonb), 'online'::public.worker_state, now(), p_last_ip,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (instance_id) do update set
    display_name = excluded.display_name,
    hostname = excluded.hostname,
    platform = excluded.platform,
    architecture = excluded.architecture,
    agent_version = excluded.agent_version,
    capabilities = excluded.capabilities,
    last_seen_at = now(),
    last_ip = excluded.last_ip,
    metadata = excluded.metadata,
    state = case
      when workers.state = 'disabled'::public.worker_state then 'disabled'::public.worker_state
      else 'online'::public.worker_state
    end
  returning * into v_worker;

  return v_worker;
end;
$$;

create or replace function public.claim_next_pipeline_job(
  p_worker_id uuid,
  p_lease_seconds integer default 180
)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs;
  v_settings public.pipeline_settings;
begin
  select * into v_settings from public.pipeline_settings where id = 1;

  if not exists (
    select 1 from public.workers where id = p_worker_id and state <> 'disabled'
  ) then
    raise exception 'worker_not_available';
  end if;

  if exists (
    select 1 from public.jobs
    where assigned_worker_id = p_worker_id
      and state in ('claiming', 'claimed', 'processing', 'uploading')
      and leased_until >= now()
  ) then
    raise exception 'worker_already_has_active_job';
  end if;

  select * into v_job
  from public.jobs
  where state = 'queued' and attempt_count < max_attempts
  order by priority desc, source_last_modified asc nulls last, discovered_at asc
  for update skip locked
  limit 1;

  if v_job.id is null then
    update public.workers
    set state = 'idle', current_job_id = null, last_seen_at = now()
    where id = p_worker_id;
    return null;
  end if;

  update public.jobs
  set state = 'claiming',
      assigned_worker_id = p_worker_id,
      claim_token = gen_random_uuid(),
      leased_until = now() + make_interval(secs => greatest(30, p_lease_seconds)),
      attempt_count = attempt_count + 1,
      claimed_at = coalesce(claimed_at, now()),
      error_code = null,
      error_message = null,
      settings_snapshot = jsonb_build_object(
        'max_resolution', v_settings.max_resolution,
        'target_size_mb', v_settings.target_size_mb,
        'ffmpeg_preset', v_settings.ffmpeg_preset,
        'audio_bitrate_kbps', v_settings.audio_bitrate_kbps,
        'minimum_video_bitrate_kbps', v_settings.minimum_video_bitrate_kbps
      ),
      updated_at = now()
  where id = v_job.id
  returning * into v_job;

  update public.workers
  set state = 'busy', current_job_id = v_job.id, last_seen_at = now()
  where id = p_worker_id;

  insert into public.pipeline_events (kind, message, job_id, worker_id)
  values ('job.claimed', 'Job atomically assigned to worker.', v_job.id, p_worker_id);

  return v_job;
end;
$$;

create or replace function public.mark_pipeline_job_ready(
  p_job_id uuid,
  p_worker_id uuid,
  p_claim_token uuid,
  p_claimed_key text,
  p_output_key text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.jobs set
    state = 'claimed', claimed_key = p_claimed_key, output_key = p_output_key,
    updated_at = now()
  where id = p_job_id and assigned_worker_id = p_worker_id
    and claim_token = p_claim_token and state = 'claiming'
    and leased_until >= now();
  return found;
end;
$$;

create or replace function public.heartbeat_pipeline_job(
  p_job_id uuid,
  p_worker_id uuid,
  p_claim_token uuid,
  p_progress numeric,
  p_current_pass text,
  p_state public.job_state,
  p_lease_seconds integer default 180
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_state not in ('claimed', 'processing', 'uploading') then
    raise exception 'invalid_heartbeat_state';
  end if;

  update public.jobs set
    state = p_state,
    progress = least(100, greatest(0, coalesce(p_progress, progress))),
    current_pass = p_current_pass,
    started_at = case when p_state = 'processing' then coalesce(started_at, now()) else started_at end,
    leased_until = now() + make_interval(secs => greatest(30, p_lease_seconds)),
    updated_at = now()
  where id = p_job_id and assigned_worker_id = p_worker_id
    and claim_token = p_claim_token
    and state in ('claimed', 'processing', 'uploading')
    and leased_until >= now();

  if found then
    update public.workers set state = 'busy', current_job_id = p_job_id, last_seen_at = now()
    where id = p_worker_id;
  end if;
  return found;
end;
$$;

create or replace function public.complete_pipeline_job(
  p_job_id uuid,
  p_worker_id uuid,
  p_claim_token uuid,
  p_output_etag text,
  p_output_size bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.jobs set
    state = 'completed', progress = 100, current_pass = null,
    output_etag = p_output_etag, output_size = p_output_size,
    leased_until = null, completed_at = now(), updated_at = now()
  where id = p_job_id and assigned_worker_id = p_worker_id
    and claim_token = p_claim_token and state in ('claimed', 'processing', 'uploading')
    and leased_until >= now();

  if not found then return false; end if;

  update public.workers set state = 'idle', current_job_id = null, last_seen_at = now()
  where id = p_worker_id;
  insert into public.pipeline_events (kind, message, job_id, worker_id)
  values ('job.completed', 'Processed output verified and job completed.', p_job_id, p_worker_id);
  return true;
end;
$$;

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

  return v_count;
end;
$$;

create or replace function public.begin_pipeline_reconcile(p_lease_seconds integer default 240)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid := gen_random_uuid();
begin
  update public.reconcile_control
  set lease_token = v_token,
      leased_until = now() + make_interval(secs => greatest(30, p_lease_seconds)),
      updated_at = now()
  where id = 1 and (leased_until is null or leased_until < now());

  if not found then return null; end if;
  return v_token;
end;
$$;

create or replace function public.finish_pipeline_reconcile(p_lease_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.reconcile_control
  set lease_token = null, leased_until = null, updated_at = now()
  where id = 1 and lease_token = p_lease_token;
  return found;
end;
$$;
