-- The media-manager migration replaces this SECURITY DEFINER function. Restore
-- the trusted pgcrypto schema required for digest() to validate display tokens.
alter function public.get_customer_display(text, text)
  set search_path = pg_catalog, extensions;

NOTIFY pgrst, 'reload schema';
