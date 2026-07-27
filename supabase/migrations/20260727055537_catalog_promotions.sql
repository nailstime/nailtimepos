-- Configurable, branch-scoped POS promotions.  A promotion is an order-level
-- discount, never an order item, so reporting, points, and commission all use
-- the actual net amount of the bill.

create table if not exists public.promotions (
  id uuid primary key default extensions.gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 160),
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  discount_value numeric(10,2) not null check (discount_value > 0),
  min_subtotal numeric(10,2) not null default 0 check (min_subtotal >= 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, name),
  constraint promotions_percent_value_check check (
    discount_type <> 'percent' or discount_value <= 100
  )
);

alter table public.promotions enable row level security;
revoke all on table public.promotions from public, anon, authenticated;

alter table public.orders
  add column if not exists promotion_id uuid references public.promotions(id) on delete set null,
  add column if not exists promotion_name_snapshot text,
  add column if not exists promotion_type_snapshot text,
  add column if not exists promotion_value_snapshot numeric(10,2);

alter table public.orders
  drop constraint if exists orders_promotion_snapshot_check,
  add constraint orders_promotion_snapshot_check check (
    (promotion_name_snapshot is null and promotion_type_snapshot is null and promotion_value_snapshot is null)
    or (
      promotion_name_snapshot is not null
      and promotion_type_snapshot in ('percent', 'fixed')
      and promotion_value_snapshot is not null and promotion_value_snapshot > 0
    )
  );

create index if not exists promotions_branch_active_idx
  on public.promotions(branch_id, active, sort_order, name);
create index if not exists orders_promotion_id_idx on public.orders(promotion_id);

create or replace function public.promotion_list()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_staff public.staff%rowtype;
begin
  v_staff := private.require_staff(false);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'discount_type', p.discount_type,
      'discount_value', p.discount_value,
      'min_subtotal', p.min_subtotal,
      'active', p.active,
      'sort_order', p.sort_order
    ) order by p.sort_order, p.name)
    from public.promotions p
    where p.branch_id = v_staff.branch_id
      and (v_staff.role = 'owner' or p.active)
  ), '[]'::jsonb);
end;
$$;

