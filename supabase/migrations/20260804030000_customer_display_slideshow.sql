-- Slideshow mode: display multiple images cycling automatically on the customer screen.
-- Stored as a JSON array in settings; a separate interval setting controls the speed.

insert into public.settings(branch_id, key, value)
select b.id, s.key, s.value
from public.branches b
cross join (values
  ('customer_display_slideshow_paths', '[]'),
  ('customer_display_slideshow_interval', '5000')
) as s(key, value)
on conflict (branch_id, key) do nothing;

-- Allow 'slideshow' type in set_customer_display_media (no path required, like 'artwork')
create or replace function public.set_customer_display_media(
  p_media_type text,
  p_media_path text default null
)
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

  if v_media_type not in ('artwork', 'image', 'video', 'slideshow') then
    raise exception 'invalid media type';
  end if;

  if v_media_type in ('artwork', 'slideshow') then
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
      select 1 from storage.objects o
      where o.bucket_id = 'customer-display-media' and o.name = v_media_path
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

-- Validates paths, stores them, and activates slideshow mode in one call
create or replace function public.set_slideshow_media(
  p_paths text[],
  p_interval_ms int default 5000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner public.staff%rowtype;
  v_branch_code text;
  v_paths text[] := coalesce(p_paths, '{}'::text[]);
  v_interval_ms int := greatest(2000, least(60000, coalesce(p_interval_ms, 5000)));
  v_path text;
begin
  v_owner := private.require_staff(true);

  select b.code into v_branch_code
  from public.branches b
  where b.id = v_owner.branch_id and b.active;
  if v_branch_code is null then
    raise exception 'active branch not found';
  end if;

  if coalesce(array_length(v_paths, 1), 0) = 0 then
    raise exception 'slideshow must have at least one image';
  end if;

  if array_length(v_paths, 1) > 20 then
    raise exception 'slideshow cannot exceed 20 images';
  end if;

  foreach v_path in array v_paths loop
    if v_path is null
       or length(v_path) > 500
       or v_path !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
       or v_path not like v_branch_code || '/%' then
      raise exception 'invalid image path';
    end if;
    if not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'customer-display-media'
        and o.name = v_path
        and coalesce(o.metadata->>'mimetype', '') not like 'video/%'
    ) then
      raise exception 'image not found: %', v_path;
    end if;
  end loop;

  insert into public.settings(branch_id, key, value)
  values (v_owner.branch_id, 'customer_display_slideshow_paths', to_jsonb(v_paths)::text)
  on conflict (branch_id, key) do update set value = excluded.value;

  insert into public.settings(branch_id, key, value)
  values (v_owner.branch_id, 'customer_display_slideshow_interval', v_interval_ms::text)
  on conflict (branch_id, key) do update set value = excluded.value;

  insert into public.settings(branch_id, key, value)
  values (v_owner.branch_id, 'customer_display_media_type', 'slideshow')
  on conflict (branch_id, key) do update set value = excluded.value;

  insert into public.settings(branch_id, key, value)
  values (v_owner.branch_id, 'customer_display_media_path', '')
  on conflict (branch_id, key) do update set value = excluded.value;

  return jsonb_build_object(
    'branch_code', v_branch_code,
    'type', 'slideshow',
    'path', null,
    'slideshow_paths', to_jsonb(v_paths),
    'slideshow_interval', v_interval_ms
  );
end;
$$;

revoke all on function public.set_slideshow_media(text[], int) from public, anon;
grant execute on function public.set_slideshow_media(text[], int) to authenticated;

-- get_customer_display_media: add slideshow_paths + slideshow_interval, allow 'slideshow' type
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
  v_slideshow_paths_raw text := '[]';
  v_slideshow_interval int := 5000;
  v_library jsonb := '[]'::jsonb;
