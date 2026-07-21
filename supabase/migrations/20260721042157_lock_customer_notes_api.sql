-- Customer notes are returned only through staff-scoped RPCs. This prevents an
-- anonymous authenticated session from ever reaching the table directly.
drop policy if exists customer_notes_branch_read on public.customer_notes;
revoke all on table public.customer_notes from public, anon, authenticated;
