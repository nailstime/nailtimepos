-- Fix: can_delete_customer_display_media used plpgsql + require_staff(true) which
-- throws exceptions inside the Supabase Storage RLS evaluation context.
-- The Storage service swallows the exception and treats the policy as false,
-- causing storage.remove() to return { data: [], error: null } — the JS client
-- thinks deletion succeeded but nothing was actually removed.
-- Rewrite as a pure SQL function that returns false (not exception) when not authorized.

create or replace function private.can_delete_customer_display_media(
  p_bucket_id  text,
  p_object_name text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_bucket_id = 'customer-display-media'
    and exists (
      select 1
      from   public.staff_sessions ss
      join   public.staff          st on st.id = ss.staff_id
                                      and st.active
                                      and st.role = 'owner'
      join   public.branches        b  on b.id  = st.branch_id
                                      and b.active
      where  ss.auth_user_id = (select auth.uid())
        and  ss.expires_at   > now()
        and  p_object_name like b.code || '/%'
        and  not exists (
               select 1
               from   public.settings s
               where  s.branch_id = b.id
                 and  s.key       = 'customer_display_media_path'
                 and  nullif(s.value, '') = p_object_name
             )
    )
$$;
