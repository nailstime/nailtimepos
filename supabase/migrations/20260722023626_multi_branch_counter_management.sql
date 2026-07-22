-- Make the owner settings screen a true multi-branch workspace.  POS staff
-- remain bound to their own branch; the owner can configure any branch here.

drop function public.get_branch_counter_settings();
drop function public.save_branch_settings(text, text);
drop function public.create_branch_counter(text);

create function public.get_branch_counter_settings(p_branch uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_owner public.staff%rowtype;
  v_branch public.branches%rowtype;
  v_branch_id uuid;
begin
  v_owner := private.require_staff(true);
  v_branch_id := coalesce(p_branch, v_owner.branch_id);

  select * into v_branch
  from public.branches
  where id = v_branch_id;
  if not found then
    raise exception 'branch not found';
  end if;

  return jsonb_build_object(
    'branches', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', b.id,
        'code', b.code,
        'name', b.name,
        'promptpay_id', b.promptpay_id,
        'active', b.active,
        'counter_count', (
          select count(*) from public.counters c where c.branch_id = b.id
        )
      ) order by b.active desc, b.code), '[]'::jsonb)
      from public.branches b
    ),
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
      where c.branch_id = v_branch.id
    )
  );
end;
$$;

create function public.create_branch(
  p_code text,
  p_name text,
  p_promptpay_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_promptpay_id text := regexp_replace(coalesce(p_promptpay_id, ''), '\D', '', 'g');
  v_branch public.branches%rowtype;
begin
  perform private.require_staff(true);
  if v_code !~ '^[A-Z0-9_-]{1,20}$' then
    raise exception 'branch code must use A-Z, 0-9, _ or - and be 1 to 20 characters';
  end if;
  if length(v_name) not between 1 and 120 then
    raise exception 'branch name must be 1 to 120 characters';
  end if;
  if v_promptpay_id !~ '^(\d{10}|\d{13})$' then
    raise exception 'PromptPay ID must contain 10 or 13 digits';
  end if;

  insert into public.branches(code, name, promptpay_id)
  values (v_code, v_name, v_promptpay_id)
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

create function public.save_branch_settings(
  p_branch uuid,
  p_name text,
  p_promptpay_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_promptpay_id text := regexp_replace(coalesce(p_promptpay_id, ''), '\D', '', 'g');
  v_branch public.branches%rowtype;
begin
  perform private.require_staff(true);
  if length(v_name) not between 1 and 120 then
    raise exception 'branch name must be 1 to 120 characters';
  end if;
  if v_promptpay_id !~ '^(\d{10}|\d{13})$' then
    raise exception 'PromptPay ID must contain 10 or 13 digits';
  end if;

  update public.branches
  set name = v_name, promptpay_id = v_promptpay_id
  where id = p_branch
  returning * into v_branch;
  if not found then
    raise exception 'branch not found';
  end if;

  return jsonb_build_object(
    'id', v_branch.id,
    'code', v_branch.code,
    'name', v_branch.name,
    'promptpay_id', v_branch.promptpay_id,
    'active', v_branch.active
  );
end;
$$;

create function public.create_branch_counter(p_branch uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_counter public.counters%rowtype;
  v_token text := encode(gen_random_bytes(32), 'hex');
begin
  perform private.require_staff(true);
  if not exists (select 1 from public.branches where id = p_branch) then
    raise exception 'branch not found';
  end if;
  if v_code !~ '^[A-Z0-9_-]{1,20}$' then
    raise exception 'counter code must use A-Z, 0-9, _ or - and be 1 to 20 characters';
  end if;
  if exists (select 1 from public.counters where branch_id = p_branch and code = v_code) then
    raise exception 'counter code already exists in this branch';
  end if;

  insert into public.counters(branch_id, code, display_token_hash)
  values (p_branch, v_code, encode(digest(v_token, 'sha256'), 'hex'))
  returning * into v_counter;

  return jsonb_build_object('id', v_counter.id, 'code', v_counter.code, 'display_token', v_token);
end;
$$;

-- Keep the display reset functions scoped to the selected counter.  The
-- caller still has to pass private.require_staff(true), so technicians cannot
-- reset a display in another branch.
create or replace function public.create_customer_display_pairing_code(p_counter uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_owner public.staff%rowtype;
  v_counter public.counters%rowtype;
  v_code text := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 8));
begin
  v_owner := private.require_staff(true);
  select * into v_counter from public.counters where id = p_counter for update;
  if not found then
    raise exception 'counter not found';
  end if;

  delete from public.customer_display_pairing_codes
  where counter_id = v_counter.id and used_at is null;

  insert into public.customer_display_pairing_codes(
    counter_id, code_hash, expires_at, created_by_staff_id
  ) values (
    v_counter.id,
    encode(digest(v_code, 'sha256'), 'hex'),
    now() + interval '10 minutes',
    v_owner.id
  );

  return jsonb_build_object(
    'code', v_counter.code,
    'pairing_code', v_code,
    'expires_at', now() + interval '10 minutes'
  );
end;
$$;

create or replace function public.rotate_counter_display_token(p_counter uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_counter public.counters%rowtype;
  v_token text := encode(gen_random_bytes(32), 'hex');
begin
  perform private.require_staff(true);
  select * into v_counter from public.counters where id = p_counter for update;
  if not found then
    raise exception 'counter not found';
  end if;

  update public.counters
  set display_token_hash = encode(digest(v_token, 'sha256'), 'hex')
  where id = v_counter.id;

  update public.customer_display_devices
  set revoked_at = now()
  where counter_id = v_counter.id and revoked_at is null;

  return jsonb_build_object('id', v_counter.id, 'code', v_counter.code, 'display_token', v_token);
end;
$$;

revoke all on function public.get_branch_counter_settings(uuid) from public, anon;
revoke all on function public.create_branch(text, text, text) from public, anon;
revoke all on function public.save_branch_settings(uuid, text, text) from public, anon;
revoke all on function public.create_branch_counter(uuid, text) from public, anon;
revoke all on function public.create_customer_display_pairing_code(uuid) from public, anon;
revoke all on function public.rotate_counter_display_token(uuid) from public, anon;

grant execute on function public.get_branch_counter_settings(uuid) to authenticated;
grant execute on function public.create_branch(text, text, text) to authenticated;
grant execute on function public.save_branch_settings(uuid, text, text) to authenticated;
grant execute on function public.create_branch_counter(uuid, text) to authenticated;
grant execute on function public.create_customer_display_pairing_code(uuid) to authenticated;
grant execute on function public.rotate_counter_display_token(uuid) to authenticated;
