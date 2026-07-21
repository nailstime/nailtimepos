-- POS RPCs deliberately use a restricted search_path because they are
-- SECURITY DEFINER functions. pgcrypto is installed in the extensions schema
-- on hosted Supabase, so include that trusted schema explicitly.

alter function public.staff_login(text)
  set search_path = pg_catalog, extensions;

alter function public.create_staff(text, text, text)
  set search_path = pg_catalog, extensions;

alter function public.reset_staff_pin(uuid, text)
  set search_path = pg_catalog, extensions;

alter function public.issue_member_link_code(uuid)
  set search_path = pg_catalog, extensions;

alter function public.get_customer_display(text, text)
  set search_path = pg_catalog, extensions;

alter function public.line_register_member(text, text, text, text, text)
  set search_path = pg_catalog, extensions;
