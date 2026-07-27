-- A service may remain available at POS while being hidden from every booking
-- channel. Existing services default to bookable so the current online menu is
-- preserved until an owner changes it explicitly.
alter table public.services
  add column if not exists is_bookable boolean not null default true;

create index if not exists services_branch_bookable_idx
  on public.services (branch_id, sort_order, name)
  where is_active and is_bookable;

create or replace function public.catalog_set_booking_visibility(
  p_service uuid,
  p_is_bookable boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner public.staff%rowtype;
begin
  v_owner := private.require_staff(true);

  update public.services
  set is_bookable = coalesce(p_is_bookable, false)
  where id = p_service
    and branch_id = v_owner.branch_id;

  if not found then
    raise exception 'service not found';
  end if;
  return p_is_bookable;
end;
$$;

revoke all on function public.catalog_set_booking_visibility(uuid, boolean) from public, anon;
grant execute on function public.catalog_set_booking_visibility(uuid, boolean) to authenticated;

-- Applies to every booking writer (LIFF, website, and POS) so a forged API
-- request cannot book a service that an owner has hidden from booking.
create or replace function private.require_bookable_booking_services()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service_ids uuid[] := coalesce(new.service_ids, array[new.service_id]);
begin
  if new.service_id is null or cardinality(v_service_ids) = 0 then
    raise exception 'booking service is required';
  end if;

  if exists (
    select 1
    from unnest(v_service_ids) as requested(service_id)
    left join public.services s
      on s.id = requested.service_id
     and s.is_active
     and s.is_bookable
    where s.id is null
  ) then
    raise exception 'one or more services are not available for booking';
  end if;

  return new;
end;
$$;

revoke all on function private.require_bookable_booking_services() from public, anon, authenticated;
drop trigger if exists require_bookable_booking_services on public.bookings;
create trigger require_bookable_booking_services
before insert or update of service_id, service_ids on public.bookings
for each row execute function private.require_bookable_booking_services();

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
    where s.branch_id = v_staff.branch_id
      and s.is_active
      and s.is_bookable
  );
end;
$$;

revoke all on function public.pos_booking_services() from public, anon;
grant execute on function public.pos_booking_services() to authenticated;
