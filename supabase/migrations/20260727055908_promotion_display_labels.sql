-- Surface the immutable promotion snapshot wherever an order summary is shown.

create or replace function public.get_pos_counter_state(p_counter_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff%rowtype;
  v_counter public.counters%rowtype;
  v_order public.orders%rowtype;
  v_member jsonb;
  v_opened_by text;
  v_discount_request jsonb;
  v_pending_redeems integer := 0;
  v_pending_approval boolean := false;
begin
  v_staff := private.require_staff(false);
  select c.* into v_counter from public.counters c
  where c.branch_id = v_staff.branch_id and c.code = upper(btrim(p_counter_code));
  if not found then raise exception 'counter not found'; end if;
  if v_counter.current_order_id is null then
    return jsonb_build_object('counter_code', v_counter.code, 'order', null, 'member', null,
      'pending_redeems', 0, 'discount_request', null, 'pending_approval', false);
  end if;
  select o.* into v_order from public.orders o
  where o.id = v_counter.current_order_id and o.branch_id = v_staff.branch_id;
  if not found then raise exception 'counter order not found'; end if;
  select s.name into v_opened_by from public.staff s where s.id = v_order.opened_by_staff_id;
  if v_order.member_id is not null then
    select jsonb_build_object('id', m.id, 'name', m.name, 'phone', m.phone,
      'points_balance', m.points_balance, 'accumulated_baht', m.accumulated_baht,
      'line_linked', m.line_user_id is not null)
    into v_member from public.members m
    where m.id = v_order.member_id and m.branch_id = v_staff.branch_id;
  end if;
  select count(*)::integer into v_pending_redeems from public.redemptions r
  where r.order_id = v_order.id and r.status = 'pending';
  select exists (select 1 from public.approval_requests ar where ar.order_id = v_order.id and ar.status = 'pending') into v_pending_approval;
  select jsonb_build_object('id', ar.id, 'type', ar.type, 'amount', ar.amount, 'status', ar.status)
  into v_discount_request from public.approval_requests ar
  where ar.order_id = v_order.id and ar.type = 'discount'
  order by ar.created_at desc limit 1;
  return jsonb_build_object(
    'counter_code', v_counter.code,
    'order', jsonb_build_object(
      'id', v_order.id, 'order_no', v_order.order_no, 'status', v_order.status,
      'subtotal', v_order.subtotal, 'discount', v_order.discount, 'total', v_order.total,
      'promotion_name', v_order.promotion_name_snapshot, 'member_id', v_order.member_id,
      'opened_by_staff_id', v_order.opened_by_staff_id, 'opened_by', v_opened_by,
      'points_awarded', v_order.points_awarded, 'created_at', v_order.created_at, 'paid_at', v_order.paid_at
    ), 'member', v_member, 'pending_redeems', v_pending_redeems,
    'discount_request', v_discount_request, 'pending_approval', v_pending_approval
  );
end;
$$;

create or replace function public.get_customer_display(p_counter_code text, p_display_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_counter public.counters%rowtype;
  v_branch public.branches%rowtype;
  v_order public.orders%rowtype;
  v_media_type text := 'artwork';
  v_media_path text;
  v_campaign jsonb;
  v_token_hash text := encode(digest(coalesce(p_display_token, ''), 'sha256'), 'hex');
begin
  select c.* into v_counter from public.counters c
  join public.branches b on b.id = c.branch_id and b.active
  where c.code = upper(btrim(coalesce(p_counter_code, '')))
    and (c.display_token_hash = v_token_hash or exists (
      select 1 from public.customer_display_devices d
      where d.counter_id = c.id and d.device_token_hash = v_token_hash and d.revoked_at is null
    )) limit 1;
  if not found then return null; end if;
  select * into v_branch from public.branches where id = v_counter.branch_id;
  select coalesce(max(s.value) filter (where s.key = 'customer_display_media_type'), 'artwork'),
    nullif(max(s.value) filter (where s.key = 'customer_display_media_path'), '')
  into v_media_type, v_media_path from public.settings s
  where s.branch_id = v_counter.branch_id and s.key in ('customer_display_media_type', 'customer_display_media_path');
  if v_media_type not in ('artwork', 'image', 'video') or v_media_path is null then
    v_media_type := 'artwork'; v_media_path := null;
  end if;
  v_campaign := jsonb_build_object('type', v_media_type, 'path', v_media_path);
  if v_counter.current_order_id is null then
    return jsonb_build_object('branch', jsonb_build_object('name', v_branch.name), 'order', null, 'campaign', v_campaign);
  end if;
  select * into v_order from public.orders where id = v_counter.current_order_id;
  if not found then
    return jsonb_build_object('branch', jsonb_build_object('name', v_branch.name), 'order', null, 'campaign', v_campaign);
  end if;
  return jsonb_build_object(
    'branch', jsonb_build_object('name', v_branch.name, 'promptpay_id', v_branch.promptpay_id),
    'order', jsonb_build_object('id', v_order.id, 'order_no', v_order.order_no, 'status', v_order.status,
      'subtotal', v_order.subtotal, 'discount', v_order.discount, 'total', v_order.total,
      'promotion_name', v_order.promotion_name_snapshot),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', oi.id, 'name', oi.name_snapshot,
      'qty', oi.qty, 'price', oi.price_snapshot) order by oi.id), '[]'::jsonb)
      from public.order_items oi where oi.order_id = v_order.id),
    'member', (select jsonb_build_object('name', m.name, 'points_balance', m.points_balance,
      'accumulated_baht', m.accumulated_baht) from public.members m where m.id = v_order.member_id),
    'campaign', v_campaign
  );
end;
$$;
