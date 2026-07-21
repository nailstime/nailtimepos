-- A variable-price service remains a catalog item, but its final unit price is
-- validated server-side. This prevents a browser client from bypassing the
-- allowed range and leaves an auditable reason on the order line.
alter table public.services
  add column if not exists price_mode text not null default 'fixed',
  add column if not exists min_price numeric(10,2),
  add column if not exists max_price numeric(10,2);

alter table public.services
  drop constraint if exists services_price_mode_check,
  add constraint services_price_mode_check check (price_mode in ('fixed', 'variable')),
  drop constraint if exists services_price_range_check,
  add constraint services_price_range_check check (
    (price_mode = 'fixed' and min_price is null and max_price is null)
    or (
      price_mode = 'variable'
      and min_price is not null and max_price is not null
      and min_price >= 0 and max_price >= min_price
    )
  );

alter table public.order_items
  add column if not exists custom_price_reason text,
  drop constraint if exists order_items_custom_price_reason_check,
  add constraint order_items_custom_price_reason_check check (
    custom_price_reason is null
    or length(btrim(custom_price_reason)) between 2 and 500
  );

insert into public.services (
  branch_id, name, description, duration, price, price_mode, min_price, max_price,
  commission_pct, counts_toward_points, is_active, sort_order
)
select
  b.id, 'งานพิเศษ', 'ระบุราคาและรายละเอียดก่อนเปิดบิล', 60,
  50, 'variable', 50, 400, 0, true, true, 999
from public.branches b
where b.code = 'MAIN'
  and not exists (
    select 1 from public.services s
    where s.branch_id = b.id and s.name = 'งานพิเศษ'
  );

