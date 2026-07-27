-- A customer may start at 18:00 and use the shop until 19:30, but no new
-- booking may begin after 18:00. Enforce this for every booking writer.
create or replace function private.enforce_booking_start_cutoff()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.start_time > time '18:00' then
    raise exception 'booking start time must be no later than 18:00';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_start_time_cutoff on public.bookings;
create trigger bookings_start_time_cutoff
  before insert or update of start_time on public.bookings
  for each row execute function private.enforce_booking_start_cutoff();

-- Slot capacity stays available through 19:30 so an 18:00 appointment can run
-- for up to 90 minutes. Existing rows are retained; only the missing evening
-- slots are inserted.
create or replace function private.ensure_future_booking_slots()
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_today date := timezone('Asia/Bangkok', now())::date;
begin
  insert into public.time_slots (slot_date, start_time, end_time, capacity)
  select d::date, slot_start::time, (slot_start + interval '15 minutes')::time, 1
  from generate_series(v_today, v_today + 90, interval '1 day') d
  cross join lateral generate_series(
    d::timestamp + '10:00'::time,
    d::timestamp + '19:30'::time - interval '15 minutes',
    interval '15 minutes'
  ) slot_start
  on conflict (slot_date, start_time) do nothing;
end;
$$;

select private.ensure_future_booking_slots();

-- Keep the original monthly generator aligned with the 19:30 closing window.
create or replace function public.monthly_slot_maintenance()
returns void
language plpgsql
set search_path = ''
as $$
declare
  prev_month_start date := date_trunc('month', current_date - interval '1 month')::date;
  prev_month_end   date := date_trunc('month', current_date)::date - 1;
  next_month_start date := date_trunc('month', current_date + interval '1 month')::date;
  next_month_end   date := next_month_start + 29;
begin
  delete from public.time_slots
  where slot_date between prev_month_start and prev_month_end;

  insert into public.time_slots (slot_date, start_time, end_time, capacity)
  select d::date, slot_start::time, (slot_start + interval '15 minutes')::time, 1
  from generate_series(next_month_start, next_month_end, interval '1 day') d
  cross join lateral generate_series(
    d::timestamp + '10:00'::time,
    d::timestamp + '19:30'::time - interval '15 minutes',
    interval '15 minutes'
  ) slot_start
  on conflict (slot_date, start_time) do nothing;
end;
$$;

-- POS availability: present starts only up to 18:00, while checking the
-- following 15-minute slots through 19:30 for the selected service duration.
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

  v_slot_count := greatest(1, ceil(p_minutes::numeric / 15)::integer);
  v_minimum_time := case
    when p_date = timezone('Asia/Bangkok', now())::date
      then date_trunc('minute', timezone('Asia/Bangkok', now()))::time
    else null
  end;

  return (
    with candidate_slots as (
      select ts.* from public.time_slots ts
      where ts.slot_date = p_date
        and ts.is_active
        and ts.start_time <= time '18:00'
        and (v_minimum_time is null or ts.start_time >= v_minimum_time)
    ), bookable as (
      select c.*, c.start_time + (v_slot_count * interval '15 minutes') as calculated_end_time
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
            select count(*) from public.bookings eb
            where eb.status in ('pending', 'confirmed')
              and eb.slot_date = c.slot_date
              and required_slot.start_time >= eb.start_time
              and required_slot.start_time < eb.end_time
          ) >= required_slot.capacity
      )
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'slot_date', slot_date, 'start_time', start_time,
      'end_time', calculated_end_time, 'capacity', capacity
    ) order by start_time), '[]'::jsonb)
    from bookable
  );
end;
$$;
