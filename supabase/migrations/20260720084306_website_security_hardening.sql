-- Harden the existing nailstime booking schema without removing guest booking lookup.
-- Guest access is provided through a credential-checked RPC instead of broad table SELECT.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- New Data API objects must be exposed explicitly.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- Profiles: customers may edit contact fields, never their authorization role.
drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;

create policy "Users can view own profile"
on public.profiles for select to authenticated
using ((select auth.uid()) = id);

create policy "Users can update own profile"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

revoke all on table public.profiles from anon;
revoke insert, update, delete, truncate, references, trigger on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;
grant update (full_name, phone, line_uid, line_display_name, line_picture_url)
  on table public.profiles to authenticated;

-- Booking policies: direct reads are for signed-in owners/admins. Guests use the RPC below.
drop policy if exists "Admins can manage all bookings" on public.bookings;
drop policy if exists "Anyone can create booking" on public.bookings;
drop policy if exists "Users can cancel own booking" on public.bookings;
drop policy if exists "Users can view own bookings" on public.bookings;

create policy "Admins can manage all bookings"
on public.bookings for all to authenticated
using (exists (
  select 1 from public.profiles p
  where p.id = (select auth.uid()) and p.role = 'admin'
))
with check (exists (
  select 1 from public.profiles p
  where p.id = (select auth.uid()) and p.role = 'admin'
));

create policy "Anyone can create booking"
on public.bookings for insert to anon, authenticated
with check (
  status = 'pending'
  and service_id is not null
  and slot_id is not null
  and slot_date is not null
  and start_time is not null
  and end_time is not null
  and (
    ((select auth.uid()) is not null and user_id = (select auth.uid()))
    or (
      user_id is null
      and guest_name is not null
      and (guest_phone is not null or guest_line_uid is not null)
    )
  )
);

create policy "Users can view own bookings"
on public.bookings for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can cancel own booking"
on public.bookings for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id and status = 'cancelled');

revoke select, update, delete on table public.bookings from anon;
grant insert on table public.bookings to anon;
grant select, insert, update on table public.bookings to authenticated;

-- Prevent a regular customer from changing booking details while cancelling.
create or replace function private.guard_booking_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jwt_role text := coalesce((select auth.jwt()) ->> 'role', '');
  v_is_admin boolean := false;
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

revoke execute on function private.guard_booking_update() from public, anon, authenticated;
drop trigger if exists guard_booking_update on public.bookings;
create trigger guard_booking_update
before update on public.bookings
for each row execute function private.guard_booking_update();

-- Credential-checked lookup for non-member bookings. The response excludes guest PII.
create or replace function public.get_guest_booking(
  p_booking_no text,
  p_guest_phone text default null,
  p_guest_line_uid text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_phone text := regexp_replace(coalesce(p_guest_phone, ''), '\D', '', 'g');
  v_line_uid text := btrim(coalesce(p_guest_line_uid, ''));
  v_result jsonb;
begin
  if length(btrim(coalesce(p_booking_no, ''))) not between 6 and 40 then
    return null;
  end if;
  if length(v_phone) not between 9 and 15 and length(v_line_uid) < 10 then
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
  where b.booking_no = btrim(p_booking_no)
    and b.user_id is null
    and (
      (length(v_phone) between 9 and 15
       and regexp_replace(coalesce(b.guest_phone, ''), '\D', '', 'g') = v_phone)
      or (length(v_line_uid) >= 10 and b.guest_line_uid = v_line_uid)
    )
  limit 1;

  return v_result;
end;
$$;

revoke execute on function public.get_guest_booking(text, text, text) from public;
grant execute on function public.get_guest_booking(text, text, text) to anon, authenticated;

-- Keep public slot availability accurate without letting a public view bypass booking RLS.
alter table public.time_slots
  add column if not exists booked_count integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'time_slots_booked_count_check'
      and conrelid = 'public.time_slots'::regclass
  ) then
    alter table public.time_slots
      add constraint time_slots_booked_count_check
      check (booked_count >= 0 and booked_count <= capacity);
  end if;
end $$;

update public.time_slots s
set booked_count = least(s.capacity, x.booked_count)
from (
  select b.slot_id, count(*)::integer as booked_count
  from public.bookings b
  where b.slot_id is not null and b.status in ('pending', 'confirmed')
  group by b.slot_id
) x
where s.id = x.slot_id;

update public.time_slots s
set booked_count = 0
where not exists (
  select 1 from public.bookings b
  where b.slot_id = s.id and b.status in ('pending', 'confirmed')
);