create or replace function public.promotion_create(
  p_name text,
  p_discount_type text,
  p_discount_value numeric,
  p_min_subtotal numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_owner public.staff%rowtype;
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
begin
  v_owner := private.require_staff(true);
  if length(v_name) not between 1 and 160 then raise exception 'promotion name is required'; end if;
  if p_discount_type not in ('percent', 'fixed') then raise exception 'invalid promotion type'; end if;
  if p_discount_value is null or p_discount_value <= 0
    or (p_discount_type = 'percent' and p_discount_value > 100) then
    raise exception 'invalid promotion value';
  end if;
  if coalesce(p_min_subtotal, 0) < 0 then raise exception 'invalid promotion minimum'; end if;

  insert into public.promotions(branch_id, name, discount_type, discount_value, min_subtotal)
  values (v_owner.branch_id, v_name, p_discount_type, round(p_discount_value, 2), round(coalesce(p_min_subtotal, 0), 2))
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'promotion name already exists';
end;
$$;

create or replace function public.promotion_update(
  p_promotion uuid,
  p_name text,
  p_discount_type text,
  p_discount_value numeric,
  p_min_subtotal numeric
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_owner public.staff%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_result jsonb;
begin
  v_owner := private.require_staff(true);
  if length(v_name) not between 1 and 160 then raise exception 'promotion name is required'; end if;
  if p_discount_type not in ('percent', 'fixed') then raise exception 'invalid promotion type'; end if;
  if p_discount_value is null or p_discount_value <= 0
    or (p_discount_type = 'percent' and p_discount_value > 100) then
    raise exception 'invalid promotion value';
  end if;
  if p_min_subtotal is null or p_min_subtotal < 0 then raise exception 'invalid promotion minimum'; end if;

  update public.promotions
  set name = v_name,
      discount_type = p_discount_type,
      discount_value = round(p_discount_value, 2),
      min_subtotal = round(p_min_subtotal, 2),
      updated_at = now()
  where id = p_promotion and branch_id = v_owner.branch_id
  returning jsonb_build_object(
    'id', id, 'name', name, 'discount_type', discount_type,
    'discount_value', discount_value, 'min_subtotal', min_subtotal, 'active', active
  ) into v_result;
  if v_result is null then raise exception 'promotion not found'; end if;
  return v_result;
exception when unique_violation then
  raise exception 'promotion name already exists';
end;
$$;

create or replace function public.promotion_toggle(p_promotion uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_owner public.staff%rowtype;
  v_active boolean;
begin
  v_owner := private.require_staff(true);
  update public.promotions
  set active = not active, updated_at = now()
  where id = p_promotion and branch_id = v_owner.branch_id
  returning active into v_active;
  if v_active is null then raise exception 'promotion not found'; end if;
  return v_active;
end;
$$;

-- Called only after the underlying order function has created and locked its
-- order.  Raising from here rolls the wrapper transaction back: an invalid
-- promotion never leaves an undiscounted order sitting on a counter.
create or replace function private.apply_promotion_to_order(
  p_order uuid,
  p_promotion uuid,
  p_branch uuid
)
returns public.orders
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_order public.orders%rowtype;
  v_promotion public.promotions%rowtype;
  v_discount numeric(10,2);
begin
  select * into v_order
  from public.orders
  where id = p_order and branch_id = p_branch
  for update;
  if not found or v_order.status <> 'awaiting_payment' then raise exception 'order cannot receive a promotion'; end if;

  select * into v_promotion
  from public.promotions
  where id = p_promotion and branch_id = p_branch and active
  for share;
  if not found then raise exception 'promotion is unavailable'; end if;
  if v_order.subtotal < v_promotion.min_subtotal then
    raise exception 'promotion requires a minimum subtotal of %', v_promotion.min_subtotal;
  end if;

  v_discount := case v_promotion.discount_type
    when 'percent' then round(v_order.subtotal * v_promotion.discount_value / 100, 2)
    else v_promotion.discount_value
  end;
  v_discount := least(v_discount, v_order.subtotal);

  update public.orders
  set discount = v_discount,
      total = subtotal - v_discount,
      promotion_id = v_promotion.id,
      promotion_name_snapshot = v_promotion.name,
      promotion_type_snapshot = v_promotion.discount_type,
      promotion_value_snapshot = v_promotion.discount_value
  where id = v_order.id
  returning * into v_order;
  update public.payments set amount = v_order.total where order_id = v_order.id;
  return v_order;
end;
$$;

create or replace function public.create_order_with_promotion(
  p_counter_code text,
  p_member uuid,
  p_items jsonb,
  p_promotion uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_staff public.staff%rowtype;
  v_result jsonb;
  v_order public.orders%rowtype;
begin
  v_staff := private.require_staff(false);
  v_result := public.create_order(p_counter_code, p_member, p_items);
  v_order := private.apply_promotion_to_order((v_result -> 'order' ->> 'id')::uuid, p_promotion, v_staff.branch_id);
  return jsonb_set(v_result, '{order}', jsonb_build_object(
    'id', v_order.id, 'order_no', v_order.order_no, 'subtotal', v_order.subtotal,
    'discount', v_order.discount, 'total', v_order.total, 'status', v_order.status,
    'promotion_name', v_order.promotion_name_snapshot
  ));
end;
$$;

create or replace function public.create_order_from_booking_with_promotion(
  p_counter_code text,
  p_member uuid,
  p_items jsonb,
  p_booking uuid,
  p_promotion uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_staff public.staff%rowtype;
  v_result jsonb;
  v_order public.orders%rowtype;
begin
  v_staff := private.require_staff(false);
  v_result := public.create_order_from_booking(p_counter_code, p_member, p_items, p_booking);
  v_order := private.apply_promotion_to_order((v_result -> 'order' ->> 'id')::uuid, p_promotion, v_staff.branch_id);
  return jsonb_set(v_result, '{order}', jsonb_build_object(
    'id', v_order.id, 'order_no', v_order.order_no, 'subtotal', v_order.subtotal,
    'discount', v_order.discount, 'total', v_order.total, 'status', v_order.status,
    'promotion_name', v_order.promotion_name_snapshot
  ));
end;
$$;

create or replace function public.request_approval(
  p_order uuid,
  p_type text,
  p_amount numeric,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_staff public.staff%rowtype; v_order public.orders%rowtype; v_id uuid;
begin
  v_staff := private.require_staff(false);
  select * into v_order from public.orders
  where id = p_order and branch_id = v_staff.branch_id
    and (opened_by_staff_id = v_staff.id or v_staff.role = 'owner')
  for update;
  if not found then raise exception 'order not found'; end if;
  if p_type = 'discount' then
    if v_order.status <> 'awaiting_payment' then raise exception 'discount is only allowed before payment'; end if;
    if v_order.discount > 0 then raise exception 'a promotion or discount is already applied'; end if;
    if p_amount is null or p_amount <= 0 or p_amount > v_order.subtotal then raise exception 'invalid discount amount'; end if;
  elsif p_type = 'void' then
    if v_order.status not in ('awaiting_payment', 'paid') then raise exception 'order cannot be voided'; end if;
    p_amount := null;
  else
    raise exception 'invalid approval type';
  end if;
  if length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then raise exception 'reason is required'; end if;
  if exists (select 1 from public.approval_requests where order_id = p_order and status = 'pending') then
    raise exception 'another approval request is already pending';
  end if;
  insert into public.approval_requests(branch_id, order_id, type, amount, reason, requested_by)
  values (v_staff.branch_id, p_order, p_type, p_amount, btrim(p_reason), v_staff.id)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.get_pos_thermal_receipt(p_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_staff public.staff%rowtype; v_result jsonb;
begin
  v_staff := private.require_staff(false);
  select jsonb_build_object(
    'order', jsonb_build_object('id', o.id, 'order_no', o.order_no, 'subtotal', o.subtotal,
      'discount', o.discount, 'total', o.total, 'promotion_name', o.promotion_name_snapshot,
      'created_at', o.created_at, 'paid_at', o.paid_at),
    'branch', jsonb_build_object('code', b.code, 'name', b.name),
    'member', case when m.id is null then null else jsonb_build_object('name', m.name, 'phone', m.phone) end,
    'payment', jsonb_build_object('method', p.method, 'amount', p.amount, 'confirmed_at', p.confirmed_at),
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', oi.name_snapshot, 'qty', oi.qty,
      'line_total', oi.price_snapshot * oi.qty) order by oi.id) from public.order_items oi where oi.order_id = o.id), '[]'::jsonb)
  ) into v_result
  from public.orders o join public.branches b on b.id = o.branch_id
  left join public.members m on m.id = o.member_id
  join public.payments p on p.order_id = o.id and p.status = 'confirmed'
  where o.id = p_order and o.branch_id = v_staff.branch_id and o.status = 'paid'
    and (o.opened_by_staff_id = v_staff.id or v_staff.role = 'owner');
  if v_result is null then raise exception 'paid receipt not found'; end if;
  return v_result;
end;
$$;

-- Keep the existing grants narrow.  No table policy is needed for promotions.
revoke all on function private.apply_promotion_to_order(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.promotion_list() from public, anon;
revoke all on function public.promotion_create(text, text, numeric, numeric) from public, anon;
revoke all on function public.promotion_update(uuid, text, text, numeric, numeric) from public, anon;
revoke all on function public.promotion_toggle(uuid) from public, anon;
revoke all on function public.create_order_with_promotion(text, uuid, jsonb, uuid) from public, anon;
revoke all on function public.create_order_from_booking_with_promotion(text, uuid, jsonb, uuid, uuid) from public, anon;
grant execute on function public.promotion_list() to authenticated;
grant execute on function public.promotion_create(text, text, numeric, numeric) to authenticated;
grant execute on function public.promotion_update(uuid, text, text, numeric, numeric) to authenticated;
grant execute on function public.promotion_toggle(uuid) to authenticated;
grant execute on function public.create_order_with_promotion(text, uuid, jsonb, uuid) to authenticated;
grant execute on function public.create_order_from_booking_with_promotion(text, uuid, jsonb, uuid, uuid) to authenticated;
