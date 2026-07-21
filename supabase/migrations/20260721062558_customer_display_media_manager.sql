-- Owner-managed campaign media for the public customer display.
-- The bucket is public only for downloading/rendering. Upload permission remains
-- owner-only and is restricted to a folder for the owner's branch.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'customer-display-media',
  'customer-display-media',
  true,
  52428800,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/avif',
    'video/mp4', 'video/webm'
  ]::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.current_owner_branch_code()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select b.code
  from public.staff_sessions ss
  join public.staff s on s.id = ss.staff_id and s.active and s.role = 'owner'
  join public.branches b on b.id = s.branch_id and b.active
  where ss.auth_user_id = (select auth.uid())
    and ss.expires_at > now()
  limit 1
$$;

revoke all on function private.current_owner_branch_code() from public, anon;
grant execute on function private.current_owner_branch_code() to authenticated;

drop policy if exists customer_display_media_owner_upload on storage.objects;
create policy customer_display_media_owner_upload
on storage.objects for insert to authenticated
with check (
  bucket_id = 'customer-display-media'
  and (storage.foldername(name))[1] = (select private.current_owner_branch_code())
);

insert into public.settings(branch_id, key, value)
select b.id, s.key, s.value
from public.branches b
cross join (values
  ('customer_display_media_type', 'artwork'),
  ('customer_display_media_path', '')
) as s(key, value)
on conflict (branch_id, key) do nothing;

create or replace function public.get_customer_display_media()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner public.staff%rowtype;
  v_branch_code text;
  v_media_type text := 'artwork';
  v_media_path text;
begin
  v_owner := private.require_staff(true);

  select b.code into v_branch_code
  from public.branches b
  where b.id = v_owner.branch_id and b.active;

  select
    coalesce(max(s.value) filter (where s.key = 'customer_display_media_type'), 'artwork'),
    nullif(max(s.value) filter (where s.key = 'customer_display_media_path'), '')
  into v_media_type, v_media_path
  from public.settings s
  where s.branch_id = v_owner.branch_id
    and s.key in ('customer_display_media_type', 'customer_display_media_path');

  if v_media_type not in ('artwork', 'image', 'video') or v_media_path is null then
    v_media_type := 'artwork';
    v_media_path := null;
  end if;

  return jsonb_build_object(
    'branch_code', v_branch_code,
    'type', v_media_type,
    'path', v_media_path
  );
end;
$$;

create or replace function public.set_customer_display_media(p_media_type text, p_media_path text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner public.staff%rowtype;
  v_branch_code text;
  v_media_type text := lower(btrim(coalesce(p_media_type, '')));
  v_media_path text := nullif(btrim(coalesce(p_media_path, '')), '');
begin
  v_owner := private.require_staff(true);

  select b.code into v_branch_code
  from public.branches b
  where b.id = v_owner.branch_id and b.active;
  if v_branch_code is null then
    raise exception 'active branch not found';
  end if;

  if v_media_type not in ('artwork', 'image', 'video') then
    raise exception 'invalid media type';
  end if;

  if v_media_type = 'artwork' then
    v_media_path := null;
  else
    if v_media_path is null then
      raise exception 'media file is required';
    end if;
    if v_media_path !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,500}$'
       or v_media_path not like v_branch_code || '/%' then
      raise exception 'invalid media path';
    end if;
    if not exists (
      select 1
      from storage.objects o
      where o.bucket_id = 'customer-display-media'
        and o.name = v_media_path
    ) then
      raise exception 'uploaded media file was not found';
    end if;
  end if;

  insert into public.settings(branch_id, key, value)
  values (v_owner.branch_id, 'customer_display_media_type', v_media_type)
  on conflict (branch_id, key) do update set value = excluded.value;

  insert into public.settings(branch_id, key, value)
  values (v_owner.branch_id, 'customer_display_media_path', coalesce(v_media_path, ''))
  on conflict (branch_id, key) do update set value = excluded.value;

  return jsonb_build_object(
    'branch_code', v_branch_code,
    'type', v_media_type,
    'path', v_media_path
  );
end;
$$;

create or replace function public.get_customer_display(p_counter_code text, p_display_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_counter public.counters%rowtype;
  v_branch public.branches%rowtype;
  v_order public.orders%rowtype;
  v_media_type text := 'artwork';
  v_media_path text;
  v_campaign jsonb;
begin
  select c.* into v_counter
  from public.counters c
  join public.branches b on b.id = c.branch_id and b.active
  where c.code = p_counter_code
    and c.display_token_hash = encode(digest(coalesce(p_display_token, ''), 'sha256'), 'hex')
  limit 1;
  if not found then return null; end if;

  select * into v_branch from public.branches where id = v_counter.branch_id;
  select
    coalesce(max(s.value) filter (where s.key = 'customer_display_media_type'), 'artwork'),
    nullif(max(s.value) filter (where s.key = 'customer_display_media_path'), '')
  into v_media_type, v_media_path
  from public.settings s
  where s.branch_id = v_counter.branch_id
    and s.key in ('customer_display_media_type', 'customer_display_media_path');

  if v_media_type not in ('artwork', 'image', 'video') or v_media_path is null then
    v_media_type := 'artwork';
    v_media_path := null;
  end if;
  v_campaign := jsonb_build_object('type', v_media_type, 'path', v_media_path);

  if v_counter.current_order_id is null then
    return jsonb_build_object(
      'branch', jsonb_build_object('name', v_branch.name),
      'order', null,
      'campaign', v_campaign
    );
  end if;

  select * into v_order from public.orders where id = v_counter.current_order_id;
  if not found then
    return jsonb_build_object(
      'branch', jsonb_build_object('name', v_branch.name),
      'order', null,
      'campaign', v_campaign
    );
  end if;

  return jsonb_build_object(
    'branch', jsonb_build_object('name', v_branch.name, 'promptpay_id', v_branch.promptpay_id),
    'order', jsonb_build_object(
      'id', v_order.id, 'order_no', v_order.order_no, 'status', v_order.status,
      'subtotal', v_order.subtotal, 'discount', v_order.discount, 'total', v_order.total
    ),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', oi.id, 'name', oi.name_snapshot, 'qty', oi.qty, 'price', oi.price_snapshot
      ) order by oi.id), '[]'::jsonb)
      from public.order_items oi where oi.order_id = v_order.id
    ),
    'member', (
      select jsonb_build_object(
        'name', m.name, 'points_balance', m.points_balance, 'accumulated_baht', m.accumulated_baht
      ) from public.members m where m.id = v_order.member_id
    ),
    'campaign', v_campaign
  );
end;
$$;

revoke all on function public.get_customer_display_media() from public, anon;
revoke all on function public.set_customer_display_media(text, text) from public, anon;
revoke all on function public.get_customer_display(text, text) from public, authenticated;

grant execute on function public.get_customer_display_media() to authenticated;
grant execute on function public.set_customer_display_media(text, text) to authenticated;
grant execute on function public.get_customer_display(text, text) to anon, authenticated;
