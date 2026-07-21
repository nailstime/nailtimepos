-- Replace daily sales comparison with cumulative bank-balance reconciliation.
-- Closed periods are immutable. Owner-created adjustments remain auditable and
-- are locked to the period that consumes them.

create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  name text not null check (length(btrim(name)) between 1 and 120),
  opening_balance numeric(14,2) not null check (opening_balance >= 0),
  opening_at timestamptz not null,
  close_time time without time zone not null default time '20:00',
  timezone text not null default 'Asia/Bangkok' check (length(btrim(timezone)) between 1 and 80),
  active boolean not null default true,
  created_by uuid not null references public.staff(id),
  created_at timestamptz not null default now(),
  unique (branch_id, name)
);

create unique index bank_accounts_one_active_per_branch_idx
  on public.bank_accounts(branch_id)
  where active;
create index bank_accounts_created_by_idx on public.bank_accounts(created_by);

create table public.bank_reconciliations (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.bank_accounts(id),
  branch_id uuid not null references public.branches(id),
  business_date date not null,
  period_start_at timestamptz not null,
  period_end_at timestamptz not null,
  opening_balance numeric(14,2) not null check (opening_balance >= 0),
  pos_income_total numeric(14,2) not null check (pos_income_total >= 0),
  other_income_total numeric(14,2) not null check (other_income_total >= 0),
  expense_total numeric(14,2) not null check (expense_total >= 0),
  expected_balance numeric(14,2) not null,
  actual_balance numeric(14,2) not null check (actual_balance >= 0),
  diff numeric(14,2) not null,
  closed_by uuid not null references public.staff(id),
  closed_at timestamptz not null default now(),
  unique (bank_account_id, business_date),
  check (period_end_at > period_start_at),
  check (expected_balance = opening_balance + pos_income_total + other_income_total - expense_total),
  check (diff = actual_balance - expected_balance),
  check (diff = 0)
);

alter table public.bank_reconciliations
  add constraint bank_reconciliations_no_overlapping_periods
  exclude using gist (
    bank_account_id with =,
    tstzrange(period_start_at, period_end_at, '(]') with &&
  );

create index bank_reconciliations_branch_period_idx
  on public.bank_reconciliations(branch_id, period_end_at desc);
create index bank_reconciliations_closed_by_idx on public.bank_reconciliations(closed_by);

create table public.bank_adjustments (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.bank_accounts(id),
  branch_id uuid not null references public.branches(id),
  kind text not null check (kind in ('income', 'expense')),
  category text not null default 'other' check (length(btrim(category)) between 1 and 80),
  amount numeric(14,2) not null check (amount > 0),
  description text not null check (length(btrim(description)) between 3 and 500),
  occurred_at timestamptz not null,
  reconciliation_id uuid references public.bank_reconciliations(id),
  created_by uuid not null references public.staff(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.staff(id),
  void_reason text check (void_reason is null or length(btrim(void_reason)) between 3 and 500),
  check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and void_reason is not null)
  )
);

create index bank_adjustments_account_period_idx
  on public.bank_adjustments(bank_account_id, occurred_at)
  where voided_at is null and reconciliation_id is null;
create index bank_adjustments_branch_created_idx
  on public.bank_adjustments(branch_id, created_at desc);
create index bank_adjustments_reconciliation_id_idx on public.bank_adjustments(reconciliation_id);
create index bank_adjustments_created_by_idx on public.bank_adjustments(created_by);
create index bank_adjustments_voided_by_idx on public.bank_adjustments(voided_by)
  where voided_by is not null;

create or replace function private.prevent_closed_reconciliation_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'closed reconciliation records are immutable';
end;
$$;

create trigger bank_reconciliations_immutable
before update or delete on public.bank_reconciliations
for each row execute function private.prevent_closed_reconciliation_mutation();

create or replace function private.prevent_reconciled_adjustment_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.reconciliation_id is not null then
    raise exception 'reconciled adjustments are immutable';
  end if;
  return new;
end;
$$;

create trigger bank_adjustments_lock_reconciled
before update or delete on public.bank_adjustments
for each row execute function private.prevent_reconciled_adjustment_mutation();

