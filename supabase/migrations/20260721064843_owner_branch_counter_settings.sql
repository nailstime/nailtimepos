-- Owner-only configuration for the branch bound to the active staff session.
-- Display tokens are shown only when they are created or rotated; only hashes
-- are retained in the database.

create or replace function public.get_branch_counter_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_owner public.staff%rowtype;
  v_branch public.branches%rowtype;
begin
  v_owner := private.require_staff(true);
  select * into v_branch from public.branches where id = v_owner.branch_id;

  return jsonb_build_object(
    'branch', jsonb_build_object(
      'id', v_branch.id,
      'code', v_branch.code,
      'name', v_branch.name,
      'promptpay_id', v_branch.promptpay_id,
      'active', v_branch.active
    ),
    'counters', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id,
        'code', c.code,
        'has_open_order', c.current_order_id is not null
      ) order by c.code), '[]'::jsonb)
      from public.counters c
      where c.branch_id = v_owner.branch_id
    )
  );
end;
$$;

create or replace function public.save_branch_settings(p_name text, p_promptpay_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_owner public.staff%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_promptpay_id text := regexp_replace(coalesce(p_promptpay_id, ''), '\D', '', 'g');
  v_branch public.branches%rowtype;
begin
  v_owner := private.require_staff(true);
  if length(v_name) not between 1 and 120 then
    raise exception 'branch name must be 1 to 120 characters';
  end if;
  if v_promptpay_id !~ '^(\d{10}|\d{13})$' then
    raise exception 'PromptPay ID must contain 10 or 13 digits';
  end if;

  update public.branches
  set name = v_name, promptpay_id = v_promptpay_id
  where id = v_owner.branch_id
  returning * into v_branch;

  return jsonb_build_object(
    'id', v_branch.id,
    'code', v_branch.code,
    'name', v_branch.name,
    'promptpay_id', v_branch.promptpay_id,
    'active', v_branch.active
  );
end;
$$;

create or replace function public.create_branch_counter(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_owner public.staff%rowtype;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_counter public.counters%rowtype;
  v_token text := encode(gen_random_bytes(32), 'hex');
begin
  v_owner := private.require_staff(true);
  if v_code !~ '^[A-Z0-9_-]{1,20}$' then
    raise exception 'counter code must use A-Z, 0-9, _ or - and be 1 to 20 characters';
  end if;
  if exists (select 1 from public.counters where branch_id = v_owner.branch_id and code = v_code) then
    raise exception 'counter code already exists';
  end if;

  insert into public.counters(branch_id, code, display_token_hash)
  values (v_owner.branch_id, v_code, encode(digest(v_token, 'sha256'), 'hex'))
  returning * into v_counter;

  return jsonb_build_object('id', v_counter.id, 'code', v_counter.code, 'display_token', v_token);
end;
$$;

create or replace function public.rotate_counter_display_token(p_counter uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_owner public.staff%rowtype;
  v_counter public.counters%rowtype;
  v_token text := encode(gen_random_bytes(32), 'hex');
begin
  v_owner := private.require_staff(true);
  select * into v_counter
  from public.counters
  where id = p_counter and branch_id = v_owner.branch_id
  for update;
  if not found then
    raise exception 'counter not found';
  end if;

  update public.counters
  set display_token_hash = encode(digest(v_token, 'sha256'), 'hex')
  where id = v_counter.id;

  return jsonb_build_object('id', v_counter.id, 'code', v_counter.code, 'display_token', v_token);
end;
$$;

revoke all on function public.get_branch_counter_settings() from public, anon;
revoke all on function public.save_branch_settings(text, text) from public, anon;
revoke all on function public.create_branch_counter(text) from public, anon;
revoke all on function public.rotate_counter_display_token(uuid) from public, anon;

grant execute on function public.get_branch_counter_settings() to authenticated;
grant execute on function public.save_branch_settings(text, text) to authenticated;
grant execute on function public.create_branch_counter(text) to authenticated;
grant execute on function public.rotate_counter_display_token(uuid) to authenticated;
