-- Keep previously uploaded customer-display media available for reuse.
-- The list is returned only through an owner-checked RPC; the storage bucket
-- remains public solely so an already-selected file can be rendered by kiosks.

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
    nullif(max(s.value) filter (where s.key = 'customer_display_media_path'), '')
  into v_media_type, v_media_path
  from public.settings s
  where s.branch_id = v_owner.branch_id
    and s.key in ('customer_display_media_type', 'customer_display_media_path');

  if v_media_type not in ('artwork', 'image', 'video') or v_media_path is null then
    v_media_type := 'artwork';
    v_media_path := null;
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
    'library', v_library
  );
end;
$$;

create or replace function public.delete_customer_display_media(p_media_path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner public.staff%rowtype;
  v_branch_code text;
  v_media_path text := nullif(btrim(coalesce(p_media_path, '')), '');
  v_active_path text;
begin
  v_owner := private.require_staff(true);

  select b.code into v_branch_code
  from public.branches b
  where b.id = v_owner.branch_id and b.active;
  if v_branch_code is null then
    raise exception 'active branch not found';
  end if;

  if v_media_path is null
     or length(v_media_path) > 500
     or v_media_path !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
     or v_media_path not like v_branch_code || '/%' then
    raise exception 'invalid media path';
  end if;

  select nullif(s.value, '') into v_active_path
  from public.settings s
  where s.branch_id = v_owner.branch_id
    and s.key = 'customer_display_media_path';

  if v_active_path = v_media_path then
    raise exception 'switch to another media or default artwork before deleting this file';
  end if;

  delete from storage.objects
  where bucket_id = 'customer-display-media'
    and name = v_media_path;

  if not found then
    raise exception 'media file was not found';
  end if;

  return jsonb_build_object('path', v_media_path);
end;
$$;

revoke all on function public.delete_customer_display_media(text) from public, anon;
grant execute on function public.delete_customer_display_media(text) to authenticated;
