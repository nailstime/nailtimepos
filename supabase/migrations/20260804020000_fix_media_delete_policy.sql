-- Root cause analysis:
-- 1. storage.remove() (Storage API): RLS was blocking because can_delete_customer_display_media
--    relied on a complex staff_sessions JOIN that fails in the Storage API's DELETE context
--    (auth.uid() appears unavailable unlike in the INSERT context). Result: { data: [], error: null }
-- 2. DELETE FROM storage.objects in RPC: blocked by Supabase's protect_objects_delete trigger
--    which prevents direct SQL deletion outside the Storage API path. Result: 403.
--
-- Fix: Mirror the upload policy approach — use current_owner_branch_code() which is the
-- SAME function that already works for the INSERT policy. This restricts deletion to owners
-- of the matching branch without relying on the complex staff_sessions check.

drop policy if exists customer_display_media_owner_delete on storage.objects;
create policy customer_display_media_owner_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'customer-display-media'
  and (storage.foldername(name))[1] = (select private.current_owner_branch_code())
);

-- Drop the RPC that can never work (blocked by protect_objects_delete trigger)
drop function if exists public.owner_delete_display_media(text);

-- Drop the now-unused helper (policy no longer calls it)
drop function if exists private.can_delete_customer_display_media(text, text);