create or replace function public.create_order(
  p_counter_code text,
  p_member uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff%rowtype;
  v_member public.members%rowtype;
  v_order public.orders%rowtype;
  v_service public.services%rowtype;
  v_product public.products%rowtype;
  v_reward public.rewards%rowtype;
  v_rec record;
  v_redemption uuid;
  v_item_price numeric(10,2);
  v_custom_reason text;
  v_date date := timezone('Asia/Bangkok', now())::date;
  v_number integer;
  v_subtotal numeric(10,2) := 0;
  v_requested_points integer := 0;
  v_count integer := 0;
  v_redemptions jsonb := '[]'::jsonb;
begin
  v_staff := private.require_staff(false);
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'order must contain at least one item';
  end if;
  if jsonb_array_length(p_items) > 100 then raise exception 'too many order items'; end if;

  perform 1 from public.counters
  where branch_id = v_staff.branch_id and code = p_counter_code
  for update;
  if not found then raise exception 'counter not found'; end if;

  if p_member is not null then
    select * into v_member from public.members
    where id = p_member and branch_id = v_staff.branch_id
    for update;
    if not found then raise exception 'member not found'; end if;
  end if;

  insert into public.order_number_counters(branch_id, business_date, last_number)
  values (v_staff.branch_id, v_date, 1)
  on conflict (branch_id, business_date) do update
    set last_number = public.order_number_counters.last_number + 1
  returning last_number into v_number;

  insert into public.orders(
    branch_id, order_no, member_id, opened_by_staff_id, status, subtotal, discount, total
  ) values (
    v_staff.branch_id, to_char(v_date, 'YYMMDD') || '-' || lpad(v_number::text, 3, '0'),
    p_member, v_staff.id, 'awaiting_payment', 0, 0, 0
  ) returning * into v_order;

  for v_rec in
    select * from jsonb_to_recordset(p_items) as x(
      item_type text, ref_id uuid, qty integer, technician_id uuid,
      unit_price numeric, custom_price_reason text
    )
  loop
    v_count := v_count + 1;
    if v_rec.qty is null or v_rec.qty <= 0 or v_rec.qty > 100 then raise exception 'invalid quantity'; end if;
    if not exists (
      select 1 from public.staff s
      where s.id = v_rec.technician_id and s.branch_id = v_staff.branch_id
        and s.active and s.role = 'technician'
    ) then raise exception 'invalid technician'; end if;

    if v_rec.item_type = 'service' then
      select * into v_service from public.services
      where id = v_rec.ref_id and is_active and branch_id = v_staff.branch_id;
      if not found then raise exception 'service not found'; end if;

      v_item_price := v_service.price;
      v_custom_reason := null;
      if v_service.price_mode = 'variable' then
        if v_rec.qty <> 1 then raise exception 'variable-price service quantity must be one'; end if;
        if v_rec.unit_price is null then raise exception 'custom price is required'; end if;
        v_item_price := round(v_rec.unit_price, 2);
        if v_item_price < v_service.min_price or v_item_price > v_service.max_price then
          raise exception 'custom price must be between % and %', v_service.min_price, v_service.max_price;
        end if;
        v_custom_reason := btrim(coalesce(v_rec.custom_price_reason, ''));
        if length(v_custom_reason) not between 2 and 500 then
          raise exception 'custom price reason is required';
        end if;
      elsif v_rec.unit_price is not null or v_rec.custom_price_reason is not null then
        raise exception 'fixed-price service cannot override price';
      end if;

      insert into public.order_items(
        order_id, item_type, service_id, name_snapshot, price_snapshot, custom_price_reason,
        commission_pct_snapshot, counts_toward_points_snapshot, technician_id, qty
      ) values (
        v_order.id, 'service', v_service.id, v_service.name, v_item_price, v_custom_reason,
        v_service.commission_pct, v_service.counts_toward_points, v_rec.technician_id, v_rec.qty
      );
      v_subtotal := v_subtotal + v_item_price * v_rec.qty;

    elsif v_rec.item_type = 'product' then
      select * into v_product from public.products
      where id = v_rec.ref_id and active and (branch_id is null or branch_id = v_staff.branch_id);
      if not found then raise exception 'product not found'; end if;
      if v_rec.unit_price is not null or v_rec.custom_price_reason is not null then
        raise exception 'product cannot override price';
      end if;
      insert into public.order_items(
        order_id, item_type, product_id, name_snapshot, price_snapshot,
        commission_pct_snapshot, counts_toward_points_snapshot, technician_id, qty
      ) values (
        v_order.id, 'product', v_product.id, v_product.name, v_product.price,
        v_product.commission_pct, v_product.counts_toward_points, v_rec.technician_id, v_rec.qty
      );
      v_subtotal := v_subtotal + v_product.price * v_rec.qty;

    elsif v_rec.item_type = 'redemption' then
      if p_member is null then raise exception 'member is required for redemption'; end if;
      if v_rec.qty <> 1 then raise exception 'redemption quantity must be one'; end if;
      if v_rec.unit_price is not null or v_rec.custom_price_reason is not null then
        raise exception 'redemption cannot override price';
      end if;
      select * into v_reward from public.rewards
      where id = v_rec.ref_id and active and (branch_id is null or branch_id = v_staff.branch_id);
      if not found then raise exception 'reward not found'; end if;
      v_requested_points := v_requested_points + v_reward.points_cost;
      insert into public.redemptions(member_id, reward_id, order_id, points_cost_snapshot)
      values (v_member.id, v_reward.id, v_order.id, v_reward.points_cost)
      returning id into v_redemption;
      insert into public.order_items(
        order_id, item_type, redemption_id, name_snapshot, price_snapshot,
        commission_pct_snapshot, counts_toward_points_snapshot, technician_id, qty
      ) values (
        v_order.id, 'redemption', v_redemption, '🎁 ' || v_reward.name, 0, 0, false, v_rec.technician_id, 1
      );
      v_redemptions := v_redemptions || jsonb_build_array(v_redemption);
    else
      raise exception 'invalid item type';
    end if;
  end loop;

  if v_count = 0 then raise exception 'order must contain at least one item'; end if;
  if p_member is not null and v_requested_points > v_member.points_balance then raise exception 'insufficient member points'; end if;
  if exists (
    select 1 from public.order_items oi
    join public.products p on p.id = oi.product_id
    where oi.order_id = v_order.id and oi.item_type = 'product'
    group by p.id, p.stock_qty
    having sum(oi.qty) > p.stock_qty
  ) then raise exception 'insufficient product stock'; end if;

  update public.orders set subtotal = v_subtotal, total = v_subtotal
  where id = v_order.id returning * into v_order;
  insert into public.payments(order_id, amount) values (v_order.id, v_order.total);
  update public.counters set current_order_id = v_order.id
  where branch_id = v_staff.branch_id and code = p_counter_code;

  return jsonb_build_object(
    'order', jsonb_build_object('id', v_order.id, 'order_no', v_order.order_no,
      'subtotal', v_order.subtotal, 'discount', v_order.discount, 'total', v_order.total, 'status', v_order.status),
    'redemption_ids', v_redemptions
  );
end;
$$;

create or replace function public.admin_receipt_detail(p_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_owner public.staff%rowtype; v_result jsonb;
begin
  v_owner := private.require_staff(true);
  select jsonb_build_object(
    'order', jsonb_build_object('id', o.id, 'order_no', o.order_no, 'status', o.status, 'subtotal', o.subtotal, 'discount', o.discount, 'total', o.total, 'created_at', o.created_at, 'paid_at', o.paid_at, 'points_awarded', o.points_awarded, 'void_reason', o.void_reason),
    'branch', jsonb_build_object('id', b.id, 'code', b.code, 'name', b.name),
    'member', case when m.id is null then null else jsonb_build_object('id', m.id, 'name', m.name, 'phone', m.phone, 'birth_date', m.birth_date) end,
    'staff', jsonb_build_object('opened_by', opener.name, 'void_approved_by', voider.name),
    'payment', case when p.id is null then null else jsonb_build_object('id', p.id, 'method', p.method, 'amount', p.amount, 'status', p.status, 'confirmed_at', p.confirmed_at, 'confirmed_by', confirmer.name, 'verified', p.verified) end,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', oi.id, 'item_type', oi.item_type, 'name', oi.name_snapshot, 'price', oi.price_snapshot, 'qty', oi.qty, 'line_total', oi.price_snapshot * oi.qty, 'custom_price_reason', oi.custom_price_reason, 'technician_id', oi.technician_id, 'technician', technician.name) order by oi.id)
      from public.order_items oi join public.staff technician on technician.id = oi.technician_id
      where oi.order_id = o.id
    ), '[]'::jsonb)
  ) into v_result
  from public.orders o join public.branches b on b.id = o.branch_id join public.staff opener on opener.id = o.opened_by_staff_id
  left join public.staff voider on voider.id = o.void_approved_by left join public.members m on m.id = o.member_id
  left join public.payments p on p.order_id = o.id left join public.staff confirmer on confirmer.id = p.confirmed_by_staff_id
  where o.id = p_order and o.branch_id = v_owner.branch_id;
  if v_result is null then raise exception 'receipt not found'; end if;
  return v_result;
end;
$$;
