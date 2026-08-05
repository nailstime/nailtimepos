-- Yearly P&L: aggregates all 12 months plus per-month summary for the breakdown table.
create or replace function public.get_pl_report_year(p_year text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_owner          public.staff%rowtype;
  v_year_start     timestamptz;
  v_year_end       timestamptz;
  v_adj_income     jsonb := '{}';
  v_adj_expense    jsonb := '{}';
  v_service_income numeric := 0;
  v_product_income numeric := 0;
  v_months         jsonb  := '[]';
  v_mo             int;
  v_mo_start       timestamptz;
  v_mo_end         timestamptz;
  v_mo_svc         numeric;
  v_mo_prd         numeric;
  v_mo_inc         jsonb;
  v_mo_exp         jsonb;
  v_mo_total_inc   numeric;
  v_mo_total_exp   numeric;
begin
  v_owner := private.require_staff(true);

  if p_year !~ '^\d{4}$' then
    raise exception 'invalid year format — expected YYYY';
  end if;

  v_year_start := timezone('Asia/Bangkok', (p_year || '-01-01')::date::timestamp);
  v_year_end   := timezone('Asia/Bangkok', ((p_year::int + 1)::text || '-01-01')::date::timestamp);

  -- Annual POS income split
  select
    coalesce(sum(case when oi.item_type = 'service' then round(oi.price_snapshot * oi.qty * o.total / nullif(o.subtotal, 0), 2) else 0 end), 0),
    coalesce(sum(case when oi.item_type = 'product' then round(oi.price_snapshot * oi.qty * o.total / nullif(o.subtotal, 0), 2) else 0 end), 0)
  into v_service_income, v_product_income
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.branch_id = v_owner.branch_id
    and o.status    = 'paid'
    and oi.item_type in ('service', 'product')
    and o.paid_at >= v_year_start
    and o.paid_at <  v_year_end;

  -- Annual income adjustments by category
  select coalesce(jsonb_object_agg(category, total), '{}')
  into v_adj_income
  from (
    select category, sum(amount) as total
    from public.bank_adjustments
    where branch_id = v_owner.branch_id
      and kind = 'income' and voided_at is null
      and occurred_at >= v_year_start and occurred_at < v_year_end
    group by category
  ) s;

  -- Annual expense adjustments by category
  select coalesce(jsonb_object_agg(category, total), '{}')
  into v_adj_expense
  from (
    select category, sum(amount) as total
    from public.bank_adjustments
    where branch_id = v_owner.branch_id
      and kind = 'expense' and voided_at is null
      and occurred_at >= v_year_start and occurred_at < v_year_end
    group by category
  ) s;

  -- Per-month summary (12 months)
  for v_mo in 1..12 loop
    v_mo_start := timezone('Asia/Bangkok', make_date(p_year::int, v_mo, 1)::timestamp);
    v_mo_end   := timezone('Asia/Bangkok', (make_date(p_year::int, v_mo, 1) + interval '1 month')::timestamp);

    select
      coalesce(sum(case when oi.item_type = 'service' then round(oi.price_snapshot * oi.qty * o.total / nullif(o.subtotal, 0), 2) else 0 end), 0),
      coalesce(sum(case when oi.item_type = 'product' then round(oi.price_snapshot * oi.qty * o.total / nullif(o.subtotal, 0), 2) else 0 end), 0)
    into v_mo_svc, v_mo_prd
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.branch_id = v_owner.branch_id
      and o.status    = 'paid'
      and oi.item_type in ('service', 'product')
      and o.paid_at >= v_mo_start and o.paid_at < v_mo_end;

    select coalesce(jsonb_object_agg(category, total), '{}')
    into v_mo_inc
    from (
      select category, sum(amount) as total
      from public.bank_adjustments
      where branch_id = v_owner.branch_id
        and kind = 'income' and voided_at is null
        and occurred_at >= v_mo_start and occurred_at < v_mo_end
      group by category
    ) s;

    select coalesce(jsonb_object_agg(category, total), '{}')
    into v_mo_exp
    from (
      select category, sum(amount) as total
      from public.bank_adjustments
      where branch_id = v_owner.branch_id
        and kind = 'expense' and voided_at is null
        and occurred_at >= v_mo_start and occurred_at < v_mo_end
      group by category
    ) s;

    v_mo_total_inc :=
      v_mo_svc + v_mo_prd +
      coalesce((v_mo_inc->>'other_income')::numeric,    0) +
      coalesce((v_mo_inc->>'rent_received')::numeric,   0) +
      coalesce((v_mo_inc->>'interest_income')::numeric, 0);

    v_mo_total_exp :=
      coalesce((v_mo_exp->>'water')::numeric,              0) +
      coalesce((v_mo_exp->>'electricity')::numeric,        0) +
      coalesce((v_mo_exp->>'internet')::numeric,           0) +
      coalesce((v_mo_exp->>'phone')::numeric,              0) +
      coalesce((v_mo_exp->>'product_cost')::numeric,       0) +
      coalesce((v_mo_exp->>'service_cost')::numeric,       0) +
      coalesce((v_mo_exp->>'salary')::numeric,             0) +
      coalesce((v_mo_exp->>'commission_expense')::numeric, 0) +
      coalesce((v_mo_exp->>'regular_expense')::numeric,    0) +
      coalesce((v_mo_exp->>'other_expense')::numeric,      0) +
      coalesce((v_mo_exp->>'interest_fee')::numeric,       0) +
      coalesce((v_mo_exp->>'refund')::numeric,             0);

    v_months := v_months || jsonb_build_object(
      'month',         to_char(make_date(p_year::int, v_mo, 1), 'YYYY-MM'),
      'service_sales', v_mo_svc,
      'product_sales', v_mo_prd,
      'total_income',  v_mo_total_inc,
      'total_expense', v_mo_total_exp,
      'net_profit',    v_mo_total_inc - v_mo_total_exp
    );
  end loop;

  return jsonb_build_object(
    'year', p_year,
    'income', jsonb_build_object(
      'service_sales',   v_service_income,
      'product_sales',   v_product_income,
      'other_income',    coalesce((v_adj_income->>'other_income')::numeric,    0),
      'rent_received',   coalesce((v_adj_income->>'rent_received')::numeric,   0),
      'interest_income', coalesce((v_adj_income->>'interest_income')::numeric, 0),
      'owner_deposit',   coalesce((v_adj_income->>'owner_deposit')::numeric,   0)
    ),
    'expense', jsonb_build_object(
      'water',               coalesce((v_adj_expense->>'water')::numeric,               0),
      'electricity',         coalesce((v_adj_expense->>'electricity')::numeric,         0),
      'internet',            coalesce((v_adj_expense->>'internet')::numeric,            0),
      'phone',               coalesce((v_adj_expense->>'phone')::numeric,               0),
      'product_cost',        coalesce((v_adj_expense->>'product_cost')::numeric,        0),
      'service_cost',        coalesce((v_adj_expense->>'service_cost')::numeric,        0),
      'salary',              coalesce((v_adj_expense->>'salary')::numeric,              0),
      'commission_expense',  coalesce((v_adj_expense->>'commission_expense')::numeric,  0),
      'regular_expense',     coalesce((v_adj_expense->>'regular_expense')::numeric,     0),
      'other_expense',       coalesce((v_adj_expense->>'other_expense')::numeric,       0),
      'interest_fee',        coalesce((v_adj_expense->>'interest_fee')::numeric,        0),
      'refund',              coalesce((v_adj_expense->>'refund')::numeric,              0)
    ),
    'months', v_months
  );
end;
$$;

revoke all on function public.get_pl_report_year(text) from public, anon;
grant execute on function public.get_pl_report_year(text) to authenticated;
