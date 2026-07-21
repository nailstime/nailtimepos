-- Nail Time & Spa POS + CRM security/API integrated with the booking website.
-- Migration 002: authenticated API, business transactions, RLS and explicit grants.

-- ---------- Session helpers (private, not exposed by PostgREST) ----------

create or replace function private.current_staff_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ss.staff_id
  from public.staff_sessions ss
  join public.staff s on s.id = ss.staff_id and s.active
  where ss.auth_user_id = (select auth.uid())
    and ss.expires_at > now()
  limit 1
$$;

create or replace function private.current_branch_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.branch_id
  from public.staff_sessions ss
  join public.staff s on s.id = ss.staff_id and s.active
  where ss.auth_user_id = (select auth.uid())
    and ss.expires_at > now()
  limit 1
$$;

create or replace function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select s.role = 'owner'
    from public.staff_sessions ss
    join public.staff s on s.id = ss.staff_id and s.active
    where ss.auth_user_id = (select auth.uid())
      and ss.expires_at > now()
    limit 1
  ), false)
$$;

create or replace function private.require_staff(p_owner_only boolean default false)
returns public.staff
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_staff public.staff%rowtype;
begin
  select s.* into v_staff
  from public.staff_sessions ss
  join public.staff s on s.id = ss.staff_id and s.active
  join public.branches b on b.id = s.branch_id and b.active
  where ss.auth_user_id = (select auth.uid())
    and ss.expires_at > now();

  if not found then
    raise exception 'staff session is missing or expired';
  end if;
  if p_owner_only and v_staff.role <> 'owner' then
    raise exception 'owner only';
  end if;
  return v_staff;
end;
$$;

-- ---------- PIN authentication bound to Supabase Auth ----------

create or replace function public.staff_login(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_attempt public.login_attempts%rowtype;
  v_staff public.staff%rowtype;
  v_staff_id uuid;
  v_matches integer;
  v_has_attempt boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'auth_required');
  end if;

  select * into v_attempt
  from public.login_attempts
  where auth_user_id = v_uid
  for update;
  v_has_attempt := found;

  if v_has_attempt and v_attempt.locked_until is not null and v_attempt.locked_until > now() then
    return jsonb_build_object(
      'ok', false,
      'error', 'locked',
      'retry_after_seconds', greatest(1, extract(epoch from (v_attempt.locked_until - now()))::integer)
    );
  end if;

  if p_pin ~ '^\d{6}$' then
    select count(*) into v_matches
    from public.staff s
    where s.active and s.pin_hash = crypt(p_pin, s.pin_hash);
    if v_matches = 1 then
      select s.id into v_staff_id
      from public.staff s
      where s.active and s.pin_hash = crypt(p_pin, s.pin_hash);
    end if;
  else
    v_matches := 0;
  end if;

  if v_matches <> 1 then
    if not v_has_attempt or v_attempt.window_started_at < now() - interval '15 minutes' then
      insert into public.login_attempts(auth_user_id, window_started_at, failed_count, locked_until)
      values (v_uid, now(), 1, null)
      on conflict (auth_user_id) do update
      set window_started_at = excluded.window_started_at,
          failed_count = 1,
          locked_until = null;
    else
      update public.login_attempts
      set failed_count = failed_count + 1,
          locked_until = case when failed_count + 1 >= 5 then now() + interval '15 minutes' else null end
      where auth_user_id = v_uid;
    end if;
    return jsonb_build_object('ok', false, 'error', 'invalid_pin');
  end if;

  select * into v_staff from public.staff where id = v_staff_id;
  delete from public.login_attempts where auth_user_id = v_uid;
  insert into public.staff_sessions(auth_user_id, staff_id, expires_at)
  values (v_uid, v_staff.id, now() + interval '12 hours')
  on conflict (auth_user_id) do update
  set staff_id = excluded.staff_id,
      expires_at = excluded.expires_at,
      last_seen_at = now();

  return jsonb_build_object(
    'ok', true,
    'staff', jsonb_build_object(
      'id', v_staff.id,
      'name', v_staff.name,
      'role', v_staff.role,
      'branch_id', v_staff.branch_id
    )
  );
end;
$$;

create or replace function public.staff_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_staff public.staff%rowtype;
begin
  select s.* into v_staff
  from public.staff_sessions ss
  join public.staff s on s.id = ss.staff_id and s.active
  where ss.auth_user_id = (select auth.uid()) and ss.expires_at > now();
  if not found then return null; end if;
  return jsonb_build_object(
    'id', v_staff.id, 'name', v_staff.name,
    'role', v_staff.role, 'branch_id', v_staff.branch_id
  );
end;
$$;

create or replace function public.staff_logout()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.staff_sessions where auth_user_id = (select auth.uid())
$$;

-- ---------- POS transactions ----------

create or replace function public.find_member(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_staff public.staff%rowtype; v_member public.members%rowtype; v_phone text;
begin
  v_staff := private.require_staff(false);
  v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  select * into v_member from public.members
  where branch_id = v_staff.branch_id and phone = v_phone;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', v_member.id, 'name', v_member.name, 'phone', v_member.phone,
    'line_linked', v_member.line_user_id is not null,
    'points_balance', v_member.points_balance,
    'accumulated_baht', v_member.accumulated_baht
  );
