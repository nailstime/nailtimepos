-- POS booking workspace. The booking website keeps its own customer auth/RLS;
-- these RPCs authorize through the already-established PIN staff session instead.
-- No service-role credential is ever exposed to the POS browser.

create or replace function private.guard_booking_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jwt_role text := coalesce((select auth.jwt()) ->> 'role', '');
  v_is_admin boolean := false;
  v_is_active_staff boolean := false;
begin
  if v_jwt_role = 'service_role' or session_user = 'postgres' then
    return new;
  end if;

  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  ) into v_is_admin;

  if v_is_admin then
    return new;
  end if;

  -- A staff session cannot update the table directly because bookings has no
  -- staff RLS policy. It can only reach this trigger through the guarded RPCs.
  select exists (
    select 1
    from public.staff_sessions ss
    join public.staff s on s.id = ss.staff_id and s.active
    where ss.auth_user_id = (select auth.uid())
      and ss.expires_at > now()
  ) into v_is_active_staff;

  if v_is_active_staff then
    return new;
  end if;

  if (select auth.uid()) is null or old.user_id is distinct from (select auth.uid()) then
    raise exception 'booking update is not authorized';
  end if;

  if new.status <> 'cancelled'
     or (to_jsonb(new) - 'status' - 'updated_at')
        is distinct from (to_jsonb(old) - 'status' - 'updated_at') then
    raise exception 'customers may only cancel their own booking';
  end if;

  return new;
end;
$$;

create or replace function public.pos_list_bookings(
  p_date date default timezone('Asia/Bangkok', now())::date,
  p_query text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff%rowtype;
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_result jsonb;
begin
  v_staff := private.require_staff(false);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.slot_date, x.start_time, x.created_at), '[]'::jsonb)
  into v_result
  from (
    select
      b.id,
      b.booking_no,
      b.slot_date,
      b.start_time,
      b.end_time,
      b.status,
      b.guest_name,
      b.guest_phone,
      b.note,
      b.created_at,
      jsonb_build_object('id', svc.id, 'name', svc.name, 'duration', svc.duration) as service,
      o.id as order_id,
      o.order_no,
      o.status as order_status
    from public.bookings b
    join public.services svc on svc.id = b.service_id
    left join public.orders o on o.booking_id = b.id
    where svc.branch_id = v_staff.branch_id
      and b.slot_date = coalesce(p_date, timezone('Asia/Bangkok', now())::date)
      and (
        v_query = ''
        or lower(coalesce(b.booking_no, '')) like '%' || v_query || '%'
        or lower(coalesce(b.guest_name, '')) like '%' || v_query || '%'
        or regexp_replace(coalesce(b.guest_phone, ''), '\D', '', 'g') like '%' || regexp_replace(v_query, '\D', '', 'g') || '%'
      )
  ) x;

  return v_result;
end;
$$;

create or replace function public.pos_booking_services()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff%rowtype;
begin
  v_staff := private.require_staff(false);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'duration', s.duration
    ) order by s.sort_order, s.name), '[]'::jsonb)
    from public.services s
    where s.branch_id = v_staff.branch_id and s.is_active
  );
end;
$$;

