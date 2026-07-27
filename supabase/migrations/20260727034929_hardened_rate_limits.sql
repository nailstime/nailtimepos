-- Durable rate limits for public Edge Functions.
-- The function is executable only by service_role; browser clients cannot write buckets directly.
create table if not exists private.edge_rate_limit_buckets (
  limit_key text primary key check (char_length(limit_key) between 1 and 200),
  attempts integer not null default 1 check (attempts >= 1),
  window_started_at timestamptz not null default clock_timestamp()
);

alter table private.edge_rate_limit_buckets enable row level security;

create index if not exists edge_rate_limit_buckets_window_started_at_idx
  on private.edge_rate_limit_buckets (window_started_at);

create or replace function public.consume_line_member_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_attempts integer;
begin
  if p_key is null or char_length(p_key) not between 1 and 200 then
    raise exception 'invalid rate limit key';
  end if;
  if p_limit not between 1 and 1000 or p_window_seconds not between 1 and 86400 then
    raise exception 'invalid rate limit settings';
  end if;

  insert into private.edge_rate_limit_buckets as bucket (limit_key, attempts, window_started_at)
  values (p_key, 1, clock_timestamp())
  on conflict (limit_key) do update
    set attempts = case
          when bucket.window_started_at <= clock_timestamp() - make_interval(secs => p_window_seconds) then 1
          else bucket.attempts + 1
        end,
        window_started_at = case
          when bucket.window_started_at <= clock_timestamp() - make_interval(secs => p_window_seconds) then clock_timestamp()
          else bucket.window_started_at
        end
  returning attempts into v_attempts;

  -- จำกัดการเติบโตของตาราง โดย index ด้านบนทำให้การเก็บกวาดไม่ต้องสแกนเต็มตาราง
  delete from private.edge_rate_limit_buckets
  where window_started_at < clock_timestamp() - interval '2 hours';

  return v_attempts > p_limit;
end;
$$;

revoke all on function public.consume_line_member_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_line_member_rate_limit(text, integer, integer) to service_role;

-- get_guest_booking is intentionally public for the website. Avoid persisting arbitrary,
-- nonexistent booking numbers, otherwise a caller could grow the attempt table indefinitely.
create index if not exists guest_lookup_attempts_window_start_idx
  on private.guest_lookup_attempts (window_start);

create or replace function public.get_guest_booking(
  p_booking_no text,
  p_guest_phone text default null,
  p_guest_line_uid text default null
)
returns jsonb
language plpgsql
volatile security definer
set search_path to ''
as $$
declare
  v_phone text := regexp_replace(coalesce(p_guest_phone, ''), '\D', '', 'g');
  v_line_uid text := btrim(coalesce(p_guest_line_uid, ''));
  v_booking_no text := btrim(coalesce(p_booking_no, ''));
  v_key text := lower(v_booking_no);
  v_attempts integer;
  v_result jsonb;
begin
  if length(v_key) not between 6 and 40 then
    return null;
  end if;
  if length(v_phone) not between 9 and 15 and length(v_line_uid) < 10 then
    return null;
  end if;

  -- Do not create throttle rows for made-up booking numbers.
  if not exists (
    select 1
    from public.bookings b
    where b.booking_no = v_booking_no
      and b.user_id is null
  ) then
    return null;
  end if;

  delete from private.guest_lookup_attempts
  where window_start < clock_timestamp() - interval '1 hour';

  insert into private.guest_lookup_attempts as attempt (lookup_key)
  values (v_key)
  on conflict (lookup_key) do update
    set attempts = case
          when attempt.window_start < clock_timestamp() - interval '15 minutes' then 1
          else attempt.attempts + 1
        end,
        window_start = case
          when attempt.window_start < clock_timestamp() - interval '15 minutes' then clock_timestamp()
          else attempt.window_start
        end
  returning attempts into v_attempts;

  if v_attempts > 10 then
    return null;
  end if;

  select jsonb_build_object(
    'booking_no', b.booking_no,
    'status', b.status,
    'slot_date', b.slot_date,
    'start_time', b.start_time,
    'end_time', b.end_time,
    'created_at', b.created_at,
    'service', jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'name_en', s.name_en,
      'duration', s.duration
    )
  )
  into v_result
  from public.bookings b
  join public.services s on s.id = b.service_id
  where b.booking_no = v_booking_no
    and b.user_id is null
    and (
      (length(v_phone) between 9 and 15
       and regexp_replace(coalesce(b.guest_phone, ''), '\D', '', 'g') = v_phone)
      or (length(v_line_uid) >= 10 and b.guest_line_uid = v_line_uid)
    )
  limit 1;

  if v_result is not null then
    delete from private.guest_lookup_attempts where lookup_key = v_key;
  end if;

  return v_result;
end;
$$;