end;
$$;

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
  if jsonb_array_length(p_items) > 100 then
    raise exception 'too many order items';
  end if;

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
    branch_id, order_no, member_id, opened_by_staff_id,
    status, subtotal, discount, total
  ) values (
    v_staff.branch_id,
    to_char(v_date, 'YYMMDD') || '-' || lpad(v_number::text, 3, '0'),
    p_member, v_staff.id, 'awaiting_payment', 0, 0, 0
  ) returning * into v_order;

  for v_rec in
    select * from jsonb_to_recordset(p_items)
      as x(item_type text, ref_id uuid, qty integer, technician_id uuid)
  loop
    v_count := v_count + 1;
    if v_rec.qty is null or v_rec.qty <= 0 or v_rec.qty > 100 then
      raise exception 'invalid quantity';
    end if;
    if not exists (
      select 1 from public.staff s
      where s.id = v_rec.technician_id
        and s.branch_id = v_staff.branch_id
        and s.active and s.role = 'technician'
    ) then
      raise exception 'invalid technician';
    end if;

    if v_rec.item_type = 'service' then
      select * into v_service from public.services
      where id = v_rec.ref_id and is_active
        and (branch_id is null or branch_id = v_staff.branch_id);
      if not found then raise exception 'service not found'; end if;
      insert into public.order_items(
        order_id, item_type, service_id, name_snapshot, price_snapshot,
        commission_pct_snapshot, counts_toward_points_snapshot, technician_id, qty
      ) values (
        v_order.id, 'service', v_service.id, v_service.name, v_service.price,
        v_service.commission_pct, v_service.counts_toward_points, v_rec.technician_id, v_rec.qty
      );
      v_subtotal := v_subtotal + v_service.price * v_rec.qty;

    elsif v_rec.item_type = 'product' then
      select * into v_product from public.products
      where id = v_rec.ref_id and active
        and (branch_id is null or branch_id = v_staff.branch_id);
      if not found then raise exception 'product not found'; end if;
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
      select * into v_reward from public.rewards
      where id = v_rec.ref_id and active
        and (branch_id is null or branch_id = v_staff.branch_id);
      if not found then raise exception 'reward not found'; end if;
      v_requested_points := v_requested_points + v_reward.points_cost;
      insert into public.redemptions(
        member_id, reward_id, order_id, points_cost_snapshot
      ) values (
        p_member, v_reward.id, v_order.id, v_reward.points_cost
      ) returning id into v_redemption;
      insert into public.order_items(
        order_id, item_type, redemption_id, name_snapshot, price_snapshot,
        commission_pct_snapshot, counts_toward_points_snapshot, technician_id, qty
      ) values (
        v_order.id, 'redemption', v_redemption, '🎁 ' || v_reward.name, 0,
        0, false, v_rec.technician_id, 1
      );
      v_redemptions := v_redemptions || jsonb_build_array(v_redemption);
    else
      raise exception 'invalid item type';
    end if;
  end loop;

  if v_count = 0 then raise exception 'order must contain at least one item'; end if;
  if p_member is not null and v_requested_points > v_member.points_balance then
    raise exception 'insufficient member points';
  end if;
  if exists (
    select 1
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    where oi.order_id = v_order.id and oi.item_type = 'product'
    group by p.id, p.stock_qty
    having sum(oi.qty) > p.stock_qty
  ) then
    raise exception 'insufficient product stock';
  end if;

  update public.orders
  set subtotal = v_subtotal, total = v_subtotal
  where id = v_order.id
  returning * into v_order;

  insert into public.payments(order_id, amount) values (v_order.id, v_order.total);
  update public.counters set current_order_id = v_order.id
  where branch_id = v_staff.branch_id and code = p_counter_code;

  return jsonb_build_object(
    'order', jsonb_build_object(
      'id', v_order.id, 'order_no', v_order.order_no,
      'subtotal', v_order.subtotal, 'discount', v_order.discount,
      'total', v_order.total, 'status', v_order.status
    ),
    'redemption_ids', v_redemptions
  );
end;
$$;

