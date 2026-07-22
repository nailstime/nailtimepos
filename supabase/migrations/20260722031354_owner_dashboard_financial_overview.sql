-- Owner dashboard metrics are calculated in Postgres so the browser only receives
-- the aggregate for the currently authenticated owner's branch.

create index if not exists payments_qr_confirmed_time_idx
  on public.payments(confirmed_at, order_id)
  where method = 'qr' and status = 'confirmed';

create index if not exists bank_adjustments_branch_occurred_idx
  on public.bank_adjustments(branch_id, occurred_at)
  where voided_at is null;

create or replace function public.get_owner_dashboard_overview(
  p_days integer default 14
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner public.staff%rowtype;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_from date;
  v_month_start date;
  v_today_pos numeric(14,2) := 0;
  v_today_bills integer := 0;
  v_today_member_bills integer := 0;
  v_month_pos numeric(14,2) := 0;
  v_month_other_income numeric(14,2) := 0;
  v_month_expense numeric(14,2) := 0;
  v_month_bills integer := 0;
  v_latest_balance numeric(14,2);
  v_latest_balance_date date;
  v_latest_closed_at timestamptz;
  v_daily jsonb := '[]'::jsonb;
  v_monthly jsonb := '[]'::jsonb;
begin
  v_owner := private.require_staff(true);

  if p_days is null or p_days not between 7 and 31 then
    raise exception 'p_days must be between 7 and 31';
  end if;

  v_from := v_today - (p_days - 1);
  v_month_start := date_trunc('month', v_today)::date;

  select
    coalesce(sum(p.amount), 0),
    count(distinct p.order_id)::integer,
    count(distinct p.order_id) filter (where o.member_id is not null)::integer
  into v_today_pos, v_today_bills, v_today_member_bills
  from public.payments p
  join public.orders o on o.id = p.order_id
  where o.branch_id = v_owner.branch_id
    and o.status = 'paid'
    and p.method = 'qr'
    and p.status = 'confirmed'
    and (p.confirmed_at at time zone 'Asia/Bangkok')::date = v_today;

  select
    coalesce(sum(p.amount), 0),
    count(distinct p.order_id)::integer
  into v_month_pos, v_month_bills
  from public.payments p
  join public.orders o on o.id = p.order_id
  where o.branch_id = v_owner.branch_id
    and o.status = 'paid'
    and p.method = 'qr'
    and p.status = 'confirmed'
    and (p.confirmed_at at time zone 'Asia/Bangkok')::date >= v_month_start
    and (p.confirmed_at at time zone 'Asia/Bangkok')::date <= v_today;

  select
    coalesce(sum(a.amount) filter (where a.kind = 'income'), 0),
    coalesce(sum(a.amount) filter (where a.kind = 'expense'), 0)
  into v_month_other_income, v_month_expense
  from public.bank_adjustments a
  where a.branch_id = v_owner.branch_id
    and a.voided_at is null
    and (a.occurred_at at time zone 'Asia/Bangkok')::date >= v_month_start
    and (a.occurred_at at time zone 'Asia/Bangkok')::date <= v_today;

  select r.actual_balance, r.business_date, r.closed_at
  into v_latest_balance, v_latest_balance_date, v_latest_closed_at
  from public.bank_reconciliations r
  where r.branch_id = v_owner.branch_id
  order by r.period_end_at desc
  limit 1;

  with days as (
    select generate_series(v_from, v_today, interval '1 day')::date as business_date
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
      and (p.confirmed_at at time zone 'Asia/Bangkok')::date between v_from and v_today
    group by 1
  ), adjustments as (
    select
      (a.occurred_at at time zone 'Asia/Bangkok')::date as business_date,
      coalesce(sum(a.amount) filter (where a.kind = 'income'), 0) as other_income,
      coalesce(sum(a.amount) filter (where a.kind = 'expense'), 0) as expense
    from public.bank_adjustments a
    where a.branch_id = v_owner.branch_id
      and a.voided_at is null
      and (a.occurred_at at time zone 'Asia/Bangkok')::date between v_from and v_today
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
    select (v_month_start - (s.offset_month * interval '1 month'))::date as month_start
    from generate_series(0, 5) as s(offset_month)
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
      and (p.confirmed_at at time zone 'Asia/Bangkok')::date >= v_month_start - interval '5 months'
      and (p.confirmed_at at time zone 'Asia/Bangkok')::date <= v_today
    group by 1
  ), adjustments as (
    select
      date_trunc('month', a.occurred_at at time zone 'Asia/Bangkok')::date as month_start,
      coalesce(sum(a.amount) filter (where a.kind = 'income'), 0) as other_income,
      coalesce(sum(a.amount) filter (where a.kind = 'expense'), 0) as expense
    from public.bank_adjustments a
    where a.branch_id = v_owner.branch_id
      and a.voided_at is null
      and (a.occurred_at at time zone 'Asia/Bangkok')::date >= v_month_start - interval '5 months'
      and (a.occurred_at at time zone 'Asia/Bangkok')::date <= v_today
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

  return jsonb_build_object(
    'today', jsonb_build_object(
      'date', v_today,
      'pos_income', v_today_pos,
      'bill_count', v_today_bills,
      'member_bill_count', v_today_member_bills,
      'walk_in_bill_count', greatest(v_today_bills - v_today_member_bills, 0)
    ),
    'current_month', jsonb_build_object(
      'month_start', v_month_start,
      'pos_income', v_month_pos,
      'other_income', v_month_other_income,
      'expense', v_month_expense,
      'net_cashflow', v_month_pos + v_month_other_income - v_month_expense,
      'bill_count', v_month_bills
    ),
    'cash_position', jsonb_build_object(
      'last_reconciled_balance', v_latest_balance,
      'last_reconciled_business_date', v_latest_balance_date,
      'last_reconciled_at', v_latest_closed_at
    ),
    'daily', v_daily,
    'monthly', v_monthly
  );
end;
$$;

revoke all on function public.get_owner_dashboard_overview(integer) from public, anon, authenticated;
grant execute on function public.get_owner_dashboard_overview(integer) to authenticated;

notify pgrst, 'reload schema';
