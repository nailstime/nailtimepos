-- Staff-side booking amendments.  The availability check and the update run in
-- one transaction so a queue cannot be overbooked when two terminals edit it.
create or replace function public.pos_update_booking(
  p_booking     uuid,
  p_services    uuid[],
  p_slot        uuid,
  p_guest_name  text,
  p_guest_phone text default null,
  p_note        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff           public.staff%rowtype;
  v_booking         public.bookings%rowtype;
  v_slot            public.time_slots%rowtype;
  v_phone           text := nullif(regexp_replace(coalesce(p_guest_phone, ''), '\D', '', 'g'), '');
  v_service_count   integer;
  v_total_minutes   integer;
  v_slot_count      integer;
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
  if length(coalesce(p_note, '')) > 500 then
    raise exception 'booking note is too long';
  end if;

  select b.* into v_booking
  from public.bookings b
  join public.services svc on svc.id = b.service_id
  where b.id = p_booking
    and svc.branch_id = v_staff.branch_id
  for update;
  if not found then raise exception 'booking not found'; end if;
  if v_booking.status not in ('pending', 'confirmed') then
    raise exception 'only active bookings can be edited';
  end if;
  if exists (select 1 from public.orders o where o.booking_id = v_booking.id) then
    raise exception 'booking already has a POS bill and cannot be edited';
  end if;

  select count(*)::integer, sum(s.duration)::integer
  into v_service_count, v_total_minutes
  from unnest(p_services) as u(service_id)
  join public.services s on s.id = u.service_id
    and s.branch_id = v_staff.branch_id
    and s.is_active;
  if v_service_count <> array_length(p_services, 1) then
    raise exception 'one or more services not found or inactive';
  end if;

  select * into v_slot
  from public.time_slots
  where id = p_slot and is_active;
  if not found then raise exception 'booking slot not found'; end if;
  if v_slot.slot_date < timezone('Asia/Bangkok', now())::date
    or (v_slot.slot_date = timezone('Asia/Bangkok', now())::date
      and v_slot.start_time < timezone('Asia/Bangkok', now())::time) then
    raise exception 'booking time has passed';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_slot.slot_date::text, 0));
  v_slot_count := greatest(1, ceil(v_total_minutes::numeric / 15)::integer);

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
        from public.bookings eb
        where eb.id <> v_booking.id
          and eb.status in ('pending', 'confirmed')
          and eb.slot_date = v_slot.slot_date
          and required_slot.start_time >= eb.start_time
          and required_slot.start_time < eb.end_time
      ) >= required_slot.capacity
  ) into v_has_unavailable;
  if v_has_unavailable then raise exception 'selected time is no longer available'; end if;

  update public.bookings
  set service_id = p_services[1],
      service_ids = case when array_length(p_services, 1) > 1 then p_services else null end,
      slot_id = v_slot.id,
      slot_date = v_slot.slot_date,
      start_time = v_slot.start_time,
      end_time = v_slot.start_time + (v_slot_count * interval '15 minutes'),
      guest_name = btrim(p_guest_name),
      guest_phone = v_phone,
      note = nullif(btrim(coalesce(p_note, '')), ''),
      updated_at = now()
  where id = v_booking.id
  returning * into v_booking;

  return jsonb_build_object(
    'id', v_booking.id,
    'booking_no', v_booking.booking_no,
    'slot_date', v_booking.slot_date,
    'start_time', v_booking.start_time,
    'end_time', v_booking.end_time,
    'status', v_booking.status
  );
end;
$$;

-- The editor needs the exact service ids, rather than only the display label.
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
  into v_result
  from (
    select
      b.id, b.booking_no, b.slot_id, b.slot_date, b.start_time, b.end_time, b.status,
      b.guest_name, b.guest_phone, b.note, b.member_id, b.created_at,
      coalesce(b.service_ids, array[b.service_id]) as service_ids,
      case
        when b.service_ids is not null then (
          select jsonb_build_object(
            'id', b.service_ids[1],
            'name', string_agg(s.name, ' + ' order by array_position(b.service_ids, s.id)),
            'duration', sum(s.duration)::integer
          ) from public.services s where s.id = any(b.service_ids)
        )
        else jsonb_build_object('id', svc.id, 'name', svc.name, 'duration', svc.duration)
      end as service,
      o.id as order_id, o.order_no, o.status as order_status
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

revoke execute on function public.pos_update_booking(uuid, uuid[], uuid, text, text, text) from public, anon;
grant execute on function public.pos_update_booking(uuid, uuid[], uuid, text, text, text) to authenticated;