create or replace function public.clear_counter(p_counter_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_staff public.staff%rowtype;
begin
  v_staff := private.require_staff(false);
  update public.counters set current_order_id = null
  where branch_id = v_staff.branch_id and code = p_counter_code;
  if not found then raise exception 'counter not found'; end if;
end;
$$;

create or replace function public.process_paid_order(p_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff%rowtype;
  v_order public.orders%rowtype;
  v_member public.members%rowtype;
  v_threshold numeric(10,2);
  v_gross_eligible numeric(10,2) := 0;
  v_eligible numeric(10,2) := 0;
  v_earned integer := 0;
  v_remainder numeric(10,2) := 0;
  v_balance integer := 0;
begin
  v_staff := private.require_staff(false);
  select * into v_order from public.orders
  where id = p_order and branch_id = v_staff.branch_id
    and (opened_by_staff_id = v_staff.id or v_staff.role = 'owner')
  for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.status <> 'awaiting_payment' then raise exception 'order is not awaiting payment'; end if;
  if exists (select 1 from public.approval_requests where order_id = p_order and status = 'pending') then
    raise exception 'an approval request is still pending';
  end if;
  if exists (select 1 from public.redemptions where order_id = p_order and status = 'pending') then
    raise exception 'customer must confirm all redemptions first';
  end if;

  if v_order.member_id is not null then
    select * into v_member from public.members where id = v_order.member_id for update;
  end if;

  perform p.id
  from public.products p
  join (
    select product_id, sum(qty)::integer as qty
    from public.order_items
    where order_id = p_order and item_type = 'product'
    group by product_id
  ) x on x.product_id = p.id
  order by p.id
  for update of p;

  if exists (
    select 1
    from public.products p
    join (
      select product_id, sum(qty)::integer as qty
      from public.order_items
      where order_id = p_order and item_type = 'product'
      group by product_id
    ) x on x.product_id = p.id
    where p.stock_qty < x.qty
  ) then
    raise exception 'insufficient product stock';
  end if;

  insert into public.stock_movements(product_id, qty, type, ref_order_id, staff_id)
  select product_id, -sum(qty)::integer, 'sale', p_order, v_staff.id
  from public.order_items
  where order_id = p_order and item_type = 'product'
  group by product_id;

  if v_order.member_id is not null then
    select value::numeric into v_threshold from public.settings
    where branch_id = v_staff.branch_id and key = 'point_threshold_baht';
    if v_threshold is null or v_threshold <= 0 then raise exception 'invalid points threshold'; end if;

    select coalesce(sum(price_snapshot * qty), 0) into v_gross_eligible
    from public.order_items
    where order_id = p_order
      and item_type in ('service', 'product')
      and counts_toward_points_snapshot;

    if v_order.subtotal > 0 then
      v_eligible := round(v_gross_eligible * v_order.total / v_order.subtotal, 2);
    end if;
    v_earned := floor((v_member.accumulated_baht + v_eligible) / v_threshold)::integer;
    v_remainder := v_member.accumulated_baht + v_eligible - (v_earned * v_threshold);

    update public.members
    set accumulated_baht = v_remainder,
        points_balance = points_balance + v_earned
    where id = v_member.id
    returning points_balance into v_balance;

    if v_earned > 0 then
      insert into public.points_ledger(
        member_id, change, balance_after, source, ref_order_id, staff_id
      ) values (
        v_member.id, v_earned, v_balance, 'order_paid', p_order, v_staff.id
      );
    end if;

    update public.orders
    set points_threshold = v_threshold,
        points_eligible_baht = v_eligible,
        points_remainder_before = v_member.accumulated_baht,
        points_remainder_after = v_remainder,
        points_awarded = v_earned
    where id = p_order;
  end if;

  update public.orders set status = 'paid', paid_at = now() where id = p_order;
  update public.payments
  set amount = v_order.total, status = 'confirmed',
      confirmed_by_staff_id = v_staff.id, confirmed_at = now()
  where order_id = p_order;

  return jsonb_build_object(
    'paid_amount', v_order.total,
    'eligible', v_eligible,
    'points_earned', v_earned,
    'points_balance', v_balance,
    'baht_to_next_point', case when v_order.member_id is null then null else v_threshold - v_remainder end
  );
end;
$$;

-- ---------- Approvals and exact void reversal ----------

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

  insert into public.approval_requests(
    branch_id, order_id, type, amount, reason, requested_by
  ) values (
    v_staff.branch_id, p_order, p_type, p_amount, btrim(p_reason), v_staff.id
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.decide_approval(p_request uuid, p_approve boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner public.staff%rowtype;
  v_request public.approval_requests%rowtype;
  v_order public.orders%rowtype;
  v_redemption record;
  v_balance integer;
  v_current_threshold numeric;
begin
  v_owner := private.require_staff(true);
  select * into v_request from public.approval_requests
  where id = p_request and branch_id = v_owner.branch_id
  for update;
  if not found then raise exception 'approval request not found'; end if;
  if v_request.status <> 'pending' then raise exception 'approval request is already decided'; end if;

  if not p_approve then
    update public.approval_requests
    set status = 'rejected', decided_by = v_owner.id, decided_at = now()
    where id = v_request.id;
    return jsonb_build_object('ok', true, 'result', 'rejected');
  end if;

  select * into v_order from public.orders where id = v_request.order_id for update;
  if v_request.type = 'discount' then
    if v_order.status <> 'awaiting_payment' then raise exception 'order is no longer awaiting payment'; end if;
    if v_request.amount <= 0 or v_request.amount > v_order.subtotal then raise exception 'invalid discount amount'; end if;
    update public.orders
    set discount = v_request.amount, total = subtotal - v_request.amount
    where id = v_order.id;
    update public.payments set amount = v_order.subtotal - v_request.amount where order_id = v_order.id;
  else
    if v_order.status not in ('awaiting_payment', 'paid') then raise exception 'order cannot be voided'; end if;
    if v_order.member_id is not null then
      perform 1 from public.members where id = v_order.member_id for update;
    end if;
    if v_order.status = 'paid' and v_order.member_id is not null and exists (
      select 1 from public.orders o2
      where o2.member_id = v_order.member_id and o2.status = 'paid'
        and o2.paid_at > v_order.paid_at
    ) then
      raise exception 'void the member''s newer paid orders first';
    end if;

    for v_redemption in
      select r.id, r.member_id, r.points_cost_snapshot
      from public.redemptions r
      where r.order_id = v_order.id and r.status = 'confirmed'
      order by r.id
      for update
    loop
      update public.members
      set points_balance = points_balance + v_redemption.points_cost_snapshot
      where id = v_redemption.member_id
      returning points_balance into v_balance;
      insert into public.points_ledger(
        member_id, change, balance_after, source, ref_order_id,
        ref_redemption_id, staff_id, note
      ) values (
        v_redemption.member_id, v_redemption.points_cost_snapshot, v_balance,
        'redemption_refund', v_order.id, v_redemption.id, v_owner.id, 'order void'
      );
    end loop;
    update public.redemptions
    set status = 'cancelled'
    where order_id = v_order.id and status in ('pending', 'confirmed');

    if v_order.status = 'paid' then
      insert into public.stock_movements(product_id, qty, type, ref_order_id, staff_id, note)
      select product_id, sum(qty)::integer, 'void', v_order.id, v_owner.id, 'order void'
      from public.order_items
      where order_id = v_order.id and item_type = 'product'
      group by product_id;

      if v_order.member_id is not null then
        select points_balance into v_balance from public.members where id = v_order.member_id;
        if v_balance < v_order.points_awarded then
          raise exception 'member has already spent points earned by this order';
        end if;
        select value::numeric into v_current_threshold from public.settings
        where branch_id = v_order.branch_id and key = 'point_threshold_baht';
        if v_current_threshold is null or v_current_threshold < 1 then
          raise exception 'current points threshold is invalid';
        end if;
        update public.members
        set points_balance = points_balance - v_order.points_awarded,
            accumulated_baht = case
              when v_order.points_remainder_before is null then accumulated_baht
              when v_order.points_threshold is null or v_order.points_threshold <= 0 then v_order.points_remainder_before
              else least(
                round(v_order.points_remainder_before * v_current_threshold / v_order.points_threshold, 2),
                v_current_threshold - 0.01
              )
            end
        where id = v_order.member_id
        returning points_balance into v_balance;
        if v_order.points_awarded > 0 then
          insert into public.points_ledger(
            member_id, change, balance_after, source, ref_order_id, staff_id, note
          ) values (
            v_order.member_id, -v_order.points_awarded, v_balance,
            'order_void', v_order.id, v_owner.id, 'reverse paid order points'
          );
        end if;
      end if;
    end if;

    update public.payments set status = 'void' where order_id = v_order.id;
    update public.orders
    set status = 'void', void_reason = v_request.reason, void_approved_by = v_owner.id
    where id = v_order.id;
    update public.counters set current_order_id = null where current_order_id = v_order.id;
  end if;

  update public.approval_requests
  set status = 'approved', decided_by = v_owner.id, decided_at = now()
  where id = v_request.id;
  return jsonb_build_object('ok', true, 'result', case when v_request.type = 'discount' then 'discount_applied' else 'voided' end);
end;
$$;

-- ---------- Owner mutations ----------

create or replace function public.create_staff(p_name text, p_role text, p_pin text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_owner public.staff%rowtype; v_id uuid;
begin
  v_owner := private.require_staff(true);
  if length(btrim(coalesce(p_name, ''))) not between 1 and 120 then raise exception 'name is required'; end if;
  if p_role not in ('owner', 'technician') then raise exception 'invalid role'; end if;
  if p_pin !~ '^\d{6}$' then raise exception 'PIN must contain exactly 6 digits'; end if;
  if exists (
    select 1 from public.staff s
    where s.active and s.pin_hash = crypt(p_pin, s.pin_hash)
  ) then raise exception 'PIN is already in use'; end if;
  insert into public.staff(branch_id, name, role, pin_hash)
  values (v_owner.branch_id, btrim(p_name), p_role, crypt(p_pin, gen_salt('bf')))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.reset_staff_pin(p_staff uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_owner public.staff%rowtype;
begin
  v_owner := private.require_staff(true);
  if p_pin !~ '^\d{6}$' then raise exception 'PIN must contain exactly 6 digits'; end if;
  if exists (
    select 1 from public.staff s
    where s.id <> p_staff and s.active and s.pin_hash = crypt(p_pin, s.pin_hash)
  ) then raise exception 'PIN is already in use'; end if;
  update public.staff set pin_hash = crypt(p_pin, gen_salt('bf'))
  where id = p_staff and branch_id = v_owner.branch_id;
  if not found then raise exception 'staff not found'; end if;
  delete from public.staff_sessions where staff_id = p_staff;
end;
$$;

create or replace function public.toggle_staff_active(p_staff uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_owner public.staff%rowtype; v_target public.staff%rowtype; v_active boolean;
begin
  v_owner := private.require_staff(true);
  if p_staff = v_owner.id then raise exception 'you cannot disable your own account'; end if;
  select * into v_target from public.staff where id = p_staff and branch_id = v_owner.branch_id for update;
  if not found then raise exception 'staff not found'; end if;
  if v_target.role = 'owner' and v_target.active and (
    select count(*) from public.staff where branch_id = v_owner.branch_id and role = 'owner' and active
  ) <= 1 then raise exception 'at least one active owner is required'; end if;
  update public.staff set active = not active where id = p_staff returning active into v_active;
  if not v_active then delete from public.staff_sessions where staff_id = p_staff; end if;
  return v_active;
end;
$$;

create or replace function public.adjust_member_points(p_member uuid, p_change integer, p_note text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_owner public.staff%rowtype; v_balance integer;
begin
  v_owner := private.require_staff(true);
  if p_change = 0 or abs(p_change) > 10000 then raise exception 'invalid points adjustment'; end if;
  update public.members
  set points_balance = points_balance + p_change
  where id = p_member and branch_id = v_owner.branch_id
    and points_balance + p_change >= 0
  returning points_balance into v_balance;
  if not found then raise exception 'member not found or resulting balance is negative'; end if;
  insert into public.points_ledger(member_id, change, balance_after, source, staff_id, note)
  values (p_member, p_change, v_balance, 'manual_adjust', v_owner.id, left(coalesce(p_note, 'manual'), 500));
  return v_balance;
end;
$$;

create or replace function public.issue_member_link_code(p_member uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_staff public.staff%rowtype; v_bytes bytea; v_code text;
begin
  v_staff := private.require_staff(false);
  if not exists (
    select 1 from public.members
    where id = p_member and branch_id = v_staff.branch_id and line_user_id is null
  ) then raise exception 'member not found or LINE is already linked'; end if;
  update public.member_link_codes set used_at = now()
  where member_id = p_member and used_at is null;
  v_bytes := gen_random_bytes(3);
  v_code := lpad(((get_byte(v_bytes, 0) * 65536 + get_byte(v_bytes, 1) * 256 + get_byte(v_bytes, 2)) % 1000000)::text, 6, '0');
  insert into public.member_link_codes(member_id, code_hash, expires_at, issued_by)
  values (p_member, crypt(v_code, gen_salt('bf')), now() + interval '10 minutes', v_staff.id);
  return v_code;
end;
$$;

create or replace function public.catalog_create(
  p_kind text, p_name text, p_price numeric,
  p_commission_pct numeric, p_counts_toward_points boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_owner public.staff%rowtype; v_id uuid;
begin
  v_owner := private.require_staff(true);
  if p_kind not in ('service', 'product') then raise exception 'invalid catalog kind'; end if;
  if length(btrim(coalesce(p_name, ''))) not between 1 and 160 then raise exception 'name is required'; end if;
  if p_price < 0 or p_commission_pct not between 0 and 100 then raise exception 'invalid price or commission'; end if;
  if p_kind = 'service' then
    insert into public.services(branch_id, name, price, commission_pct, counts_toward_points)
    values (v_owner.branch_id, btrim(p_name), p_price, p_commission_pct, p_counts_toward_points)
    returning id into v_id;
  else
    insert into public.products(branch_id, name, price, commission_pct, counts_toward_points)
    values (v_owner.branch_id, btrim(p_name), p_price, p_commission_pct, p_counts_toward_points)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.catalog_toggle(p_kind text, p_item uuid, p_field text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_owner public.staff%rowtype; v_value boolean;
begin
  v_owner := private.require_staff(true);
  if p_kind = 'service' and p_field = 'active' then
    update public.services set is_active = not is_active where id = p_item and branch_id = v_owner.branch_id returning is_active into v_value;
  elsif p_kind = 'service' and p_field = 'counts_toward_points' then
    update public.services set counts_toward_points = not counts_toward_points where id = p_item and branch_id = v_owner.branch_id returning counts_toward_points into v_value;
  elsif p_kind = 'product' and p_field = 'active' then
    update public.products set active = not active where id = p_item and branch_id = v_owner.branch_id returning active into v_value;
  elsif p_kind = 'product' and p_field = 'counts_toward_points' then
    update public.products set counts_toward_points = not counts_toward_points where id = p_item and branch_id = v_owner.branch_id returning counts_toward_points into v_value;
  else
    raise exception 'invalid catalog update';
  end if;
  if not found then raise exception 'catalog item not found'; end if;
  return v_value;
end;
$$;

create or replace function public.receive_stock(p_product uuid, p_qty integer, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_owner public.staff%rowtype; v_stock integer;
begin
  v_owner := private.require_staff(true);
  if p_qty <= 0 or p_qty > 100000 then raise exception 'invalid stock quantity'; end if;
  if not exists (select 1 from public.products where id = p_product and branch_id = v_owner.branch_id) then
    raise exception 'product not found';
  end if;
  insert into public.stock_movements(product_id, qty, type, staff_id, note)
  values (p_product, p_qty, 'purchase', v_owner.id, left(p_note, 500));
  select stock_qty into v_stock from public.products where id = p_product;
  return v_stock;
end;
$$;

create or replace function public.create_reward(p_name text, p_points_cost integer, p_description text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_owner public.staff%rowtype; v_id uuid;
begin
  v_owner := private.require_staff(true);
  if length(btrim(coalesce(p_name, ''))) not between 1 and 160 or p_points_cost <= 0 then
    raise exception 'invalid reward';
  end if;
  insert into public.rewards(branch_id, name, points_cost, description)
  values (v_owner.branch_id, btrim(p_name), p_points_cost, nullif(btrim(p_description), ''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.toggle_reward(p_reward uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_owner public.staff%rowtype; v_active boolean;
begin
  v_owner := private.require_staff(true);
  update public.rewards set active = not active
  where id = p_reward and branch_id = v_owner.branch_id
  returning active into v_active;
  if not found then raise exception 'reward not found'; end if;
  return v_active;
end;
$$;

create or replace function public.set_points_threshold(p_threshold numeric)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare v_owner public.staff%rowtype; v_old numeric;
begin
  v_owner := private.require_staff(true);
  if p_threshold < 1 or p_threshold > 1000000 then raise exception 'invalid threshold'; end if;
  select value::numeric into v_old from public.settings
  where branch_id = v_owner.branch_id and key = 'point_threshold_baht'
  for update;
  if v_old is null or v_old <= 0 then raise exception 'current threshold is invalid'; end if;
  update public.members
  set accumulated_baht = least(round(accumulated_baht * p_threshold / v_old, 2), p_threshold - 0.01)
  where branch_id = v_owner.branch_id;
  update public.settings set value = p_threshold::text
  where branch_id = v_owner.branch_id and key = 'point_threshold_baht';
  return p_threshold;
end;
$$;

create or replace function public.save_reconciliation(p_date date, p_bank_total numeric, p_note text default null)
returns public.daily_reconciliations
language plpgsql
security definer
set search_path = ''
as $$
declare v_owner public.staff%rowtype; v_system numeric; v_row public.daily_reconciliations%rowtype;
begin
  v_owner := private.require_staff(true);
  if p_bank_total < 0 then raise exception 'bank total cannot be negative'; end if;
  select coalesce(sum(total), 0) into v_system
  from public.orders
  where branch_id = v_owner.branch_id and status = 'paid'
    and timezone('Asia/Bangkok', paid_at)::date = p_date;
  insert into public.daily_reconciliations(
    branch_id, date, system_total, bank_total, diff, status, note, reconciled_by
  ) values (
    v_owner.branch_id, p_date, v_system, p_bank_total, p_bank_total - v_system,
    case when p_bank_total = v_system then 'matched' else 'mismatched' end,
    nullif(left(btrim(p_note), 500), ''), v_owner.id
  ) on conflict (branch_id, date) do update
  set system_total = excluded.system_total,
      bank_total = excluded.bank_total,
      diff = excluded.diff,
      status = excluded.status,
      note = excluded.note,
      reconciled_by = excluded.reconciled_by,
      created_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.save_commission_configuration(
  p_effective_month text,
  p_mode text,
  p_tiers jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner public.staff%rowtype;
  v_expected numeric := 0;
  v_has_unbounded boolean := false;
  v_rec record;
  v_next_month text := to_char(
    date_trunc('month', timezone('Asia/Bangkok', now())) + interval '1 month', 'YYYY-MM'
  );
begin
  v_owner := private.require_staff(true);
  if p_effective_month <> v_next_month then raise exception 'commission settings can only target next month'; end if;
  if p_mode not in ('per_service', 'tiered_monthly') then raise exception 'invalid commission mode'; end if;
  insert into public.commission_settings(branch_id, mode, effective_month, created_by)
  values (v_owner.branch_id, p_mode, p_effective_month, v_owner.id)
  on conflict (branch_id, effective_month) do update
  set mode = excluded.mode, created_by = excluded.created_by, created_at = now();
  delete from public.commission_tiers
  where branch_id = v_owner.branch_id and effective_month = p_effective_month;

  if p_mode = 'tiered_monthly' then
    if jsonb_typeof(p_tiers) <> 'array' or jsonb_array_length(p_tiers) = 0 then raise exception 'tiers are required'; end if;
    insert into public.commission_tiers(branch_id, effective_month, min_amount, max_amount, pct)
    select v_owner.branch_id, p_effective_month, x.min_amount, x.max_amount, x.pct
    from jsonb_to_recordset(p_tiers) as x(min_amount numeric, max_amount numeric, pct numeric);

    for v_rec in
      select min_amount, max_amount from public.commission_tiers
      where branch_id = v_owner.branch_id and effective_month = p_effective_month
      order by min_amount
    loop
      if v_rec.min_amount <> v_expected then raise exception 'commission tiers must be continuous from zero'; end if;
      if v_rec.max_amount is null then
        v_has_unbounded := true;
      else
        v_expected := v_rec.max_amount;
      end if;
    end loop;
    if not v_has_unbounded then raise exception 'the last commission tier must have no maximum'; end if;
  end if;
end;
$$;

create or replace function public.commission_report(p_month text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_owner public.staff%rowtype; v_mode text; v_result jsonb;
begin
  v_owner := private.require_staff(true);
  if p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid month'; end if;
  select mode into v_mode from public.commission_settings
  where branch_id = v_owner.branch_id and effective_month = p_month;
  v_mode := coalesce(v_mode, 'per_service');

  if v_mode = 'per_service' then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.technician), '[]'::jsonb) into v_result
    from (
      select s.name as technician,
        sum(oi.price_snapshot * oi.qty) as total_sales,
        round(sum(oi.price_snapshot * oi.qty * oi.commission_pct_snapshot / 100), 2) as commission,
        null::numeric as tier_pct
      from public.order_items oi
      join public.orders o on o.id = oi.order_id and o.status = 'paid'
      join public.staff s on s.id = oi.technician_id
      where o.branch_id = v_owner.branch_id
        and to_char(timezone('Asia/Bangkok', o.paid_at), 'YYYY-MM') = p_month
        and oi.item_type in ('service', 'product')
      group by s.id, s.name
    ) t;
  else
    select coalesce(jsonb_agg(to_jsonb(t) order by t.technician), '[]'::jsonb) into v_result
    from (
      with sales as (
        select s.id, s.name, sum(oi.price_snapshot * oi.qty) as total_sales
        from public.order_items oi
        join public.orders o on o.id = oi.order_id and o.status = 'paid'
        join public.staff s on s.id = oi.technician_id
        where o.branch_id = v_owner.branch_id
          and to_char(timezone('Asia/Bangkok', o.paid_at), 'YYYY-MM') = p_month
          and oi.item_type in ('service', 'product')
        group by s.id, s.name
      )
      select sa.name as technician, sa.total_sales, ct.pct as tier_pct,
        round(sa.total_sales * ct.pct / 100, 2) as commission
      from sales sa
      left join public.commission_tiers ct
        on ct.branch_id = v_owner.branch_id
       and ct.effective_month = p_month
       and sa.total_sales >= ct.min_amount
       and (ct.max_amount is null or sa.total_sales < ct.max_amount)
    ) t;
  end if;
  return jsonb_build_object('mode', v_mode, 'month', p_month, 'rows', v_result);
end;
$$;

-- ---------- Customer display (bearer token, sanitized response) ----------

create or replace function public.get_customer_display(p_counter_code text, p_display_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_counter public.counters%rowtype; v_branch public.branches%rowtype; v_order public.orders%rowtype;
begin
  select c.* into v_counter
  from public.counters c
  join public.branches b on b.id = c.branch_id and b.active
  where c.code = p_counter_code
    and c.display_token_hash = encode(digest(coalesce(p_display_token, ''), 'sha256'), 'hex')
  limit 1;
  if not found then return null; end if;
  select * into v_branch from public.branches where id = v_counter.branch_id;
  if v_counter.current_order_id is null then
    return jsonb_build_object(
      'branch', jsonb_build_object('name', v_branch.name),
      'order', null
    );
  end if;
  select * into v_order from public.orders where id = v_counter.current_order_id;
  if not found then return jsonb_build_object('branch', jsonb_build_object('name', v_branch.name), 'order', null); end if;
  return jsonb_build_object(
    'branch', jsonb_build_object('name', v_branch.name, 'promptpay_id', v_branch.promptpay_id),
    'order', jsonb_build_object(
      'id', v_order.id, 'order_no', v_order.order_no, 'status', v_order.status,
      'subtotal', v_order.subtotal, 'discount', v_order.discount, 'total', v_order.total
    ),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', oi.id, 'name', oi.name_snapshot, 'qty', oi.qty, 'price', oi.price_snapshot
      ) order by oi.id), '[]'::jsonb)
      from public.order_items oi where oi.order_id = v_order.id
    ),
    'member', (
      select jsonb_build_object(
        'name', m.name, 'points_balance', m.points_balance, 'accumulated_baht', m.accumulated_baht
      ) from public.members m where m.id = v_order.member_id
    )
  );
end;
$$;

-- ---------- Service-role-only LINE member API ----------

create or replace function public.line_get_member(p_line_user_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_member public.members%rowtype; v_threshold numeric;
begin
  select * into v_member from public.members where line_user_id = p_line_user_id;
  if not found then return null; end if;
  select value::numeric into v_threshold from public.settings
  where branch_id = v_member.branch_id and key = 'point_threshold_baht';
  return jsonb_build_object(
    'member', jsonb_build_object(
      'id', v_member.id, 'name', v_member.name,
      'points_balance', v_member.points_balance,
      'accumulated_baht', v_member.accumulated_baht
    ),
    'threshold', v_threshold,
    'pending', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'reward', rw.name, 'points_cost', r.points_cost_snapshot
      ) order by r.created_at), '[]'::jsonb)
      from public.redemptions r
      join public.rewards rw on rw.id = r.reward_id
      join public.orders o on o.id = r.order_id and o.status = 'awaiting_payment'
      where r.member_id = v_member.id and r.status = 'pending'
    ),
    'history', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'change', x.change, 'source', x.source, 'at', x.created_at
      ) order by x.created_at desc), '[]'::jsonb)
      from (
        select change, source, created_at from public.points_ledger
        where member_id = v_member.id order by created_at desc limit 20
      ) x
    )
  );
end;
$$;

create or replace function public.line_register_member(
  p_branch_code text,
  p_name text,
  p_phone text,
  p_line_user_id text,
  p_claim_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch public.branches%rowtype;
  v_member public.members%rowtype;
  v_code public.member_link_codes%rowtype;
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if length(btrim(coalesce(p_name, ''))) not between 1 and 160 then return jsonb_build_object('ok', false, 'error', 'invalid_name'); end if;
  if v_phone !~ '^\d{9,15}$' then return jsonb_build_object('ok', false, 'error', 'invalid_phone'); end if;
  if length(coalesce(p_line_user_id, '')) < 10 then return jsonb_build_object('ok', false, 'error', 'invalid_line_identity'); end if;
  select * into v_branch from public.branches where code = p_branch_code and active;
  if not found then return jsonb_build_object('ok', false, 'error', 'branch_not_found'); end if;
  if exists (select 1 from public.members where line_user_id = p_line_user_id) then
    return jsonb_build_object('ok', true, 'linked', true);
  end if;

  select * into v_member from public.members
  where branch_id = v_branch.id and phone = v_phone
  for update;
  if found then
    if v_member.line_user_id is not null then
      return jsonb_build_object('ok', false, 'error', 'phone_already_linked');
    end if;
    select * into v_code from public.member_link_codes
    where member_id = v_member.id and used_at is null and expires_at > now()
    order by created_at desc limit 1 for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'claim_code_required'); end if;
    if p_claim_code is null or v_code.code_hash <> crypt(p_claim_code, v_code.code_hash) then
      update public.member_link_codes
      set attempts = least(attempts + 1, 5),
          used_at = case when attempts + 1 >= 5 then now() else used_at end
      where id = v_code.id;
      return jsonb_build_object('ok', false, 'error', 'invalid_claim_code');
    end if;
    update public.member_link_codes set used_at = now() where id = v_code.id;
    update public.members set line_user_id = p_line_user_id where id = v_member.id;
    return jsonb_build_object('ok', true, 'linked', true);
  end if;

  insert into public.members(branch_id, name, phone, line_user_id)
  values (v_branch.id, btrim(p_name), v_phone, p_line_user_id);
  return jsonb_build_object('ok', true, 'linked', false);
end;
$$;

create or replace function public.line_confirm_redemption(p_redemption uuid, p_line_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_redemption public.redemptions%rowtype;
  v_member public.members%rowtype;
  v_order_id uuid;
  v_member_id uuid;
  v_order_status text;
  v_balance integer;
begin
  select order_id, member_id into v_order_id, v_member_id
  from public.redemptions where id = p_redemption;
  if not found then raise exception 'redemption not found'; end if;
  select status into v_order_status from public.orders where id = v_order_id for update;
  if v_order_status <> 'awaiting_payment' then raise exception 'order is no longer awaiting payment'; end if;
  select * into v_member from public.members where id = v_member_id for update;
  select * into v_redemption from public.redemptions where id = p_redemption for update;
  if v_redemption.status <> 'pending' then raise exception 'redemption is not pending'; end if;
  if v_member.line_user_id is distinct from p_line_user_id then raise exception 'not authorized'; end if;
  if v_member.points_balance < v_redemption.points_cost_snapshot then raise exception 'insufficient points'; end if;
  update public.members
  set points_balance = points_balance - v_redemption.points_cost_snapshot
  where id = v_member.id returning points_balance into v_balance;
  update public.redemptions set status = 'confirmed', confirmed_at = now() where id = v_redemption.id;
  insert into public.points_ledger(member_id, change, balance_after, source, ref_order_id, ref_redemption_id)
  values (
    v_member.id, -v_redemption.points_cost_snapshot, v_balance,
    'redemption', v_redemption.order_id, v_redemption.id
  );
  return jsonb_build_object('ok', true, 'points_balance', v_balance);
end;
$$;

-- ---------- RLS ----------

alter table public.branches enable row level security;
alter table public.staff enable row level security;
alter table public.staff_sessions enable row level security;
alter table public.login_attempts enable row level security;
alter table public.services enable row level security;
alter table public.products enable row level security;
alter table public.members enable row level security;
alter table public.member_link_codes enable row level security;
alter table public.rewards enable row level security;
alter table public.order_number_counters enable row level security;
alter table public.orders enable row level security;
alter table public.redemptions enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.points_ledger enable row level security;
alter table public.stock_movements enable row level security;
alter table public.approval_requests enable row level security;
alter table public.commission_settings enable row level security;
alter table public.commission_tiers enable row level security;
alter table public.daily_reconciliations enable row level security;
alter table public.counters enable row level security;
alter table public.settings enable row level security;

create policy branches_staff_read on public.branches for select to authenticated
  using (id = (select private.current_branch_id()));
create policy staff_branch_read on public.staff for select to authenticated
  using (branch_id = (select private.current_branch_id()));
create policy services_branch_read on public.services for select to authenticated
  using (branch_id is null or branch_id = (select private.current_branch_id()));
create policy products_branch_read on public.products for select to authenticated
  using (branch_id is null or branch_id = (select private.current_branch_id()));
create policy members_branch_read on public.members for select to authenticated
  using (branch_id = (select private.current_branch_id()));
create policy rewards_branch_read on public.rewards for select to authenticated
  using (branch_id is null or branch_id = (select private.current_branch_id()));
create policy orders_staff_read on public.orders for select to authenticated
  using (
    branch_id = (select private.current_branch_id())
    and ((select private.is_owner()) or opened_by_staff_id = (select private.current_staff_id()))
  );
create policy redemptions_visible_order_read on public.redemptions for select to authenticated
  using (exists (
    select 1 from public.orders o where o.id = order_id
      and o.branch_id = (select private.current_branch_id())
      and ((select private.is_owner()) or o.opened_by_staff_id = (select private.current_staff_id()))
  ));
create policy order_items_visible_order_read on public.order_items for select to authenticated
  using (exists (
    select 1 from public.orders o where o.id = order_id
      and o.branch_id = (select private.current_branch_id())
      and ((select private.is_owner()) or o.opened_by_staff_id = (select private.current_staff_id()))
  ));
create policy payments_visible_order_read on public.payments for select to authenticated
  using (exists (
    select 1 from public.orders o where o.id = order_id
      and o.branch_id = (select private.current_branch_id())
      and ((select private.is_owner()) or o.opened_by_staff_id = (select private.current_staff_id()))
  ));
create policy approval_requests_staff_read on public.approval_requests for select to authenticated
  using (
    branch_id = (select private.current_branch_id())
    and ((select private.is_owner()) or requested_by = (select private.current_staff_id()))
  );
create policy counters_staff_read on public.counters for select to authenticated
  using (branch_id = (select private.current_branch_id()));
create policy settings_staff_read on public.settings for select to authenticated
  using (branch_id = (select private.current_branch_id()));
create policy points_ledger_owner_read on public.points_ledger for select to authenticated
  using ((select private.is_owner()) and exists (
    select 1 from public.members m where m.id = member_id and m.branch_id = (select private.current_branch_id())
  ));
create policy stock_movements_owner_read on public.stock_movements for select to authenticated
  using ((select private.is_owner()) and exists (
    select 1 from public.products p where p.id = product_id
      and (p.branch_id is null or p.branch_id = (select private.current_branch_id()))
  ));
create policy commission_settings_owner_read on public.commission_settings for select to authenticated
  using ((select private.is_owner()) and branch_id = (select private.current_branch_id()));
create policy commission_tiers_owner_read on public.commission_tiers for select to authenticated
  using ((select private.is_owner()) and branch_id = (select private.current_branch_id()));
create policy reconciliations_owner_read on public.daily_reconciliations for select to authenticated
  using ((select private.is_owner()) and branch_id = (select private.current_branch_id()));

-- ---------- Explicit Data API privileges (required by new Supabase projects) ----------

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated;

revoke all on all tables in schema public from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

grant usage on schema private to authenticated;
grant execute on function private.current_staff_id() to authenticated;
grant execute on function private.current_branch_id() to authenticated;
grant execute on function private.is_owner() to authenticated;

grant select on public.branches to authenticated;
grant select (id, branch_id, name, role, active, created_at) on public.staff to authenticated;
grant select on public.services, public.products, public.members, public.rewards,
  public.orders, public.redemptions, public.order_items, public.payments,
  public.points_ledger, public.stock_movements, public.approval_requests,
  public.commission_settings, public.commission_tiers,
  public.daily_reconciliations, public.settings to authenticated;
grant select (id, branch_id, code, current_order_id) on public.counters to authenticated;

-- Preserve the booking website API after the explicit privilege reset above.
grant select on public.services, public.time_slots, public.seo_settings,
  public.slot_availability to anon, authenticated;
grant insert on public.bookings, public.leads to anon;
grant select, insert, update on public.bookings to authenticated;
grant insert on public.leads to authenticated;
grant select, insert, update, delete on public.services, public.time_slots,
  public.seo_settings, public.leads to authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, phone, line_uid, line_display_name, line_picture_url)
  on public.profiles to authenticated;

grant execute on function public.staff_login(text) to authenticated;
grant execute on function public.staff_me() to authenticated;
grant execute on function public.staff_logout() to authenticated;
grant execute on function public.find_member(text) to authenticated;
grant execute on function public.create_order(text, uuid, jsonb) to authenticated;
grant execute on function public.clear_counter(text) to authenticated;
grant execute on function public.process_paid_order(uuid) to authenticated;
grant execute on function public.request_approval(uuid, text, numeric, text) to authenticated;
grant execute on function public.decide_approval(uuid, boolean) to authenticated;
grant execute on function public.create_staff(text, text, text) to authenticated;
grant execute on function public.reset_staff_pin(uuid, text) to authenticated;
grant execute on function public.toggle_staff_active(uuid) to authenticated;
grant execute on function public.adjust_member_points(uuid, integer, text) to authenticated;
grant execute on function public.issue_member_link_code(uuid) to authenticated;
grant execute on function public.catalog_create(text, text, numeric, numeric, boolean) to authenticated;
grant execute on function public.catalog_toggle(text, uuid, text) to authenticated;
grant execute on function public.receive_stock(uuid, integer, text) to authenticated;
grant execute on function public.create_reward(text, integer, text) to authenticated;
grant execute on function public.toggle_reward(uuid) to authenticated;
grant execute on function public.set_points_threshold(numeric) to authenticated;
grant execute on function public.save_reconciliation(date, numeric, text) to authenticated;
grant execute on function public.save_commission_configuration(text, text, jsonb) to authenticated;
grant execute on function public.commission_report(text) to authenticated;

grant execute on function public.get_customer_display(text, text) to anon, authenticated;
grant execute on function public.get_guest_booking(text, text, text) to anon, authenticated;
grant execute on function public.generate_time_slots(integer, time without time zone, time without time zone, integer)
  to authenticated;

grant all on all tables in schema public to service_role;
grant execute on function public.line_get_member(text) to service_role;
grant execute on function public.line_register_member(text, text, text, text, text) to service_role;
grant execute on function public.line_confirm_redemption(uuid, text) to service_role;

-- Realtime sends only rows the authenticated staff session may select.
alter publication supabase_realtime add table
  public.orders, public.order_items, public.counters,
  public.approval_requests, public.redemptions, public.payments;
