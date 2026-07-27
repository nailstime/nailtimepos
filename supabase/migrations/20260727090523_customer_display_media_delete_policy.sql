-- Storage objects must be deleted through the Storage API, not directly from
-- storage.objects. Keep the authorization rule in the database so a client
-- cannot delete another branch's file or the campaign currently on screen.
create or replace function private.can_delete_customer_display_media(
  p_bucket_id text,
  p_object_name text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner public.staff%rowtype;
  v_branch_code text;
begin
  v_owner := private.require_staff(true);

  select b.code into v_branch_code
  from public.branches b
  where b.id = v_owner.branch_id and b.active;

  return v_branch_code is not null
    and p_bucket_id = 'customer-display-media'
    and p_object_name like v_branch_code || '/%'
    and not exists (
      select 1
      from public.settings s
      where s.branch_id = v_owner.branch_id
        and s.key = 'customer_display_media_path'
        and nullif(s.value, '') = p_object_name
    );
end;
$$;

revoke all on function private.can_delete_customer_display_media(text, text) from public;
grant execute on function private.can_delete_customer_display_media(text, text) to authenticated;

drop policy if exists customer_display_media_owner_delete on storage.objects;
create policy customer_display_media_owner_delete
on storage.objects
for delete
to authenticated
using (private.can_delete_customer_display_media(bucket_id, name));

-- The previous RPC attempted a direct DELETE from storage.objects, which the
-- Storage service rejects. The browser now calls the Storage API and is
-- constrained by the policy above.
drop function if exists public.delete_customer_display_media(text);
