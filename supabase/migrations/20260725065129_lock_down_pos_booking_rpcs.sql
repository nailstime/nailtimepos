-- New PostgreSQL functions are executable by PUBLIC unless explicitly revoked.
-- These endpoints are PIN-staff-only and must never be exposed to anon callers.

revoke execute on function public.pos_list_bookings(date, text) from public, anon;
revoke execute on function public.pos_booking_services() from public, anon;
revoke execute on function public.pos_booking_slots(date, uuid) from public, anon;
revoke execute on function public.pos_create_booking(uuid, uuid, text, text, text, text) from public, anon;
revoke execute on function public.pos_set_booking_status(uuid, text) from public, anon;
revoke execute on function public.create_order_from_booking(text, uuid, jsonb, uuid) from public, anon;

grant execute on function public.pos_list_bookings(date, text) to authenticated;
grant execute on function public.pos_booking_services() to authenticated;
grant execute on function public.pos_booking_slots(date, uuid) to authenticated;
grant execute on function public.pos_create_booking(uuid, uuid, text, text, text, text) to authenticated;
grant execute on function public.pos_set_booking_status(uuid, text) to authenticated;
grant execute on function public.create_order_from_booking(text, uuid, jsonb, uuid) to authenticated;