create or replace function public.initialize_bank_reconciliation(
  p_opening_balance numeric,
  p_opening_date date,
  p_close_time time without time zone default time '20:00',
  p_account_name text default 'PromptPay account'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner public.staff%rowtype;
  v_account public.bank_accounts%rowtype;
  v_opening_at timestamptz;
begin
  v_owner := private.require_staff(true);
  if p_opening_balance is null or p_opening_balance < 0 then
    raise exception 'opening balance must be zero or greater';
  end if;
  if p_opening_date is null or p_close_time is null then
    raise exception 'opening date and close time are required';
  end if;
  if length(btrim(coalesce(p_account_name, ''))) not between 1 and 120 then
    raise exception 'account name is invalid';
  end if;

  v_opening_at := (p_opening_date + p_close_time) at time zone 'Asia/Bangkok';
  if v_opening_at > now() then
    raise exception 'opening balance timestamp cannot be in the future';
  end if;

  insert into public.bank_accounts(
    branch_id, name, opening_balance, opening_at, close_time, timezone, created_by
  ) values (
    v_owner.branch_id, btrim(p_account_name), round(p_opening_balance, 2),
    v_opening_at, p_close_time, 'Asia/Bangkok', v_owner.id
  )
  returning * into v_account;

  return jsonb_build_object(
    'id', v_account.id,
    'name', v_account.name,
    'opening_balance', v_account.opening_balance,
    'opening_at', v_account.opening_at,
    'close_time', v_account.close_time
  );
exception
  when unique_violation then
    raise exception 'an active bank account already exists for this branch';
end;
$$;

create or replace function public.get_bank_reconciliation_preview(p_business_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner public.staff%rowtype;
  v_account public.bank_accounts%rowtype;
  v_previous public.bank_reconciliations%rowtype;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_opening numeric(14,2);
  v_pos numeric(14,2) := 0;
  v_income numeric(14,2) := 0;
  v_expense numeric(14,2) := 0;
  v_expected numeric(14,2);
  v_payment_count integer := 0;
  v_payments jsonb := '[]'::jsonb;
  v_adjustments jsonb := '[]'::jsonb;
begin
  v_owner := private.require_staff(true);
  if p_business_date is null then raise exception 'business date is required'; end if;

  select * into v_account
  from public.bank_accounts
  where branch_id = v_owner.branch_id and active
  limit 1;

  if not found then
    return jsonb_build_object(
      'initialized', false,
      'default_close_time', '20:00',
      'business_date', p_business_date,
      'server_now', now()
    );
  end if;

  select * into v_previous
  from public.bank_reconciliations
  where bank_account_id = v_account.id
  order by period_end_at desc
  limit 1;

  if found then
    v_period_start := v_previous.period_end_at;
    v_opening := v_previous.actual_balance;
  else
    v_period_start := v_account.opening_at;
    v_opening := v_account.opening_balance;
  end if;

  v_period_end := (p_business_date + v_account.close_time) at time zone v_account.timezone;
  if v_period_end <= v_period_start then
    raise exception 'business date must be after the last closed period';
  end if;

  select
    coalesce(sum(p.amount), 0),
    count(*)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'payment_id', p.id,
      'order_no', o.order_no,
      'amount', p.amount,
      'confirmed_at', p.confirmed_at,
      'confirmed_by', confirmer.name
    ) order by p.confirmed_at), '[]'::jsonb)
  into v_pos, v_payment_count, v_payments
  from public.payments p
  join public.orders o on o.id = p.order_id
  left join public.staff confirmer on confirmer.id = p.confirmed_by_staff_id
  where o.branch_id = v_owner.branch_id
    and p.method = 'qr'
    and p.status = 'confirmed'
    and p.confirmed_at > v_period_start
    and p.confirmed_at <= v_period_end;

  select
    coalesce(sum(a.amount) filter (where a.kind = 'income'), 0),
    coalesce(sum(a.amount) filter (where a.kind = 'expense'), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id,
      'kind', a.kind,
      'category', a.category,
      'amount', a.amount,
      'description', a.description,
      'occurred_at', a.occurred_at,
      'created_by', creator.name
    ) order by a.occurred_at), '[]'::jsonb)
  into v_income, v_expense, v_adjustments
  from public.bank_adjustments a
  join public.staff creator on creator.id = a.created_by
  where a.bank_account_id = v_account.id
    and a.reconciliation_id is null
    and a.voided_at is null
    and a.occurred_at > v_period_start
    and a.occurred_at <= v_period_end;

  v_expected := v_opening + v_pos + v_income - v_expense;

  return jsonb_build_object(
    'initialized', true,
    'account', jsonb_build_object(
      'id', v_account.id,
      'name', v_account.name,
      'close_time', v_account.close_time,
      'timezone', v_account.timezone
    ),
    'business_date', p_business_date,
    'period_start_at', v_period_start,
    'period_end_at', v_period_end,
    'opening_balance', v_opening,
    'pos_income_total', v_pos,
    'other_income_total', v_income,
    'expense_total', v_expense,
    'expected_balance', v_expected,
    'payment_count', v_payment_count,
    'payments', v_payments,
    'adjustments', v_adjustments,
    'can_close', now() >= v_period_end,
    'server_now', now(),
    'last_reconciled_business_date', v_previous.business_date
  );
