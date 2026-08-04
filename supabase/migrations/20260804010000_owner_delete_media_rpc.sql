-- Move media deletion from client-side storage.remove() (which silently fails
-- due to auth.uid() not being set correctly in the Supabase Storage RLS context)
-- into a SECURITY DEFINER RPC that runs via PostgREST where require_staff(true)
-- is guaranteed to work.
--
-- The function handles both active and non-active media:
--   • If the file is currently active, it switches to artwork first
--   • Then deletes the record from storage.objects
--
-- Note: deleting from storage.objects removes the library record immediately.
-- Supabase Storage triggers handle physical file cleanup asynchronously.

create or replace function public.owner_delete_display_media(p_media_path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner      public.staff%rowtype;
  v_branch_code text;
  v_path       text := nullif(btrim(coalesce(p_media_path, '')), '');
  v_active_path text;
begin
  v_owner := private.require_staff(true);

  select b.code into v_branch_code
  from public.branches b
  where b.id = v_owner.branch_id and b.active;
  if v_branch_code is null then
    raise exception 'active branch not found';
  end if;

  -- Validate path belongs to this branch and looks safe
  if v_path is null
     or length(v_path) > 500
     or v_path !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
     or v_path not like v_branch_code || '/%' then
    raise exception 'invalid media path';
  end if;

  -- Check if this file is the currently active one
  select nullif(s.value, '') into v_active_path
  from public.settings s
  where s.branch_id = v_owner.branch_id
    and s.key = 'customer_display_media_path';

  -- If active: switch to default artwork first
  if v_active_path = v_path then
    insert into public.settings(branch_id, key, value)
    values (v_owner.branch_id, 'customer_display_media_type', 'artwork')
    on conflict (branch_id, key) do update set value = excluded.value;

    insert into public.settings(branch_id, key, value)
    values (v_owner.branch_id, 'customer_display_media_path', '')
    on conflict (branch_id, key) do update set value = excluded.value;
  end if;

  -- Delete the storage object record (Supabase triggers handle physical cleanup)
  delete from storage.objects
  where bucket_id = 'customer-display-media'
    and name = v_path;

  if not found then
    raise exception 'media file not found';
  end if;

  return jsonb_build_object(
    'path',      v_path,
    'was_active', v_active_path = v_path
  );
end;
$$;

revoke all on function public.owner_delete_display_media(text) from public, anon;
grant execute on function public.owner_delete_display_media(text) to authenticated;
