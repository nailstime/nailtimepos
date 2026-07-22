-- A separate range function keeps the already deployed dashboard RPC stable
-- while allowing the new dashboard to use an arbitrary reporting period.

create index if not exists orders_branch_paid_at_idx
  on public.orders(branch_id, paid_at)
  where status = 'paid';

create index if not exists order_items_order_technician_idx
  on public.order_items(order_id, technician_id);

create or replace function public.get_owner_dashboard_range(
  p_date_from date,
  p_date_to date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner public.staff%rowtype;
  v_from_at timestamptz;
  v_to_at timestamptz;
  v_pos numeric(14,2) := 0;
  v_other_income numeric(14,2) := 0;
  v_expense numeric(14,2) := 0;
  v_bill_count integer := 0;
  v_member_bill_count integer := 0;
  v_latest_balance numeric(14,2);
  v_latest_balance_date date;
  v_daily jsonb := '[]'::jsonb;
  v_monthly jsonb := '[]'::jsonb;
  v_technicians jsonb := '[]'::jsonb;
begin
  v_owner := private.require_staff(true);

  if p_date_from is null or p_date_to is null or p_date_to < p_date_from then
    raise exception 'date range is invalid';
  end if;
  if p_date_to - p_date_from > 92 then
    raise exception 'date range cannot exceed 93 days';
  end if;

  v_from_at := p_date_from::timestamp at time zone 'Asia/Bangkok';
  v_to_at := (p_date_to + 1)::timestamp at time zone 'Asia/Bangkok';

  select
    coalesce(sum(p.amount), 0),
    count(distinct p.order_id)::integer,
    count(distinct p.order_id) filter (where o.member_id is not null)::integer
  into v_pos, v_bill_count, v_member_bill_count
  from public.payments p
  join public.orders o on o.id = p.order_id
  where o.branch_id = v_owner.branch_id
    and o.status = 'paid'
    and p.method = 'qr'
    and p.status = 'confirmed'
    and p.confirmed_at >= v_from_at
    and p.confirmed_at < v_to_at;

  select
    coalesce(sum(a.amount) filter (where a.kind = 'income'), 0),
    coalesce(sum(a.amount) filter (where a.kind = 'expense'), 0)
  into v_other_income, v_expense
  from public.bank_adjustments a
  where a.branch_id = v_owner.branch_id
    and a.voided_at is null
    and a.occurred_at >= v_from_at
    and a.occurred_at < v_to_at;

  select r.actual_balance, r.business_date
  into v_latest_balance, v_latest_balance_date
  from public.bank_reconciliations r
  where r.branch_id = v_owner.branch_id
  order by r.period_end_at desc
  limit 1;

  with days as (
    select generate_series(p_date_from, p_date_to, interval '1 day')::date as business_date
  ), paid as (
    select
      (p.confirmed_at at time zone 'Asia/Bangkok')::date as business_date,
      sum(p.amount) as pos_income,
      count(distinct p.order_id)::integer as bill_count
    from public.payments p
    join public.orders o on o.id = p.order_id
    where o.branch_id = v_owner.branch_id
      and o.status = 'paid'
      and p.method = 'qr'
      and p.status = 'confirmed'
      and p.confirmed_at >= v_from_at
      and p.confirmed_at < v_to_at
    group by 1
  ), adjustments as (
    select
      (a.occurred_at at time zone 'Asia/Bangkok')::date as business_date,
      coalesce(sum(a.amount) filter (where a.kind = 'income'), 0) as other_income,
      coalesce(sum(a.amount) filter (where a.kind = 'expense'), 0) as expense
    from public.bank_adjustments a
    where a.branch_id = v_owner.branch_id
      and a.voided_at is null
      and a.occurred_at >= v_from_at
      and a.occurred_at < v_to_at
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'date', d.business_date,
    'pos_income', coalesce(p.pos_income, 0),
    'other_income', coalesce(a.other_income, 0),
    'expense', coalesce(a.expense, 0),
    'net_cashflow', coalesce(p.pos_income, 0) + coalesce(a.other_income, 0) - coalesce(a.expense, 0),
    'bill_count', coalesce(p.bill_count, 0)
  ) order by d.business_date), '[]'::jsonb)
  into v_daily
  from days d
  left join paid p on p.business_date = d.business_date
  left join adjustments a on a.business_date = d.business_date;

  with months as (
    select generate_series(
      date_trunc('month', p_date_from)::date,
      date_trunc('month', p_date_to)::date,
      interval '1 month'
    )::date as month_start
  ), paid as (
    select
      date_trunc('month', p.confirmed_at at time zone 'Asia/Bangkok')::date as month_start,
      sum(p.amount) as pos_income,
      count(distinct p.order_id)::integer as bill_count
    from public.payments p
    join public.orders o on o.id = p.order_id
    where o.branch_id = v_owner.branch_id
      and o.status = 'paid'
      and p.method = 'qr'
      and p.status = 'confirmed'
      and p.confirmed_at >= v_from_at
      and p.confirmed_at < v_to_at
    group by 1
  ), adjustments as (
    select
      date_trunc('month', a.occurred_at at time zone 'Asia/Bangkok')::date as month_start,
      coalesce(sum(a.amount) filter (where a.kind = 'income'), 0) as other_income,
      coalesce(sum(a.amount) filter (where a.kind = 'expense'), 0) as expense
    from public.bank_adjustments a
    where a.branch_id = v_owner.branch_id
      and a.voided_at is null
      and a.occurred_at >= v_from_at
      and a.occurred_at < v_to_at
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'month', m.month_start,
    'pos_income', coalesce(p.pos_income, 0),
    'other_income', coalesce(a.other_income, 0),
    'expense', coalesce(a.expense, 0),
    'net_cashflow', coalesce(p.pos_income, 0) + coalesce(a.other_income, 0) - coalesce(a.expense, 0),
    'bill_count', coalesce(p.bill_count, 0)
  ) order by m.month_start), '[]'::jsonb)
  into v_monthly
  from months m
  left join paid p on p.month_start = m.month_start
  left join adjustments a on a.month_start = m.month_start;

  select coalesce(jsonb_agg(jsonb_build_object(
    'staff_id', t.staff_id,
    'name', t.name,
    'net_sales', t.net_sales,
    'bill_count', t.bill_count,
    'item_count', t.item_count
  ) order by t.net_sales desc, t.name), '[]'::jsonb)
  into v_technicians
  from (
    select
      s.id as staff_id,
      s.name,
      round(sum(oi.price_snapshot * oi.qty * o.total / nullif(o.subtotal, 0)), 2) as net_sales,
      count(distinct o.id)::integer as bill_count,
      sum(oi.qty)::integer as item_count
    from public.order_items oi
    join public.orders o on o.id = oi.order_id and o.status = 'paid'
    join public.staff s on s.id = oi.technician_id
    where o.branch_id = v_owner.branch_id
      and o.paid_at >= v_from_at
      and o.paid_at < v_to_at
      and o.subtotal > 0
      and oi.item_type in ('service', 'product')
    group by s.id, s.name
  ) t;

  return jsonb_build_object(
    'period', jsonb_build_object('date_from', p_date_from, 'date_to', p_date_to),
    'summary', jsonb_build_object(
      'pos_income', v_pos,
      'other_income', v_other_income,
      'expense', v_expense,
      'net_cashflow', v_pos + v_other_income - v_expense,
      'bill_count', v_bill_count,
      'member_bill_count', v_member_bill_count,
      'walk_in_bill_count', greatest(v_bill_count - v_member_bill_count, 0)
    ),
    'cash_position', jsonb_build_object(
      'last_reconciled_balance', v_latest_balance,
      'last_reconciled_business_date', v_latest_balance_date
    ),
    'daily', v_daily,
    'monthly', v_monthly,
    'technicians', v_technicians
  );
end;
$$;

revoke all on function public.get_owner_dashboard_range(date, date) from public, anon, authenticated;
grant execute on function public.get_owner_dashboard_range(date, date) to authenticated;

notify pgrst, 'reload schema';
