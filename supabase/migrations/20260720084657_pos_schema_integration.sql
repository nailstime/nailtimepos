-- Nail Time & Spa POS + CRM integrated with the existing booking website schema.
-- Migration 001: schema only. Run 002_security_and_api.sql next, then seed.example.sql.

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_-]{1,20}$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  promptpay_id text not null check (regexp_replace(promptpay_id, '\D', '', 'g') ~ '^(\d{10}|\d{13})$'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  name text not null check (length(btrim(name)) between 1 and 120),
  role text not null check (role in ('owner', 'technician')),
  pin_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- A browser first signs in anonymously with Supabase Auth. A successful PIN login
-- binds that auth.uid() to a staff row for a short-lived application session.
create table public.staff_sessions (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table public.login_attempts (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  failed_count integer not null default 0 check (failed_count >= 0),
  locked_until timestamptz
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches(id),
  name text not null check (length(btrim(name)) between 1 and 160),
  name_en text,
  description text,
  duration integer not null default 60 check (duration > 0 and duration % 15 = 0),
  price numeric(10,2) not null check (price >= 0),
  commission_pct numeric(5,2) not null default 0 check (commission_pct between 0 and 100),
  counts_toward_points boolean not null default true,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- The booking website may already own public.services. Extend it in place.
alter table public.services add column if not exists branch_id uuid references public.branches(id);
alter table public.services add column if not exists commission_pct numeric(5,2) not null default 0;
alter table public.services add column if not exists counts_toward_points boolean not null default true;
update public.services set price = 0 where price is null;
alter table public.services alter column price set not null;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches(id),
  name text not null check (length(btrim(name)) between 1 and 160),
  price numeric(10,2) not null check (price >= 0),
  commission_pct numeric(5,2) not null default 0 check (commission_pct between 0 and 100),
  counts_toward_points boolean not null default true,
  stock_qty integer not null default 0 check (stock_qty >= 0),
  low_stock_alert integer not null default 3 check (low_stock_alert >= 0),
  active boolean not null default true
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles(id) on delete set null,
  branch_id uuid not null references public.branches(id),
  name text not null check (length(btrim(name)) between 1 and 160),
  phone text not null,
  line_user_id text unique,
  accumulated_baht numeric(12,2) not null default 0 check (accumulated_baht >= 0),
  points_balance integer not null default 0 check (points_balance >= 0),
  joined_at timestamptz not null default now(),
  unique (branch_id, phone)
);

create table public.member_link_codes (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  used_at timestamptz,
  issued_by uuid not null references public.staff(id),
  created_at timestamptz not null default now()
);

create table public.rewards (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches(id),
  name text not null check (length(btrim(name)) between 1 and 160),
  points_cost integer not null check (points_cost > 0),
  description text,
  active boolean not null default true,
  sort_order integer not null default 0
);

create table public.order_number_counters (
  branch_id uuid not null references public.branches(id) on delete cascade,
  business_date date not null,
  last_number integer not null check (last_number > 0),
  primary key (branch_id, business_date)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid unique references public.bookings(id) on delete set null,
  branch_id uuid not null references public.branches(id),
  order_no text not null,
  member_id uuid references public.members(id),
  opened_by_staff_id uuid not null references public.staff(id),
  status text not null default 'draft' check (status in ('draft', 'awaiting_payment', 'paid', 'void')),
  subtotal numeric(10,2) not null default 0 check (subtotal >= 0),
  discount numeric(10,2) not null default 0 check (discount >= 0 and discount <= subtotal),
  total numeric(10,2) not null default 0 check (total >= 0 and total = subtotal - discount),
  points_threshold numeric(10,2),
  points_eligible_baht numeric(10,2) not null default 0 check (points_eligible_baht >= 0),
  points_remainder_before numeric(10,2),
  points_remainder_after numeric(10,2),
  points_awarded integer not null default 0 check (points_awarded >= 0),
  void_reason text,
  void_approved_by uuid references public.staff(id),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (branch_id, order_no)
);

create table public.redemptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id),
  reward_id uuid not null references public.rewards(id),
  order_id uuid not null references public.orders(id) on delete cascade,
  points_cost_snapshot integer not null check (points_cost_snapshot > 0),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled')),
  confirmed_via text not null default 'line_liff' check (confirmed_via in ('line_liff')),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  item_type text not null check (item_type in ('service', 'product', 'redemption')),
  service_id uuid references public.services(id),
  product_id uuid references public.products(id),
  redemption_id uuid references public.redemptions(id),
  name_snapshot text not null,
  price_snapshot numeric(10,2) not null default 0 check (price_snapshot >= 0),
  commission_pct_snapshot numeric(5,2) not null default 0 check (commission_pct_snapshot between 0 and 100),
  counts_toward_points_snapshot boolean not null default true,
  technician_id uuid not null references public.staff(id),
  qty integer not null default 1 check (qty > 0),
  check (
    (item_type = 'service' and service_id is not null and product_id is null and redemption_id is null)
    or (item_type = 'product' and product_id is not null and service_id is null and redemption_id is null)
    or (item_type = 'redemption' and redemption_id is not null and service_id is null and product_id is null)
  )
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  method text not null default 'qr' check (method in ('qr', 'cash')),
  amount numeric(10,2) not null check (amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'void')),
  confirmed_by_staff_id uuid references public.staff(id),
  confirmed_at timestamptz,
  verified boolean not null default false
);

