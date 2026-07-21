-- Keep a physical POS counter and its customer display on the same durable
-- order across refreshes, HMR updates, browser restarts, and staff hand-offs.

create or replace function private.prevent_active_counter_overwrite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.current_order_id is not null
     and new.current_order_id is distinct from old.current_order_id
     and exists (
       select 1
       from public.orders o
       where o.id = old.current_order_id
         and o.status = 'awaiting_payment'
     ) then
    raise exception 'counter has an awaiting payment order';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_active_counter_overwrite() from public, anon, authenticated;

drop trigger if exists counters_prevent_active_overwrite on public.counters;
create trigger counters_prevent_active_overwrite
before update of current_order_id on public.counters
for each row
execute function private.prevent_active_counter_overwrite();

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

  select c.* into v_counter
  from public.counters c
  where c.branch_id = v_staff.branch_id
    and c.code = upper(btrim(p_counter_code));
  if not found then raise exception 'counter not found'; end if;

  if v_counter.current_order_id is null then
    return jsonb_build_object(
      'counter_code', v_counter.code,
      'order', null,
      'member', null,
      'pending_redeems', 0,
      'discount_request', null,
      'pending_approval', false
    );
  end if;

  select o.* into v_order
  from public.orders o
  where o.id = v_counter.current_order_id
    and o.branch_id = v_staff.branch_id;
  if not found then raise exception 'counter order not found'; end if;

  select s.name into v_opened_by
  from public.staff s
  where s.id = v_order.opened_by_staff_id;

  if v_order.member_id is not null then
    select jsonb_build_object(
      'id', m.id,
      'name', m.name,
      'phone', m.phone,
      'points_balance', m.points_balance,
      'accumulated_baht', m.accumulated_baht,
      'line_linked', m.line_user_id is not null
    ) into v_member
    from public.members m
    where m.id = v_order.member_id
      and m.branch_id = v_staff.branch_id;
  end if;

  select count(*)::integer into v_pending_redeems
  from public.redemptions r
  where r.order_id = v_order.id
    and r.status = 'pending';

  select exists (
    select 1
    from public.approval_requests ar
    where ar.order_id = v_order.id
      and ar.status = 'pending'
  ) into v_pending_approval;

  select jsonb_build_object(
    'id', ar.id,
    'type', ar.type,
    'amount', ar.amount,
    'status', ar.status
  ) into v_discount_request
  from public.approval_requests ar
  where ar.order_id = v_order.id
    and ar.type = 'discount'
  order by ar.created_at desc
  limit 1;

  return jsonb_build_object(
    'counter_code', v_counter.code,
    'order', jsonb_build_object(
      'id', v_order.id,
      'order_no', v_order.order_no,
      'status', v_order.status,
      'subtotal', v_order.subtotal,
      'discount', v_order.discount,
      'total', v_order.total,
      'member_id', v_order.member_id,
      'opened_by_staff_id', v_order.opened_by_staff_id,
      'opened_by', v_opened_by,
      'points_awarded', v_order.points_awarded,
      'created_at', v_order.created_at,
      'paid_at', v_order.paid_at
    ),
    'member', v_member,
    'pending_redeems', v_pending_redeems,
    'discount_request', v_discount_request,
    'pending_approval', v_pending_approval
  );
end;
$$;

create or replace function public.list_pending_pos_orders()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff%rowtype;
  v_result jsonb;
begin
  v_staff := private.require_staff(false);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'order_no', o.order_no,
        'total', o.total,
        'subtotal', o.subtotal,
        'discount', o.discount,
        'created_at', o.created_at,
        'opened_by', opener.name,
        'member_name', m.name,
        'item_count', coalesce(items.item_count, 0),
        'counter_code', linked_counter.code
      ) order by o.created_at desc
    ),
    '[]'::jsonb
  ) into v_result
  from public.orders o
  join public.staff opener on opener.id = o.opened_by_staff_id
  left join public.members m on m.id = o.member_id
  left join lateral (
    select count(*)::integer as item_count
    from public.order_items oi
    where oi.order_id = o.id
  ) items on true
  left join lateral (
    select c.code
    from public.counters c
    where c.current_order_id = o.id
      and c.branch_id = v_staff.branch_id
    order by c.code
    limit 1
  ) linked_counter on true
  where o.branch_id = v_staff.branch_id
    and o.status = 'awaiting_payment';

  return v_result;
end;
$$;

create or replace function public.resume_pending_pos_order(
  p_order uuid,
  p_counter_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff%rowtype;
  v_counter public.counters%rowtype;
  v_order public.orders%rowtype;
  v_other_counter text;
begin
  v_staff := private.require_staff(false);

  select o.* into v_order
  from public.orders o
  where o.id = p_order
    and o.branch_id = v_staff.branch_id
    and o.status = 'awaiting_payment'
  for update;
  if not found then raise exception 'pending order not found'; end if;

  select c.* into v_counter
  from public.counters c
  where c.branch_id = v_staff.branch_id
    and c.code = upper(btrim(p_counter_code))
  for update;
  if not found then raise exception 'counter not found'; end if;

  select c.code into v_other_counter
  from public.counters c
  where c.branch_id = v_staff.branch_id
    and c.current_order_id = v_order.id
    and c.id <> v_counter.id
  limit 1;
  if found then
    raise exception 'order is active on counter %', v_other_counter;
  end if;

  if v_counter.current_order_id is not null
     and v_counter.current_order_id <> v_order.id then
    raise exception 'counter has another order';
  end if;

  if v_counter.current_order_id is null then
    update public.counters
    set current_order_id = v_order.id
    where id = v_counter.id;
  end if;

  return public.get_pos_counter_state(v_counter.code);
end;
$$;

revoke all on function public.get_pos_counter_state(text) from public, anon;
revoke all on function public.list_pending_pos_orders() from public, anon;
revoke all on function public.resume_pending_pos_order(uuid, text) from public, anon;

grant execute on function public.get_pos_counter_state(text) to authenticated;
grant execute on function public.list_pending_pos_orders() to authenticated;
grant execute on function public.resume_pending_pos_order(uuid, text) to authenticated;

comment on function public.get_pos_counter_state(text) is
  'Returns the durable active POS state for a counter to authenticated branch staff.';
comment on function public.list_pending_pos_orders() is
  'Lists awaiting-payment orders for authenticated staff in their current branch.';
comment on function public.resume_pending_pos_order(uuid, text) is
  'Safely attaches an orphan pending order to a free counter and returns its POS state.';