create or replace function public.pos_booking_slots(
  p_date date,
  p_service uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff%rowtype;
  v_service public.services%rowtype;
  v_slot_count integer;
  v_minimum_time time;
begin
  v_staff := private.require_staff(false);
  if p_date is null then raise exception 'booking date is required'; end if;

  select * into v_service
  from public.services
  where id = p_service and branch_id = v_staff.branch_id and is_active;
  if not found then raise exception 'booking service not found'; end if;

  v_slot_count := greatest(1, ceil(v_service.duration::numeric / 15)::integer);
  v_minimum_time := case
    when p_date = timezone('Asia/Bangkok', now())::date
      then date_trunc('minute', timezone('Asia/Bangkok', now()))::time
    else null
  end;

  return (
    with candidate_slots as (
      select ts.*
      from public.time_slots ts
      where ts.slot_date = p_date
        and ts.is_active
        and ts.start_time <= time '18:45'
        and (v_minimum_time is null or ts.start_time >= v_minimum_time)
    ), bookable as (
      select c.*,
        c.start_time + (v_slot_count * interval '15 minutes') as calculated_end_time
      from candidate_slots c
      where not exists (
        select 1
        from generate_series(0, v_slot_count - 1) step(slot_index)
        left join public.time_slots required_slot
          on required_slot.slot_date = c.slot_date
         and required_slot.is_active
         and required_slot.start_time = c.start_time + (step.slot_index * interval '15 minutes')
        where required_slot.id is null
           or (
             select count(*)
             from public.bookings existing_booking
             join public.services booked_service on booked_service.id = existing_booking.service_id
             join public.time_slots booked_slot on booked_slot.id = existing_booking.slot_id
             where existing_booking.status in ('pending', 'confirmed')
               and booked_slot.slot_date = c.slot_date
               and required_slot.start_time >= booked_slot.start_time
               and required_slot.start_time < booked_slot.start_time
                 + (greatest(1, ceil(booked_service.duration::numeric / 15)::integer) * interval '15 minutes')
           ) >= required_slot.capacity
      )
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id,
      'slot_date', slot_date,
      'start_time', start_time,
      'end_time', calculated_end_time,
      'capacity', capacity
    ) order by start_time), '[]'::jsonb)
    from bookable
  );
end;
$$;

