-- Step 1: Migrate unreconciled adjustments to the new fixed category set.
-- Reconciled rows are immutable (trigger blocks updates), so only touch reconciliation_id IS NULL.

-- Income
update public.bank_adjustments set category = 'rent_received'
  where kind = 'income' and category = 'rent' and reconciliation_id is null;
update public.bank_adjustments set category = 'other_income'
  where kind = 'income' and reconciliation_id is null
    and category not in ('other_income', 'owner_deposit', 'rent_received', 'interest_income');

-- Expense
update public.bank_adjustments set category = 'product_cost'
  where kind = 'expense' and category = 'supplies' and reconciliation_id is null;
update public.bank_adjustments set category = 'interest_fee'
  where kind = 'expense' and category = 'bank_fee' and reconciliation_id is null;
update public.bank_adjustments set category = 'other_expense'
  where kind = 'expense' and category = 'shop_expense' and reconciliation_id is null;
update public.bank_adjustments set category = 'other_expense'
  where kind = 'expense' and reconciliation_id is null
    and category not in ('water', 'electricity', 'internet', 'phone',
      'product_cost', 'service_cost', 'regular_expense', 'other_expense',
      'interest_fee', 'refund');

-- Step 2: Replace add_bank_adjustment with per-kind category validation.
-- No DB CHECK constraint — reconciled rows are immutable so we can't enforce retroactively.
-- Validation lives in the RPC only; new rows are always valid.
create or replace function public.add_bank_adjustment(
  p_kind        text,
  p_amount      numeric,
  p_description text,
  p_occurred_at timestamptz default now(),
  p_category    text        default 'other_expense'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner   public.staff%rowtype;
  v_account public.bank_accounts%rowtype;
  v_last_end timestamptz;
  v_row     public.bank_adjustments%rowtype;
begin
  v_owner := private.require_staff(true);

  if p_kind not in ('income', 'expense') then raise exception 'invalid adjustment kind'; end if;
  if p_amount is null or p_amount <= 0     then raise exception 'amount must be greater than zero'; end if;
  if length(btrim(coalesce(p_description, ''))) not between 3 and 500 then
    raise exception 'description must contain 3 to 500 characters';
  end if;
  if p_occurred_at is null or p_occurred_at > now() + interval '5 minutes' then
    raise exception 'occurred timestamp is invalid';
  end if;

  if p_kind = 'income' and btrim(coalesce(p_category,'')) not in
    ('other_income', 'owner_deposit', 'rent_received', 'interest_income') then
    raise exception 'invalid income category';
  end if;
  if p_kind = 'expense' and btrim(coalesce(p_category,'')) not in
    ('water', 'electricity', 'internet', 'phone',
     'product_cost', 'service_cost', 'regular_expense', 'other_expense',
     'interest_fee', 'refund') then
    raise exception 'invalid expense category';
  end if;

  select * into v_account
  from public.bank_accounts
  where branch_id = v_owner.branch_id and active
  limit 1 for update;
  if not found then raise exception 'bank reconciliation is not initialized'; end if;

  select coalesce(max(period_end_at), v_account.opening_at) into v_last_end
  from public.bank_reconciliations where bank_account_id = v_account.id;
  if p_occurred_at <= v_last_end then
    raise exception 'cannot add an adjustment inside a closed period';
  end if;

  insert into public.bank_adjustments(
    bank_account_id, branch_id, kind, category, amount,
    description, occurred_at, created_by
  ) values (
    v_account.id, v_owner.branch_id, p_kind, btrim(p_category), round(p_amount, 2),
    btrim(p_description), p_occurred_at, v_owner.id
  )
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

-- Step 3: P&L report — monthly income/expense breakdown.
-- Revenue from POS (orders.paid_at) split by service/product; adjustments split by category.
-- Discount is attributed proportionally across service and product items.
-- owner_deposit is returned separately and excluded from net profit.
create or replace function public.get_pl_report(p_month text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_owner          public.staff%rowtype;
  v_month_start    date;
  v_tz_start       timestamptz;
  v_tz_end         timestamptz;
  v_service_income numeric := 0;
  v_product_income numeric := 0;
  v_adj_income     jsonb   := '{}';
  v_adj_expense    jsonb   := '{}';
begin
  v_owner := private.require_staff(true);

  if p_month !~ '^\d{4}-\d{2}$' then
    raise exception 'invalid month format — expected YYYY-MM';
  end if;
  v_month_start := (p_month || '-01')::date;
  v_tz_start    := timezone('Asia/Bangkok', v_month_start::timestamp);
  v_tz_end      := timezone('Asia/Bangkok', (v_month_start + interval '1 month')::timestamp);

  -- POS income split: discount attributed proportionally per order
  select
    coalesce(sum(
      case when oi.item_type = 'service'
      then round(oi.price_snapshot * oi.qty * o.total / nullif(o.subtotal, 0), 2)
      else 0 end
    ), 0),
    coalesce(sum(
      case when oi.item_type = 'product'
      then round(oi.price_snapshot * oi.qty * o.total / nullif(o.subtotal, 0), 2)
      else 0 end
    ), 0)
  into v_service_income, v_product_income
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.branch_id = v_owner.branch_id
    and o.status    = 'paid'
    and oi.item_type in ('service', 'product')
    and o.paid_at >= v_tz_start
    and o.paid_at <  v_tz_end;

  -- Income adjustments by category
  select coalesce(jsonb_object_agg(category, total), '{}')
  into v_adj_income
  from (
    select category, sum(amount) as total
    from public.bank_adjustments
    where branch_id  = v_owner.branch_id
      and kind       = 'income'
      and voided_at  is null
      and occurred_at >= v_tz_start
      and occurred_at <  v_tz_end
    group by category
  ) s;

  -- Expense adjustments by category
  select coalesce(jsonb_object_agg(category, total), '{}')
  into v_adj_expense
  from (
    select category, sum(amount) as total
    from public.bank_adjustments
    where branch_id  = v_owner.branch_id
      and kind       = 'expense'
      and voided_at  is null
      and occurred_at >= v_tz_start
      and occurred_at <  v_tz_end
    group by category
  ) s;

  return jsonb_build_object(
    'month', p_month,
    'income', jsonb_build_object(
      'service_sales',   v_service_income,
      'product_sales',   v_product_income,
      'other_income',    coalesce((v_adj_income->>'other_income')::numeric,    0),
      'rent_received',   coalesce((v_adj_income->>'rent_received')::numeric,   0),
      'interest_income', coalesce((v_adj_income->>'interest_income')::numeric, 0),
      'owner_deposit',   coalesce((v_adj_income->>'owner_deposit')::numeric,   0)
    ),
    'expense', jsonb_build_object(
      'water',           coalesce((v_adj_expense->>'water')::numeric,           0),
      'electricity',     coalesce((v_adj_expense->>'electricity')::numeric,     0),
      'internet',        coalesce((v_adj_expense->>'internet')::numeric,        0),
      'phone',           coalesce((v_adj_expense->>'phone')::numeric,           0),
      'product_cost',    coalesce((v_adj_expense->>'product_cost')::numeric,    0),
      'service_cost',    coalesce((v_adj_expense->>'service_cost')::numeric,    0),
      'regular_expense', coalesce((v_adj_expense->>'regular_expense')::numeric, 0),
      'other_expense',   coalesce((v_adj_expense->>'other_expense')::numeric,   0),
      'interest_fee',    coalesce((v_adj_expense->>'interest_fee')::numeric,    0),
      'refund',          coalesce((v_adj_expense->>'refund')::numeric,          0)
    )
  );
end;
$$;

revoke all on function public.get_pl_report(text) from public, anon;
grant execute on function public.get_pl_report(text) to authenticated;