end;
$$;

create or replace function public.add_bank_adjustment(
  p_kind text,
  p_amount numeric,
  p_description text,
  p_occurred_at timestamptz default now(),
  p_category text default 'other'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner public.staff%rowtype;
  v_account public.bank_accounts%rowtype;
  v_last_end timestamptz;
  v_row public.bank_adjustments%rowtype;
begin
  v_owner := private.require_staff(true);
  if p_kind not in ('income', 'expense') then raise exception 'invalid adjustment kind'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be greater than zero'; end if;
  if length(btrim(coalesce(p_description, ''))) not between 3 and 500 then
    raise exception 'description must contain 3 to 500 characters';
  end if;
  if length(btrim(coalesce(p_category, ''))) not between 1 and 80 then
    raise exception 'category is invalid';
  end if;
  if p_occurred_at is null or p_occurred_at > now() + interval '5 minutes' then
    raise exception 'occurred timestamp is invalid';
  end if;

  select * into v_account
  from public.bank_accounts
  where branch_id = v_owner.branch_id and active
  limit 1
  for update;
  if not found then raise exception 'bank reconciliation is not initialized'; end if;

  select coalesce(max(period_end_at), v_account.opening_at) into v_last_end
  from public.bank_reconciliations
  where bank_account_id = v_account.id;
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

create or replace function public.void_bank_adjustment(p_adjustment uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner public.staff%rowtype;
  v_row public.bank_adjustments%rowtype;
begin
  v_owner := private.require_staff(true);
  if length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'void reason must contain 3 to 500 characters';
  end if;

  select * into v_row
  from public.bank_adjustments
  where id = p_adjustment and branch_id = v_owner.branch_id
  for update;
  if not found then raise exception 'adjustment not found'; end if;
  if v_row.reconciliation_id is not null then raise exception 'reconciled adjustments are immutable'; end if;
  if v_row.voided_at is not null then raise exception 'adjustment is already voided'; end if;

  update public.bank_adjustments
  set voided_at = now(), voided_by = v_owner.id, void_reason = btrim(p_reason)
  where id = v_row.id
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.close_bank_reconciliation(
  p_business_date date,
  p_actual_balance numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner public.staff%rowtype;
  v_account public.bank_accounts%rowtype;
  v_previous public.bank_reconciliations%rowtype;
  v_row public.bank_reconciliations%rowtype;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_opening numeric(14,2);
  v_pos numeric(14,2) := 0;
  v_income numeric(14,2) := 0;
  v_expense numeric(14,2) := 0;
  v_expected numeric(14,2);
  v_actual numeric(14,2);
  v_diff numeric(14,2);
begin
  v_owner := private.require_staff(true);
  if p_business_date is null then raise exception 'business date is required'; end if;
  if p_actual_balance is null or p_actual_balance < 0 then
    raise exception 'actual balance must be zero or greater';
  end if;

  select * into v_account
  from public.bank_accounts
  where branch_id = v_owner.branch_id and active
  limit 1
  for update;
  if not found then raise exception 'bank reconciliation is not initialized'; end if;

  select * into v_previous
  from public.bank_reconciliations
  where bank_account_id = v_account.id
  order by period_end_at desc
  limit 1
  for update;

  if found then
    v_period_start := v_previous.period_end_at;
    v_opening := v_previous.actual_balance;
  else
    v_period_start := v_account.opening_at;
    v_opening := v_account.opening_balance;
  end if;

  v_period_end := (p_business_date + v_account.close_time) at time zone v_account.timezone;
  if v_period_end <= v_period_start then
    raise exception 'business date must be after the last closed period';
  end if;
  if now() < v_period_end then
    raise exception 'reconciliation is available only after the configured close time';
  end if;

  perform p.id
  from public.payments p
  join public.orders o on o.id = p.order_id
  where o.branch_id = v_owner.branch_id
    and p.method = 'qr'
    and p.status = 'confirmed'
    and p.confirmed_at > v_period_start
    and p.confirmed_at <= v_period_end
  order by p.id
  for share of p;

  select coalesce(sum(p.amount), 0) into v_pos
  from public.payments p
  join public.orders o on o.id = p.order_id
  where o.branch_id = v_owner.branch_id
    and p.method = 'qr'
    and p.status = 'confirmed'
    and p.confirmed_at > v_period_start
    and p.confirmed_at <= v_period_end;

  select
    coalesce(sum(a.amount) filter (where a.kind = 'income'), 0),
    coalesce(sum(a.amount) filter (where a.kind = 'expense'), 0)
  into v_income, v_expense
  from public.bank_adjustments a
  where a.bank_account_id = v_account.id
    and a.reconciliation_id is null
    and a.voided_at is null
    and a.occurred_at > v_period_start
    and a.occurred_at <= v_period_end;

  v_expected := v_opening + v_pos + v_income - v_expense;
  v_actual := round(p_actual_balance, 2);
  v_diff := v_actual - v_expected;
  if v_diff <> 0 then
    raise exception 'reconciliation difference is %', v_diff;
  end if;

  insert into public.bank_reconciliations(
    bank_account_id, branch_id, business_date, period_start_at, period_end_at,
    opening_balance, pos_income_total, other_income_total, expense_total,
    expected_balance, actual_balance, diff, closed_by
  ) values (
    v_account.id, v_owner.branch_id, p_business_date, v_period_start, v_period_end,
    v_opening, v_pos, v_income, v_expense,
    v_expected, v_actual, v_diff, v_owner.id
  )
  returning * into v_row;

  update public.bank_adjustments
  set reconciliation_id = v_row.id
  where bank_account_id = v_account.id
    and reconciliation_id is null
    and voided_at is null
    and occurred_at > v_period_start
    and occurred_at <= v_period_end;

  return to_jsonb(v_row);
end;
$$;

alter table public.bank_accounts enable row level security;
alter table public.bank_reconciliations enable row level security;
alter table public.bank_adjustments enable row level security;

create policy bank_accounts_owner_read on public.bank_accounts
for select to authenticated
using ((select private.is_owner()) and branch_id = (select private.current_branch_id()));

create policy bank_reconciliations_owner_read on public.bank_reconciliations
for select to authenticated
using ((select private.is_owner()) and branch_id = (select private.current_branch_id()));

create policy bank_adjustments_owner_read on public.bank_adjustments
for select to authenticated
using ((select private.is_owner()) and branch_id = (select private.current_branch_id()));

revoke all on public.bank_accounts, public.bank_reconciliations, public.bank_adjustments
  from public, anon, authenticated;
grant select on public.bank_accounts, public.bank_reconciliations, public.bank_adjustments
  to authenticated;

revoke execute on function private.prevent_closed_reconciliation_mutation()
  from public, anon, authenticated;
revoke execute on function private.prevent_reconciled_adjustment_mutation()
  from public, anon, authenticated;

revoke execute on function public.initialize_bank_reconciliation(numeric, date, time without time zone, text)
  from public, anon, authenticated;
revoke execute on function public.get_bank_reconciliation_preview(date)
  from public, anon, authenticated;
revoke execute on function public.add_bank_adjustment(text, numeric, text, timestamptz, text)
  from public, anon, authenticated;
revoke execute on function public.void_bank_adjustment(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.close_bank_reconciliation(date, numeric)
  from public, anon, authenticated;

grant execute on function public.initialize_bank_reconciliation(numeric, date, time without time zone, text)
  to authenticated;
grant execute on function public.get_bank_reconciliation_preview(date)
  to authenticated;
grant execute on function public.add_bank_adjustment(text, numeric, text, timestamptz, text)
  to authenticated;
grant execute on function public.void_bank_adjustment(uuid, text)
  to authenticated;
grant execute on function public.close_bank_reconciliation(date, numeric)
  to authenticated;