begin
  v_owner := private.require_staff(true);

  select b.code into v_branch_code
  from public.branches b
  where b.id = v_owner.branch_id and b.active;
  if v_branch_code is null then
    raise exception 'active branch not found';
  end if;

  select
    coalesce(max(s.value) filter (where s.key = 'customer_display_media_type'), 'artwork'),
    nullif(max(s.value) filter (where s.key = 'customer_display_media_path'), ''),
    coalesce(nullif(max(s.value) filter (where s.key = 'customer_display_slideshow_paths'), ''), '[]'),
    coalesce(nullif(max(s.value) filter (where s.key = 'customer_display_slideshow_interval'), '')::int, 5000)
  into v_media_type, v_media_path, v_slideshow_paths_raw, v_slideshow_interval
  from public.settings s
  where s.branch_id = v_owner.branch_id
    and s.key in (
      'customer_display_media_type', 'customer_display_media_path',
      'customer_display_slideshow_paths', 'customer_display_slideshow_interval'
    );

  if v_media_type not in ('artwork', 'image', 'video', 'slideshow') then
    v_media_type := 'artwork';
    v_media_path := null;
  elsif v_media_type in ('image', 'video') and v_media_path is null then
    v_media_type := 'artwork';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'path', media.path,
    'name', media.name,
    'type', media.type,
    'created_at', media.created_at,
    'size', media.size
  ) order by media.created_at desc), '[]'::jsonb)
  into v_library
  from (
    select
      o.name as path,
      regexp_replace(o.name, '^.*/', '') as name,
      case when coalesce(o.metadata->>'mimetype', '') like 'video/%' then 'video' else 'image' end as type,
      o.created_at,
      coalesce((o.metadata->>'size')::bigint, 0) as size
    from storage.objects o
    where o.bucket_id = 'customer-display-media'
      and (storage.foldername(o.name))[1] = v_branch_code
  ) as media;

  return jsonb_build_object(
    'branch_code', v_branch_code,
    'type', v_media_type,
    'path', v_media_path,
    'library', v_library,
    'slideshow_paths', coalesce(v_slideshow_paths_raw::jsonb, '[]'::jsonb),
    'slideshow_interval', v_slideshow_interval
  );
end;
$$;

-- get_customer_display: add slideshow fields to campaign so kiosk can cycle images
create or replace function public.get_customer_display(p_counter_code text, p_display_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_counter public.counters%rowtype;
  v_branch public.branches%rowtype;
  v_order public.orders%rowtype;
  v_media_type text := 'artwork';
  v_media_path text;
  v_slideshow_paths_raw text := '[]';
  v_slideshow_interval int := 5000;
  v_campaign jsonb;
  v_token_hash text := encode(digest(coalesce(p_display_token, ''), 'sha256'), 'hex');
begin
  select c.* into v_counter
  from public.counters c
  join public.branches b on b.id = c.branch_id and b.active
  where c.code = upper(btrim(coalesce(p_counter_code, '')))
    and (
      c.display_token_hash = v_token_hash
      or exists (
        select 1
        from public.customer_display_devices d
        where d.counter_id = c.id
          and d.device_token_hash = v_token_hash
          and d.revoked_at is null
      )
    )
  limit 1;
  if not found then return null; end if;

  select * into v_branch from public.branches where id = v_counter.branch_id;

  select
    coalesce(max(s.value) filter (where s.key = 'customer_display_media_type'), 'artwork'),
    nullif(max(s.value) filter (where s.key = 'customer_display_media_path'), ''),
    coalesce(nullif(max(s.value) filter (where s.key = 'customer_display_slideshow_paths'), ''), '[]'),
    coalesce(nullif(max(s.value) filter (where s.key = 'customer_display_slideshow_interval'), '')::int, 5000)
  into v_media_type, v_media_path, v_slideshow_paths_raw, v_slideshow_interval
  from public.settings s
  where s.branch_id = v_counter.branch_id
    and s.key in (
      'customer_display_media_type', 'customer_display_media_path',
      'customer_display_slideshow_paths', 'customer_display_slideshow_interval'
    );

  if v_media_type not in ('artwork', 'image', 'video', 'slideshow') then
    v_media_type := 'artwork';
    v_media_path := null;
  elsif v_media_type in ('image', 'video') and v_media_path is null then
    v_media_type := 'artwork';
  end if;

  v_campaign := jsonb_build_object(
    'type', v_media_type,
    'path', v_media_path,
    'slideshow_paths', coalesce(v_slideshow_paths_raw::jsonb, '[]'::jsonb),
    'slideshow_interval', v_slideshow_interval
  );

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
