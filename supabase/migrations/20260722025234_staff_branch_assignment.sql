-- Owner management across branches.  A staff PIN remains assigned to one
-- branch at a time, and moving a staff member invalidates active sessions so
-- the next PIN login always receives the new branch context.

drop function public.create_staff(text, text, text);

create function public.admin_staff_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, extensions
as $$
begin
  perform private.require_staff(true);

  return jsonb_build_object(
    'branches', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', b.id,
        'code', b.code,
        'name', b.name,
        'active', b.active
      ) order by b.code), '[]'::jsonb)
      from public.branches b
      where b.active
    ),
    'staff', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id,
        'branch_id', s.branch_id,
        'branch_code', b.code,
        'branch_name', b.name,
        'name', s.name,
        'role', s.role,
        'active', s.active,
        'created_at', s.created_at
      ) order by s.active desc, b.code, s.created_at), '[]'::jsonb)
      from public.staff s
      join public.branches b on b.id = s.branch_id
    )
  );
end;
$$;

create function public.create_staff(
  p_name text,
  p_role text,
  p_pin text,
  p_branch uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_id uuid;
begin
  perform private.require_staff(true);
  if length(btrim(coalesce(p_name, ''))) not between 1 and 120 then
    raise exception 'name is required';
  end if;
  if p_role not in ('owner', 'technician') then
    raise exception 'invalid role';
  end if;
  if p_pin !~ '^\d{6}$' then
    raise exception 'PIN must contain exactly 6 digits';
  end if;
  if not exists (select 1 from public.branches where id = p_branch and active) then
    raise exception 'branch not found or inactive';
  end if;
  if exists (
    select 1 from public.staff s
    where s.active and s.pin_hash = crypt(p_pin, s.pin_hash)
  ) then
    raise exception 'PIN is already in use';
  end if;

  insert into public.staff(branch_id, name, role, pin_hash)
  values (p_branch, btrim(p_name), p_role, crypt(p_pin, gen_salt('bf')))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.move_staff_branch(p_staff uuid, p_branch uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_owner public.staff%rowtype;
  v_staff public.staff%rowtype;
  v_branch public.branches%rowtype;
begin
  v_owner := private.require_staff(true);
  if p_staff = v_owner.id then
    raise exception 'you cannot move your own account';
  end if;

  select * into v_staff from public.staff where id = p_staff for update;
  if not found then
    raise exception 'staff not found';
  end if;
  select * into v_branch from public.branches where id = p_branch and active;
  if not found then
    raise exception 'branch not found or inactive';
  end if;

  update public.staff set branch_id = v_branch.id where id = v_staff.id;
  delete from public.staff_sessions where staff_id = v_staff.id;

  return jsonb_build_object(
    'id', v_staff.id,
    'branch_id', v_branch.id,
    'branch_code', v_branch.code,
    'branch_name', v_branch.name
  );
end;
$$;

create or replace function public.reset_staff_pin(p_staff uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
begin
  perform private.require_staff(true);
  if p_pin !~ '^\d{6}$' then
    raise exception 'PIN must contain exactly 6 digits';
  end if;
  if exists (
    select 1 from public.staff s
    where s.id <> p_staff and s.active and s.pin_hash = crypt(p_pin, s.pin_hash)
  ) then
    raise exception 'PIN is already in use';
  end if;

  update public.staff set pin_hash = crypt(p_pin, gen_salt('bf'))
  where id = p_staff;
  if not found then
    raise exception 'staff not found';
  end if;
  delete from public.staff_sessions where staff_id = p_staff;
end;
$$;

create or replace function public.toggle_staff_active(p_staff uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_owner public.staff%rowtype;
  v_target public.staff%rowtype;
  v_active boolean;
begin
  v_owner := private.require_staff(true);
  if p_staff = v_owner.id then
    raise exception 'you cannot disable your own account';
  end if;

  select * into v_target from public.staff where id = p_staff for update;
  if not found then
    raise exception 'staff not found';
  end if;
  if v_target.role = 'owner' and v_target.active and (
    select count(*) from public.staff where role = 'owner' and active
  ) <= 1 then
    raise exception 'at least one active owner is required';
  end if;

  update public.staff set active = not active where id = p_staff returning active into v_active;
  if not v_active then
    delete from public.staff_sessions where staff_id = p_staff;
  end if;
  return v_active;
end;
$$;

revoke all on function public.admin_staff_settings() from public, anon;
revoke all on function public.create_staff(text, text, text, uuid) from public, anon;
revoke all on function public.move_staff_branch(uuid, uuid) from public, anon;
revoke all on function public.reset_staff_pin(uuid, text) from public, anon;
revoke all on function public.toggle_staff_active(uuid) from public, anon;

grant execute on function public.admin_staff_settings() to authenticated;
grant execute on function public.create_staff(text, text, text, uuid) to authenticated;
grant execute on function public.move_staff_branch(uuid, uuid) to authenticated;
grant execute on function public.reset_staff_pin(uuid, text) to authenticated;
grant execute on function public.toggle_staff_active(uuid) to authenticated;

notify pgrst, 'reload schema';
