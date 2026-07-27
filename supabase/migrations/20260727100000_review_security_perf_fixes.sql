-- Review fixes (2026-07-27)
-- 1) covering indexes สำหรับ FK ที่ advisor แจ้ง
-- 2) throttle การเดา get_guest_booking (anon เรียกได้)
-- 3) cron ล้าง anonymous auth users ค้าง (ระวัง: DB แชร์กับเว็บ booking — exclude profiles/bookings)
-- 4) ย้าย extension ออกจาก schema public

-- 1) FK covering indexes ----------------------------------------------------
create index if not exists bookings_member_id_idx
  on public.bookings (member_id);
create index if not exists customer_display_pairing_codes_created_by_staff_idx
  on public.customer_display_pairing_codes (created_by_staff_id);
create index if not exists products_category_id_idx
  on public.products (category_id);
create index if not exists services_category_id_idx
  on public.services (category_id);
create index if not exists staff_commission_bonuses_created_by_idx
  on public.staff_commission_bonuses (created_by);
create index if not exists staff_commission_results_branch_id_idx
  on public.staff_commission_results (branch_id);
create index if not exists staff_commission_results_staff_id_idx
  on public.staff_commission_results (staff_id);

-- 2) throttle get_guest_booking --------------------------------------------
create table if not exists private.guest_lookup_attempts (
  lookup_key text primary key,
  attempts integer not null default 1,
  window_start timestamptz not null default now()
);

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
  v_key text := lower(btrim(coalesce(p_booking_no, '')));
  v_attempts integer;
  v_result jsonb;
begin
  if length(v_key) not between 6 and 40 then
    return null;
  end if;
  if length(v_phone) not between 9 and 15 and length(v_line_uid) < 10 then
    return null;
  end if;

  -- เก็บกวาด window เก่า (ตารางเล็กมาก ลบทุกครั้งได้)
  delete from private.guest_lookup_attempts where window_start < now() - interval '1 hour';

  -- นับความพยายามต่อ booking_no: เกิน 10 ครั้ง/15 นาที = ปฏิเสธเงียบ ๆ
  insert into private.guest_lookup_attempts as a (lookup_key)
  values (v_key)
  on conflict (lookup_key) do update
    set attempts = case
          when a.window_start < now() - interval '15 minutes' then 1
          else a.attempts + 1
        end,
        window_start = case
          when a.window_start < now() - interval '15 minutes' then now()
          else a.window_start
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
  where b.booking_no = btrim(p_booking_no)
    and b.user_id is null
    and (
      (length(v_phone) between 9 and 15
       and regexp_replace(coalesce(b.guest_phone, ''), '\D', '', 'g') = v_phone)
      or (length(v_line_uid) >= 10 and b.guest_line_uid = v_line_uid)
    )
  limit 1;

  -- ค้นเจอ (เจ้าของจริง) = ล้างตัวนับ ไม่ให้ลูกค้าจริงโดนล็อก
  if v_result is not null then
    delete from private.guest_lookup_attempts where lookup_key = v_key;
  end if;

  return v_result;
end;
$$;

-- 3) cron ล้าง anonymous auth users ค้าง ------------------------------------
create or replace function private.cleanup_stale_anonymous_users()
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_deleted integer;
begin
  -- ลบเฉพาะ anonymous users ที่ไม่ได้ใช้เกิน 30 วัน และไม่ผูกกับอะไรเลย
  -- (staff_sessions = POS, profiles/bookings = เว็บ booking ที่แชร์ DB กัน)
  delete from auth.users u
  where u.is_anonymous
    and u.created_at < now() - interval '30 days'
    and coalesce(u.last_sign_in_at, u.created_at) < now() - interval '30 days'
    and not exists (select 1 from public.staff_sessions s where s.auth_user_id = u.id)
    and not exists (select 1 from public.profiles p where p.id = u.id)
    and not exists (select 1 from public.bookings b where b.user_id = u.id);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function private.cleanup_stale_anonymous_users() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('cleanup-stale-anonymous-users');
exception when others then
  null; -- ยังไม่เคยตั้ง job นี้
end;
$$;

-- 20:30 UTC = 03:30 เวลาไทย (นอกเวลาทำการ)
select cron.schedule(
  'cleanup-stale-anonymous-users',
  '30 20 * * *',
  $$select private.cleanup_stale_anonymous_users()$$
);

-- 4) ย้าย extension ออกจาก public -------------------------------------------
do $$
begin
  alter extension btree_gist set schema extensions;
exception when others then
  raise notice 'skip btree_gist move: %', sqlerrm;
end;
$$;

do $$
begin
  alter extension pg_net set schema extensions;
exception when others then
  raise notice 'skip pg_net move: %', sqlerrm;
end;
$$;
