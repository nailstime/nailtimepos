-- Multi-service + member-linked bookings
-- • service_ids uuid[] — all selected services for combined bookings
-- • member_id uuid    — links booking to POS member for auto-fill at bill time
-- • pos_booking_slots_for_duration — slot search by total duration in minutes
-- • pos_create_multi_booking — booking with service array + optional member link
-- • pos_get_member — member lookup by ID for staff sessions
-- • pos_list_bookings (updated) — returns member_id + combined service display name

alter table public.bookings
  add column if not exists service_ids uuid[] default null,
  add column if not exists member_id  uuid references public.members(id) on delete set null;

-- ─── pos_booking_slots_for_duration ────────────────────────────────────────
-- Identical logic to pos_booking_slots but takes total minutes instead of
-- service_id, so it works for multi-service combined durations.
-- Conflict check uses end_time directly (accurate for multi-service bookings).
create or replace function public.pos_booking_slots_for_duration(
  p_date    date,
  p_minutes integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff      public.staff%rowtype;
  v_slot_count integer;
  v_minimum_time time;
begin
  v_staff := private.require_staff(false);
  if p_date is null then raise exception 'booking date is required'; end if;
  if coalesce(p_minutes, 0) < 15 then raise exception 'duration must be at least 15 minutes'; end if;

  v_slot_count   := greatest(1, ceil(p_minutes::numeric / 15)::integer);
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
          on  required_slot.slot_date  = c.slot_date
          and required_slot.is_active
          and required_slot.start_time = c.start_time + (step.slot_index * interval '15 minutes')
        where required_slot.id is null
           or (
             select count(*)
             from public.bookings eb
             where eb.status in ('pending', 'confirmed')
               and eb.slot_date = c.slot_date
               and required_slot.start_time >= eb.start_time
               and required_slot.start_time <  eb.end_time
           ) >= required_slot.capacity
      )
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',        id,
      'slot_date', slot_date,
      'start_time',start_time,
      'end_time',  calculated_end_time,
      'capacity',  capacity
    ) order by start_time), '[]'::jsonb)
    from bookable
  );
end;
$$;

-- ─── pos_create_multi_booking ───────────────────────────────────────────────
create or replace function public.pos_create_multi_booking(
  p_services  uuid[],
  p_slot      uuid,
  p_guest_name  text,
  p_guest_phone text default null,
  p_note        text default null,
  p_status      text default 'confirmed',
  p_member      uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff        public.staff%rowtype;
  v_slot         public.time_slots%rowtype;
  v_booking      public.bookings%rowtype;
  v_phone        text    := nullif(regexp_replace(coalesce(p_guest_phone, ''), '\D', '', 'g'), '');
  v_total_minutes integer;
  v_svc_count    integer;
  v_slot_count   integer;
  v_has_unavailable boolean;
begin
  v_staff := private.require_staff(false);

  if array_length(p_services, 1) is null or array_length(p_services, 1) = 0 then
    raise exception 'at least one service is required';
  end if;
  if length(btrim(coalesce(p_guest_name, ''))) not between 1 and 160 then
    raise exception 'guest name is required';
  end if;
  if v_phone is not null and v_phone !~ '^\d{9,15}$' then
    raise exception 'invalid guest phone';
  end if;
  if length(coalesce(p_note, '')) > 500 then raise exception 'booking note is too long'; end if;
  if p_status not in ('pending', 'confirmed') then raise exception 'invalid booking status'; end if;

  -- Validate member belongs to this branch
  if p_member is not null then
    if not exists (
      select 1 from public.members where id = p_member and branch_id = v_staff.branch_id
    ) then raise exception 'member not found'; end if;
  end if;

  -- Validate all services and sum durations (unnest keeps duplicates for correct totals)
  select count(*)::integer, sum(s.duration)::integer
  into   v_svc_count, v_total_minutes
  from   unnest(p_services) as u(sid)
  join   public.services s on s.id = u.sid
     and s.branch_id = v_staff.branch_id
     and s.is_active;

  if v_svc_count <> array_length(p_services, 1) then
    raise exception 'one or more services not found or inactive';
  end if;

  select * into v_slot from public.time_slots where id = p_slot and is_active;
  if not found then raise exception 'booking slot not found'; end if;
  if v_slot.slot_date < timezone('Asia/Bangkok', now())::date
     or (v_slot.slot_date = timezone('Asia/Bangkok', now())::date
         and v_slot.start_time < timezone('Asia/Bangkok', now())::time)
  then raise exception 'booking time has passed'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_slot.slot_date::text, 0));
  v_slot_count := greatest(1, ceil(v_total_minutes::numeric / 15)::integer);

  select exists (
    select 1
    from generate_series(0, v_slot_count - 1) step(slot_index)
    left join public.time_slots required_slot
      on  required_slot.slot_date  = v_slot.slot_date
      and required_slot.is_active
      and required_slot.start_time = v_slot.start_time + (step.slot_index * interval '15 minutes')
    where required_slot.id is null
       or (
         select count(*)
         from public.bookings eb
         where eb.status in ('pending', 'confirmed')
           and eb.slot_date = v_slot.slot_date
           and required_slot.start_time >= eb.start_time
           and required_slot.start_time <  eb.end_time
       ) >= required_slot.capacity
  ) into v_has_unavailable;
  if v_has_unavailable then raise exception 'selected time is no longer available'; end if;

  insert into public.bookings(
    service_id, service_ids, member_id,
    slot_id, slot_date, start_time, end_time,
    guest_name, guest_phone, note, status
  ) values (
    p_services[1],
    case when array_length(p_services, 1) > 1 then p_services else null end,
    p_member,
    v_slot.id, v_slot.slot_date, v_slot.start_time,
    v_slot.start_time + (v_slot_count * interval '15 minutes'),
    btrim(p_guest_name), v_phone, nullif(btrim(coalesce(p_note, '')), ''), p_status
  ) returning * into v_booking;

  return jsonb_build_object(
    'id',         v_booking.id,
    'booking_no', v_booking.booking_no,
    'slot_date',  v_booking.slot_date,
    'start_time', v_booking.start_time,
    'end_time',   v_booking.end_time,
    'status',     v_booking.status
  );
