-- Keep a complete rolling calendar. An inactive slot is deliberately left alone;
-- only genuinely missing time slots are restored.
create or replace function private.ensure_future_booking_slots()
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_today date := timezone('Asia/Bangkok', now())::date;
begin
  insert into public.time_slots (slot_date, start_time, end_time, capacity)
  select
    d::date,
    slot_start::time,
    (slot_start + interval '15 minutes')::time,
    1
  from generate_series(v_today, v_today + 90, interval '1 day') d
  cross join lateral generate_series(
    d::timestamp + '10:00'::time,
    d::timestamp + '18:00'::time - interval '15 minutes',
    interval '15 minutes'
  ) slot_start
  on conflict (slot_date, start_time) do nothing;
end;
$$;

-- Fill the current gap now, then re-check every night at 03:15 Thailand time
-- (20:15 UTC). The job is lightweight: inserts only missing rows.
select private.ensure_future_booking_slots();
select cron.schedule(
  'ensure-future-booking-slots',
  '15 20 * * *',
  'select private.ensure_future_booking_slots();'
);
