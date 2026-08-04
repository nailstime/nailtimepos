-- rename_counter: changes the counter code within the same branch.
-- The display URL embeds the code, so existing QR links will break after rename.
create or replace function public.rename_counter(p_counter uuid, p_new_code text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_owner public.staff%rowtype;
  v_counter public.counters%rowtype;
  v_code text := upper(btrim(coalesce(p_new_code, '')));
begin
  v_owner := private.require_staff(true);

  if v_code !~ '^[A-Z0-9_-]{1,20}$' then
    raise exception 'invalid counter code';
  end if;

  select * into v_counter
  from public.counters
  where id = p_counter and branch_id = v_owner.branch_id
  for update;
  if not found then raise exception 'counter not found'; end if;

  if exists (
    select 1 from public.counters
    where branch_id = v_owner.branch_id and code = v_code and id <> p_counter
  ) then
    raise exception 'counter code already exists in this branch';
  end if;

  update public.counters set code = v_code where id = p_counter;

  return jsonb_build_object('id', p_counter, 'code', v_code);
end;
$$;

revoke all on function public.rename_counter(uuid, text) from public, anon;
grant execute on function public.rename_counter(uuid, text) to authenticated;

-- delete_counter: permanently removes a counter and its paired devices.
-- Blocked if the counter has an open order in progress.
create or replace function public.delete_counter(p_counter uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_owner public.staff%rowtype;
  v_counter public.counters%rowtype;
begin
  v_owner := private.require_staff(true);

  select * into v_counter
  from public.counters
  where id = p_counter and branch_id = v_owner.branch_id
  for update;
  if not found then raise exception 'counter not found'; end if;

  if v_counter.current_order_id is not null then
    raise exception 'counter has an open order — close or void the order first';
  end if;

  delete from public.counters where id = p_counter;
end;
$$;

revoke all on function public.delete_counter(uuid) from public, anon;
grant execute on function public.delete_counter(uuid) to authenticated;