create or replace function private.refresh_slot_booked_count(p_slot_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.time_slots s
  set booked_count = least(
    s.capacity,
    (
      select count(*)::integer
      from public.bookings b
      where b.slot_id = p_slot_id and b.status in ('pending', 'confirmed')
    )
  )
  where s.id = p_slot_id
$$;

create or replace function private.sync_slot_booked_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.slot_id is not null then
    perform private.refresh_slot_booked_count(old.slot_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.slot_id is not null then
    perform private.refresh_slot_booked_count(new.slot_id);
  end if;
  return coalesce(new, old);
end;
$$;

revoke execute on function private.refresh_slot_booked_count(uuid) from public, anon, authenticated;
revoke execute on function private.sync_slot_booked_count() from public, anon, authenticated;
drop trigger if exists sync_slot_booked_count on public.bookings;
create trigger sync_slot_booked_count
after insert or update of slot_id, status or delete on public.bookings
for each row execute function private.sync_slot_booked_count();

drop view if exists public.slot_availability;
create view public.slot_availability
with (security_invoker = true)
as
select
  s.id,
  s.slot_date,
  s.start_time,
  s.end_time,
  s.capacity,
  s.is_active,
  s.booked_count,
  s.capacity - s.booked_count as available
from public.time_slots s;

grant select on public.slot_availability to anon, authenticated;

-- Scope and optimize the remaining RLS policies.
drop policy if exists "Admins can manage services" on public.services;
drop policy if exists "Anyone can view active services" on public.services;
create policy "Admins can manage services"
on public.services for all to authenticated
using (exists (
  select 1 from public.profiles p
  where p.id = (select auth.uid()) and p.role = 'admin'
))
with check (exists (
  select 1 from public.profiles p
  where p.id = (select auth.uid()) and p.role = 'admin'
));
create policy "Anyone can view active services"
on public.services for select to anon, authenticated
using (is_active = true);

drop policy if exists "Admins can manage slots" on public.time_slots;
drop policy if exists "Anyone can view active slots" on public.time_slots;
create policy "Admins can manage slots"
on public.time_slots for all to authenticated
using (exists (
  select 1 from public.profiles p
  where p.id = (select auth.uid()) and p.role = 'admin'
))
with check (exists (
  select 1 from public.profiles p
  where p.id = (select auth.uid()) and p.role = 'admin'
));
create policy "Anyone can view active slots"
on public.time_slots for select to anon, authenticated
using (is_active = true);

drop policy if exists "Admins can manage SEO" on public.seo_settings;
drop policy if exists "Anyone can read SEO" on public.seo_settings;
create policy "Admins can manage SEO"
on public.seo_settings for all to authenticated
using (exists (
  select 1 from public.profiles p
  where p.id = (select auth.uid()) and p.role = 'admin'
))
with check (exists (
  select 1 from public.profiles p
  where p.id = (select auth.uid()) and p.role = 'admin'
));
create policy "Anyone can read SEO"
on public.seo_settings for select to anon, authenticated
using (true);

drop policy if exists "Admins can update lead" on public.leads;
drop policy if exists "Admins can view leads" on public.leads;
drop policy if exists "Anyone can submit lead" on public.leads;
create policy "Admins can manage leads"
on public.leads for all to authenticated
using (exists (
  select 1 from public.profiles p
  where p.id = (select auth.uid()) and p.role = 'admin'
))
with check (exists (
  select 1 from public.profiles p
  where p.id = (select auth.uid()) and p.role = 'admin'
));
create policy "Anyone can submit lead"
on public.leads for insert to anon, authenticated
with check (length(btrim(name)) between 1 and 160 and length(regexp_replace(phone, '\D', '', 'g')) between 9 and 15);

-- Foreign keys are not automatically indexed by Postgres.
create index if not exists bookings_service_id_idx on public.bookings(service_id);
create index if not exists bookings_slot_id_idx on public.bookings(slot_id);
create index if not exists bookings_user_id_idx on public.bookings(user_id) where user_id is not null;
create index if not exists bookings_guest_lookup_idx
  on public.bookings(booking_no, guest_line_uid)
  where user_id is null and guest_line_uid is not null;

-- Lock search paths and remove direct API execution from trigger/maintenance functions.
alter function public.handle_new_user() set search_path = '';
alter function public.set_updated_at() set search_path = '';
alter function public.generate_time_slots(integer, time without time zone, time without time zone, integer)
  set search_path = '';
alter function public.monthly_slot_maintenance() set search_path = '';
alter function public.trigger_booking_reminder() set search_path = '';

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.generate_time_slots(integer, time without time zone, time without time zone, integer)
  from public, anon;
grant execute on function public.generate_time_slots(integer, time without time zone, time without time zone, integer)
  to authenticated;
revoke execute on function public.monthly_slot_maintenance() from public, anon, authenticated;
revoke execute on function public.trigger_booking_reminder() from public, anon, authenticated;

notify pgrst, 'reload schema';