create or replace function public.pos_create_booking(
  p_service uuid,
  p_slot uuid,
  p_guest_name text,
  p_guest_phone text default null,
  p_note text default null,
  p_status text default 'confirmed'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff%rowtype;
  v_service public.services%rowtype;
  v_slot public.time_slots%rowtype;
  v_booking public.bookings%rowtype;
  v_phone text := nullif(regexp_replace(coalesce(p_guest_phone, ''), '\D', '', 'g'), '');
  v_slot_count integer;
  v_has_unavailable_slot boolean;
begin
  v_staff := private.require_staff(false);
  if length(btrim(coalesce(p_guest_name, ''))) not between 1 and 160 then
    raise exception 'guest name is required';
  end if;
  if v_phone is not null and v_phone !~ '^\d{9,15}$' then
    raise exception 'invalid guest phone';
  end if;
  if length(coalesce(p_note, '')) > 500 then raise exception 'booking note is too long'; end if;
  if p_status not in ('pending', 'confirmed') then raise exception 'invalid booking status'; end if;

  select * into v_service
  from public.services
  where id = p_service and branch_id = v_staff.branch_id and is_active;
  if not found then raise exception 'booking service not found'; end if;

  select * into v_slot from public.time_slots where id = p_slot and is_active;
  if not found then raise exception 'booking slot not found'; end if;
  if v_slot.slot_date < timezone('Asia/Bangkok', now())::date
     or (v_slot.slot_date = timezone('Asia/Bangkok', now())::date and v_slot.start_time < timezone('Asia/Bangkok', now())::time) then
    raise exception 'booking time has passed';
  end if;

  -- Serialize booking writes for the date. This prevents two POS users from
  -- passing the availability test for the same last capacity at once.
  perform pg_advisory_xact_lock(hashtextextended(v_slot.slot_date::text, 0));
  v_slot_count := greatest(1, ceil(v_service.duration::numeric / 15)::integer);

  select exists (
    select 1
    from generate_series(0, v_slot_count - 1) step(slot_index)
    left join public.time_slots required_slot
      on required_slot.slot_date = v_slot.slot_date
     and required_slot.is_active
     and required_slot.start_time = v_slot.start_time + (step.slot_index * interval '15 minutes')
    where required_slot.id is null
       or (
         select count(*)
         from public.bookings existing_booking
         join public.services booked_service on booked_service.id = existing_booking.service_id
         join public.time_slots booked_slot on booked_slot.id = existing_booking.slot_id
         where existing_booking.status in ('pending', 'confirmed')
           and booked_slot.slot_date = v_slot.slot_date
           and required_slot.start_time >= booked_slot.start_time
           and required_slot.start_time < booked_slot.start_time
             + (greatest(1, ceil(booked_service.duration::numeric / 15)::integer) * interval '15 minutes')
       ) >= required_slot.capacity
  ) into v_has_unavailable_slot;
  if v_has_unavailable_slot then raise exception 'selected time is no longer available'; end if;

  insert into public.bookings(
    service_id, slot_id, slot_date, start_time, end_time,
    guest_name, guest_phone, note, status
  ) values (
    v_service.id, v_slot.id, v_slot.slot_date, v_slot.start_time,
    v_slot.start_time + (v_slot_count * interval '15 minutes'),
    btrim(p_guest_name), v_phone, nullif(btrim(coalesce(p_note, '')), ''), p_status
  ) returning * into v_booking;

  return jsonb_build_object(
    'id', v_booking.id,
    'booking_no', v_booking.booking_no,
    'slot_date', v_booking.slot_date,
    'start_time', v_booking.start_time,
    'end_time', v_booking.end_time,
    'status', v_booking.status,
    'service', jsonb_build_object('id', v_service.id, 'name', v_service.name, 'duration', v_service.duration)
  );
end;
$$;

create or replace function public.pos_set_booking_status(
  p_booking uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff%rowtype;
  v_booking public.bookings%rowtype;
begin
  v_staff := private.require_staff(false);
  if p_status not in ('pending', 'confirmed', 'completed', 'cancelled') then
    raise exception 'invalid booking status';
  end if;

  select b.* into v_booking
  from public.bookings b
  join public.services svc on svc.id = b.service_id
  where b.id = p_booking and svc.branch_id = v_staff.branch_id
  for update;
  if not found then raise exception 'booking not found'; end if;
  if v_booking.status in ('completed', 'cancelled') then
    raise exception 'booking is already closed';
  end if;

  update public.bookings
  set status = p_status, updated_at = now()
  where id = v_booking.id
  returning * into v_booking;

  return jsonb_build_object('id', v_booking.id, 'status', v_booking.status);
end;
$$;

create or replace function public.create_order_from_booking(
  p_counter_code text,
  p_member uuid,
  p_items jsonb,
  p_booking uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff%rowtype;
  v_booking public.bookings%rowtype;
  v_result jsonb;
  v_order_id uuid;
begin
  v_staff := private.require_staff(false);
  select b.* into v_booking
  from public.bookings b
  join public.services svc on svc.id = b.service_id
  where b.id = p_booking
    and svc.branch_id = v_staff.branch_id
  for update;
  if not found then raise exception 'booking not found'; end if;
  if v_booking.status not in ('pending', 'confirmed') then
    raise exception 'booking cannot be opened as a bill';
  end if;
  if exists (select 1 from public.orders where booking_id = v_booking.id) then
    raise exception 'booking already has a linked bill';
  end if;

  v_result := public.create_order(p_counter_code, p_member, p_items);
  v_order_id := (v_result -> 'order' ->> 'id')::uuid;
  update public.orders set booking_id = v_booking.id where id = v_order_id;
  update public.bookings set status = 'confirmed', updated_at = now() where id = v_booking.id;
  return v_result;
end;
$$;

create or replace function private.complete_booking_when_order_is_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' and new.booking_id is not null then
    update public.bookings
    set status = 'completed', updated_at = now()
    where id = new.booking_id and status in ('pending', 'confirmed');
  end if;
  return new;
end;
$$;

revoke execute on function private.complete_booking_when_order_is_paid() from public, anon, authenticated;
drop trigger if exists complete_booking_when_order_is_paid on public.orders;
create trigger complete_booking_when_order_is_paid
after update of status on public.orders
for each row execute function private.complete_booking_when_order_is_paid();

create index if not exists bookings_service_date_status_idx
  on public.bookings(service_id, slot_date, status);

grant execute on function public.pos_list_bookings(date, text) to authenticated;
grant execute on function public.pos_booking_services() to authenticated;
grant execute on function public.pos_booking_slots(date, uuid) to authenticated;
grant execute on function public.pos_create_booking(uuid, uuid, text, text, text, text) to authenticated;
grant execute on function public.pos_set_booking_status(uuid, text) to authenticated;
grant execute on function public.create_order_from_booking(text, uuid, jsonb, uuid) to authenticated;
