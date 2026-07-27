-- Staff-facing queue dashboard.  It keeps booking PII behind the existing
-- PIN-staff authorization boundary and returns only the current branch.
create or replace function public.pos_staff_booking_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_staff public.staff%rowtype;
  v_now timestamp without time zone := timezone('Asia/Bangkok', now());
  v_today date := v_now::date;
  v_pending jsonb;
  v_upcoming jsonb;
begin
  v_staff := private.require_staff(false);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.slot_date, x.start_time), '[]'::jsonb)
  into v_pending
  from (
    select
      b.id,
      b.booking_no,
      b.slot_date,
      b.start_time,
      b.end_time,
      b.guest_name,
      b.guest_phone,
      b.note,
      coalesce(
        (
          select string_agg(s.name, ' + ' order by array_position(b.service_ids, s.id))
          from public.services s
          where b.service_ids is not null and s.id = any(b.service_ids)
        ),
        svc.name
      ) as service_name
    from public.bookings b
    join public.services svc on svc.id = b.service_id
    where svc.branch_id = v_staff.branch_id
      and b.status = 'pending'
      and b.slot_date >= v_today
    order by b.slot_date, b.start_time
    limit 20
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.start_time), '[]'::jsonb)
  into v_upcoming
  from (
    select
      b.id,
      b.booking_no,
      b.slot_date,
      b.start_time,
      b.end_time,
      b.guest_name,
      b.guest_phone,
      b.note,
      coalesce(
        (
          select string_agg(s.name, ' + ' order by array_position(b.service_ids, s.id))
          from public.services s
          where b.service_ids is not null and s.id = any(b.service_ids)
        ),
        svc.name
      ) as service_name
    from public.bookings b
    join public.services svc on svc.id = b.service_id
    where svc.branch_id = v_staff.branch_id
      and b.status = 'confirmed'
      and b.slot_date = v_today
      and (b.slot_date + b.start_time) >= v_now
      and (b.slot_date + b.start_time) <= v_now + interval '1 hour'
      and not exists (select 1 from public.orders o where o.booking_id = b.id)
    order by b.start_time
    limit 20
  ) x;

  return jsonb_build_object(
    'generated_at', v_now,
    'pending', v_pending,
    'upcoming', v_upcoming
  );
end;
$$;

revoke all on function public.pos_staff_booking_dashboard() from public, anon;
grant execute on function public.pos_staff_booking_dashboard() to authenticated;
