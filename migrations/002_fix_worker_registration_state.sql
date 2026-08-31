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
    p_agent_version, coalesce(p_capabilities, '{}'::jsonb),
    'online'::public.worker_state, now(), p_last_ip,
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
