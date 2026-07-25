-- Compact month summary for the POS calendar. PII stays in pos_list_bookings.
create or replace function public.pos_booking_calendar(p_month date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff%rowtype;
  v_start date;
  v_end date;
begin
  v_staff := private.require_staff(false);
  if p_month is null then raise exception 'calendar month is required'; end if;
  v_start := date_trunc('month', p_month)::date;
  v_end := (v_start + interval '1 month')::date;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'date', x.slot_date,
      'total', x.total,
      'pending', x.pending,
      'confirmed', x.confirmed
    ) order by x.slot_date), '[]'::jsonb)
    from (
      select
        b.slot_date,
        count(*)::integer as total,
        count(*) filter (where b.status = 'pending')::integer as pending,
        count(*) filter (where b.status = 'confirmed')::integer as confirmed
      from public.bookings b
      join public.services s on s.id = b.service_id
      where s.branch_id = v_staff.branch_id
        and b.slot_date >= v_start
        and b.slot_date < v_end
        and b.status in ('pending', 'confirmed')
      group by b.slot_date
    ) x
  );
end;
$$;

revoke execute on function public.pos_booking_calendar(date) from public, anon;
grant execute on function public.pos_booking_calendar(date) to authenticated;