create table public.points_ledger (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id),
  change integer not null check (change <> 0),
  balance_after integer not null check (balance_after >= 0),
  source text not null check (source in ('order_paid', 'order_void', 'redemption', 'redemption_refund', 'manual_adjust')),
  ref_order_id uuid references public.orders(id),
  ref_redemption_id uuid references public.redemptions(id),
  staff_id uuid references public.staff(id),
  note text,
  created_at timestamptz not null default now()
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  qty integer not null check (qty <> 0),
  type text not null check (type in ('purchase', 'sale', 'adjust', 'void')),
  ref_order_id uuid references public.orders(id),
  staff_id uuid references public.staff(id),
  note text,
  created_at timestamptz not null default now()
);

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  order_id uuid not null references public.orders(id),
  type text not null check (type in ('discount', 'void')),
  amount numeric(10,2),
  reason text not null check (length(btrim(reason)) between 1 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid not null references public.staff(id),
  decided_by uuid references public.staff(id),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check ((type = 'discount' and amount > 0) or (type = 'void' and amount is null))
);

create unique index approval_requests_one_pending_idx
  on public.approval_requests(order_id) where status = 'pending';

create table public.commission_settings (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  mode text not null check (mode in ('per_service', 'tiered_monthly')),
  effective_month text not null check (effective_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  created_by uuid not null references public.staff(id),
  created_at timestamptz not null default now(),
  unique (branch_id, effective_month)
);

create table public.commission_tiers (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  effective_month text not null check (effective_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  min_amount numeric(12,2) not null check (min_amount >= 0),
  max_amount numeric(12,2),
  pct numeric(5,2) not null check (pct between 0 and 100),
  check (max_amount is null or max_amount > min_amount),
  exclude using gist (
    branch_id with =,
    effective_month with =,
    numrange(min_amount, max_amount, '[)') with &&
  )
);

create table public.daily_reconciliations (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  date date not null,
  system_total numeric(12,2) not null check (system_total >= 0),
  bank_total numeric(12,2) not null check (bank_total >= 0),
  diff numeric(12,2) not null,
  status text not null check (status in ('matched', 'mismatched')),
  note text,
  reconciled_by uuid not null references public.staff(id),
  created_at timestamptz not null default now(),
  unique (branch_id, date)
);

create table public.counters (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  code text not null check (code ~ '^[A-Z0-9_-]{1,20}$'),
  display_token_hash text not null,
  current_order_id uuid references public.orders(id),
  unique (branch_id, code)
);

create table public.settings (
  branch_id uuid not null references public.branches(id) on delete cascade,
  key text not null,
  value text not null,
  primary key (branch_id, key)
);

create or replace function private.apply_stock_movement()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.products
  set stock_qty = stock_qty + new.qty
  where id = new.product_id and stock_qty + new.qty >= 0;

  if not found then
    raise exception 'insufficient stock for product %', new.product_id;
  end if;
  return new;
end;
$$;

create trigger trg_apply_stock_movement
after insert on public.stock_movements
for each row execute function private.apply_stock_movement();

-- Foreign keys are not indexed automatically in PostgreSQL.
create index staff_branch_id_idx on public.staff(branch_id);
create index staff_sessions_staff_id_idx on public.staff_sessions(staff_id);
create index services_branch_id_idx on public.services(branch_id);
create index products_branch_id_idx on public.products(branch_id);
create index members_branch_phone_idx on public.members(branch_id, phone);
create index members_profile_id_idx on public.members(profile_id) where profile_id is not null;
create index member_link_codes_member_active_idx on public.member_link_codes(member_id, expires_at) where used_at is null;
create index rewards_branch_id_idx on public.rewards(branch_id);
create index orders_branch_created_idx on public.orders(branch_id, created_at desc);
create index orders_booking_id_idx on public.orders(booking_id) where booking_id is not null;
create index orders_member_paid_idx on public.orders(member_id, paid_at desc) where status = 'paid';
create index orders_opened_by_idx on public.orders(opened_by_staff_id);
create index redemptions_order_status_idx on public.redemptions(order_id, status);
create index redemptions_member_status_idx on public.redemptions(member_id, status);
create index order_items_order_id_idx on public.order_items(order_id);
create index order_items_technician_id_idx on public.order_items(technician_id);
create index order_items_service_id_idx on public.order_items(service_id) where service_id is not null;
create index order_items_product_id_idx on public.order_items(product_id) where product_id is not null;
create index points_ledger_member_created_idx on public.points_ledger(member_id, created_at desc);
create index stock_movements_product_created_idx on public.stock_movements(product_id, created_at desc);
create index stock_movements_order_idx on public.stock_movements(ref_order_id) where ref_order_id is not null;
create index approval_requests_branch_status_idx on public.approval_requests(branch_id, status, created_at desc);
create index commission_tiers_lookup_idx on public.commission_tiers(branch_id, effective_month, min_amount);
create index daily_reconciliations_branch_date_idx on public.daily_reconciliations(branch_id, date desc);
create index counters_current_order_idx on public.counters(current_order_id) where current_order_id is not null;

comment on table public.staff_sessions is 'Server-validated POS sessions bound to Supabase Auth users; never expose directly.';
comment on column public.counters.display_token_hash is 'SHA-256 hash of a high-entropy per-display bearer token; plaintext is stored only on the kiosk device.';
