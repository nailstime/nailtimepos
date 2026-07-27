-- PostgreSQL regex repetition bounds cannot use {0,500}. Keep the same
-- allow-list, but validate the maximum path length separately.
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
  if v_branch_code is null then raise exception 'active branch not found'; end if;
  if v_media_type not in ('artwork', 'image', 'video') then raise exception 'invalid media type'; end if;

  if v_media_type = 'artwork' then
    v_media_path := null;
  else
    if v_media_path is null then raise exception 'media file is required'; end if;
    if length(v_media_path) > 500
       or v_media_path !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
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

  return jsonb_build_object('branch_code', v_branch_code, 'type', v_media_type, 'path', v_media_path);
end;
$$;
