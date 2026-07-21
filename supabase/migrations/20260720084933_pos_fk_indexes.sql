-- Cover every POS foreign key used for joins and referential checks.
create index if not exists approval_requests_decided_by_idx on public.approval_requests(decided_by);
create index if not exists approval_requests_requested_by_idx on public.approval_requests(requested_by);
create index if not exists commission_settings_created_by_idx on public.commission_settings(created_by);
create index if not exists daily_reconciliations_reconciled_by_idx on public.daily_reconciliations(reconciled_by);
create index if not exists member_link_codes_issued_by_idx on public.member_link_codes(issued_by);
create index if not exists order_items_redemption_id_idx on public.order_items(redemption_id) where redemption_id is not null;
create index if not exists orders_void_approved_by_idx on public.orders(void_approved_by) where void_approved_by is not null;
create index if not exists payments_confirmed_by_staff_id_idx on public.payments(confirmed_by_staff_id) where confirmed_by_staff_id is not null;
create index if not exists points_ledger_ref_order_id_idx on public.points_ledger(ref_order_id) where ref_order_id is not null;
create index if not exists points_ledger_ref_redemption_id_idx on public.points_ledger(ref_redemption_id) where ref_redemption_id is not null;
create index if not exists points_ledger_staff_id_idx on public.points_ledger(staff_id) where staff_id is not null;
create index if not exists redemptions_reward_id_idx on public.redemptions(reward_id);
create index if not exists stock_movements_staff_id_idx on public.stock_movements(staff_id) where staff_id is not null;