end;
$$;

-- ─── pos_get_member ─────────────────────────────────────────────────────────
-- Used by PosScreen to pre-load a member when navigating from a booking
create or replace function public.pos_get_member(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_staff  public.staff%rowtype;
  v_member public.members%rowtype;
begin
  v_staff := private.require_staff(false);
  select * into v_member
  from   public.members
  where  id = p_id and branch_id = v_staff.branch_id;
  if not found then return null; end if;
  return jsonb_build_object(
    'id',               v_member.id,
    'name',             v_member.name,
    'phone',            v_member.phone,
    'line_linked',      v_member.line_user_id is not null,
    'points_balance',   v_member.points_balance,
    'accumulated_baht', v_member.accumulated_baht
  );
end;
$$;

-- ─── pos_list_bookings (updated) ────────────────────────────────────────────
-- Now returns member_id and combined service name for multi-service bookings
create or replace function public.pos_list_bookings(
  p_date  date default timezone('Asia/Bangkok', now())::date,
  p_query text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff  public.staff%rowtype;
  v_query  text := lower(btrim(coalesce(p_query, '')));
  v_result jsonb;
begin
  v_staff := private.require_staff(false);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.slot_date, x.start_time, x.created_at), '[]'::jsonb)
  into   v_result
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
      b.member_id,
      b.created_at,
      case
        when b.service_ids is not null then (
          select jsonb_build_object(
            'id',       b.service_ids[1],
            'name',     string_agg(s.name, ' + ' order by array_position(b.service_ids, s.id)),
            'duration', sum(s.duration)::integer
          )
          from public.services s where s.id = any(b.service_ids)
        )
        else jsonb_build_object('id', svc.id, 'name', svc.name, 'duration', svc.duration)
      end as service,
      o.id     as order_id,
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
        or regexp_replace(coalesce(b.guest_phone, ''), '\D', '', 'g')
           like '%' || regexp_replace(v_query, '\D', '', 'g') || '%'
      )
  ) x;

  return v_result;
end;
$$;

-- ─── Permissions ────────────────────────────────────────────────────────────
revoke execute on function public.pos_booking_slots_for_duration(date, integer) from public, anon;
revoke execute on function public.pos_create_multi_booking(uuid[], uuid, text, text, text, text, uuid) from public, anon;
revoke execute on function public.pos_get_member(uuid) from public, anon;

grant execute on function public.pos_booking_slots_for_duration(date, integer) to authenticated;
grant execute on function public.pos_create_multi_booking(uuid[], uuid, text, text, text, text, uuid) to authenticated;
grant execute on function public.pos_get_member(uuid) to authenticated;
