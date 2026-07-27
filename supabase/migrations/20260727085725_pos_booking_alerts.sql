-- Small POS header summary. Pending bookings need a confirmation, while
-- upcoming bookings are confirmed appointments starting within the next hour.
create or replace function public.pos_booking_alerts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_staff public.staff%rowtype;
  v_today date := timezone('Asia/Bangkok', now())::date;
  v_now time := timezone('Asia/Bangkok', now())::time;
  v_pending_count integer := 0;
  v_upcoming_count integer := 0;
  v_next_start time;
begin
  v_staff := private.require_staff(false);

  select count(*)::integer
  into v_pending_count
  from public.bookings b
  join public.services s on s.id = b.service_id
  where s.branch_id = v_staff.branch_id
    and b.status = 'pending'
    and b.slot_date >= v_today;

  select count(*)::integer, min(b.start_time)
  into v_upcoming_count, v_next_start
  from public.bookings b
  join public.services s on s.id = b.service_id
  where s.branch_id = v_staff.branch_id
    and b.status = 'confirmed'
    and b.slot_date = v_today
    and b.start_time >= v_now
    and b.start_time <= (v_now + interval '60 minutes')::time
    and not exists (
      select 1 from public.orders o where o.booking_id = b.id
    );

  return jsonb_build_object(
    'pending_count', v_pending_count,
    'upcoming_count', v_upcoming_count,
    'next_start_time', v_next_start
  );
end;
$$;

revoke all on function public.pos_booking_alerts() from public, anon;
grant execute on function public.pos_booking_alerts() to authenticated;
