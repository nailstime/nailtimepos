-- Commission periods remain editable through the 25th of the following month.
-- At 00:05 Bangkok time on the 26th, the prior calendar month is snapshotted
-- exactly once and no longer changes if catalog, staff, or rules are edited.

alter table public.commission_settings
  drop constraint if exists commission_settings_effective_month_check;
alter table public.commission_settings
  add constraint commission_settings_effective_month_check
  check (effective_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

alter table public.commission_tiers
  drop constraint if exists commission_tiers_effective_month_check;
alter table public.commission_tiers
  add constraint commission_tiers_effective_month_check
  check (effective_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

alter table public.staff_commission_bonuses
  drop constraint if exists staff_commission_bonuses_effective_month_check;
alter table public.staff_commission_bonuses
  add constraint staff_commission_bonuses_effective_month_check
  check (effective_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

create table if not exists public.commission_runs (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  period_month text not null check (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  configured boolean not null default false,
  team_net_sales numeric(12,2) not null default 0,
  team_minimum_amount numeric(12,2),
  tier_pct numeric(5,2) not null default 0,
  source_configuration jsonb not null default '{}'::jsonb,
  finalized_at timestamptz not null default now(),
  unique (branch_id, period_month)
);

create table if not exists public.staff_commission_results (
  id uuid primary key default gen_random_uuid(),
  commission_run_id uuid not null references public.commission_runs(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  staff_id uuid not null references public.staff(id),
  staff_name text not null,
  net_sales numeric(12,2) not null default 0,
  tier_pct numeric(5,2) not null default 0,
  bonus_pct numeric(5,2) not null default 0,
  effective_pct numeric(5,2) not null default 0,
  commission_amount numeric(12,2) not null default 0,
  unique (commission_run_id, staff_id)
);

create index if not exists commission_runs_branch_period_idx
  on public.commission_runs(branch_id, period_month desc);
create index if not exists staff_commission_results_run_idx
  on public.staff_commission_results(commission_run_id, staff_id);

alter table public.commission_runs enable row level security;
alter table public.staff_commission_results enable row level security;

create policy commission_runs_owner_read
  on public.commission_runs for select to authenticated
  using ((select private.is_owner()) and branch_id = (select private.current_branch_id()));
create policy staff_commission_results_owner_read
  on public.staff_commission_results for select to authenticated
  using ((select private.is_owner()) and branch_id = (select private.current_branch_id()));

revoke all on table public.commission_runs, public.staff_commission_results from public, anon;
grant select on table public.commission_runs, public.staff_commission_results to authenticated;

create or replace function private.commission_close_at(p_month text)
returns timestamptz
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_period_start date;
begin
  if p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid commission period';
  end if;
  v_period_start := (p_month || '-01')::date;
  -- Midnight after the 25th of the following month, in Bangkok time.
  return (v_period_start + interval '1 month' + interval '25 days') at time zone 'Asia/Bangkok';
end;
$$;

create or replace function private.calculate_commission_period(
  p_branch uuid,
  p_month text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_settings public.commission_settings%rowtype;
  v_team_net_sales numeric := 0;
  v_tier_pct numeric := 0;
  v_rows jsonb := '[]'::jsonb;
begin
  if p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid month';
  end if;

  select * into v_settings
  from public.commission_settings
  where branch_id = p_branch and effective_month = p_month;

  if not found then
    return jsonb_build_object(
      'month', p_month,
      'configured', false,
      'team_net_sales', 0,
      'team_minimum_amount', null,
      'tier_pct', 0,
      'team_threshold_met', false,
      'rows', '[]'::jsonb
    );
  end if;

  select coalesce(sum(oi.price_snapshot * oi.qty * o.total / nullif(o.subtotal, 0)), 0)
    into v_team_net_sales
  from public.order_items oi
  join public.orders o on o.id = oi.order_id and o.status = 'paid'
  where o.branch_id = p_branch
    and to_char(timezone('Asia/Bangkok', o.paid_at), 'YYYY-MM') = p_month
    and o.subtotal > 0
    and oi.item_type in ('service', 'product');

  if v_team_net_sales >= v_settings.team_minimum_amount then
    select coalesce(ct.pct, 0) into v_tier_pct
    from public.commission_tiers ct
    where ct.branch_id = p_branch
      and ct.effective_month = p_month
      and v_team_net_sales >= ct.min_amount
      and (ct.max_amount is null or v_team_net_sales < ct.max_amount)
    order by ct.min_amount desc
    limit 1;
  end if;
  v_tier_pct := coalesce(v_tier_pct, 0);

  with staff_sales as (
    select
      s.id as staff_id,
      s.name as technician,
      round(sum(oi.price_snapshot * oi.qty * o.total / nullif(o.subtotal, 0)), 2) as total_sales
    from public.order_items oi
    join public.orders o on o.id = oi.order_id and o.status = 'paid'
    join public.staff s on s.id = oi.technician_id
    where o.branch_id = p_branch
      and to_char(timezone('Asia/Bangkok', o.paid_at), 'YYYY-MM') = p_month
      and o.subtotal > 0
      and oi.item_type in ('service', 'product')
    group by s.id, s.name
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'staff_id', ss.staff_id,
    'technician', ss.technician,
    'total_sales', ss.total_sales,
    'tier_pct', v_tier_pct,
    'bonus_pct', coalesce(scb.bonus_pct, 0),
    'effective_pct', v_tier_pct + coalesce(scb.bonus_pct, 0),
    'commission', round(ss.total_sales * (v_tier_pct + coalesce(scb.bonus_pct, 0)) / 100, 2)
  ) order by ss.technician), '[]'::jsonb)
  into v_rows
  from staff_sales ss
  left join public.staff_commission_bonuses scb
    on scb.staff_id = ss.staff_id and scb.effective_month = p_month;

  return jsonb_build_object(
    'month', p_month,
    'configured', true,
    'team_net_sales', round(v_team_net_sales, 2),
    'team_minimum_amount', v_settings.team_minimum_amount,
    'tier_pct', v_tier_pct,
    'team_threshold_met', v_team_net_sales >= v_settings.team_minimum_amount,
    'rows', v_rows
  );
end;
$$;

create or replace function public.admin_staff_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_period text := to_char(timezone('Asia/Bangkok', now()), 'YYYY-MM');
begin
  perform private.require_staff(true);

  return jsonb_build_object(
    'commission_period', v_period,
    'commission_close_at', private.commission_close_at(v_period),
    'branches', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', b.id,
        'code', b.code,
        'name', b.name,
        'active', b.active
      ) order by b.code), '[]'::jsonb)
      from public.branches b
      where b.active
    ),
    'staff', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id,
        'branch_id', s.branch_id,
        'branch_code', b.code,
        'branch_name', b.name,
        'name', s.name,
        'role', s.role,
        'active', s.active,
        'commission_bonus_pct', coalesce(scb.bonus_pct, 0),
        'created_at', s.created_at
      ) order by s.active desc, b.code, s.created_at), '[]'::jsonb)
      from public.staff s
      join public.branches b on b.id = s.branch_id
      left join public.staff_commission_bonuses scb
        on scb.staff_id = s.id and scb.effective_month = v_period
    )
  );
end;
$$;

create or replace function public.save_team_commission_configuration(
  p_effective_month text,
  p_team_minimum_amount numeric,
  p_tiers jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_owner public.staff%rowtype;
  v_expected numeric;
  v_has_unbounded boolean := false;
  v_rec record;
begin
  v_owner := private.require_staff(true);
  if p_effective_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid commission period'; end if;
  if now() >= private.commission_close_at(p_effective_month) or exists (
    select 1 from public.commission_runs
    where branch_id = v_owner.branch_id and period_month = p_effective_month
  ) then
    raise exception 'commission period is already closed';
  end if;
  if p_team_minimum_amount is null or p_team_minimum_amount < 0 then raise exception 'team minimum must be zero or greater'; end if;
  if jsonb_typeof(p_tiers) <> 'array' or jsonb_array_length(p_tiers) = 0 then raise exception 'tiers are required'; end if;

  insert into public.commission_settings(branch_id, mode, effective_month, team_minimum_amount, created_by)
  values (v_owner.branch_id, 'tiered_monthly', p_effective_month, round(p_team_minimum_amount, 2), v_owner.id)
  on conflict (branch_id, effective_month) do update
  set mode = excluded.mode,
      team_minimum_amount = excluded.team_minimum_amount,
      created_by = excluded.created_by,
      created_at = now();

  delete from public.commission_tiers
  where branch_id = v_owner.branch_id and effective_month = p_effective_month;

  insert into public.commission_tiers(branch_id, effective_month, min_amount, max_amount, pct)
  select v_owner.branch_id, p_effective_month, x.min_amount, x.max_amount, x.pct
  from jsonb_to_recordset(p_tiers) as x(min_amount numeric, max_amount numeric, pct numeric);

  v_expected := p_team_minimum_amount;
  for v_rec in
    select min_amount, max_amount, pct
    from public.commission_tiers
    where branch_id = v_owner.branch_id and effective_month = p_effective_month
    order by min_amount
  loop
    if v_rec.min_amount <> v_expected then raise exception 'commission tiers must begin at the team minimum and be continuous'; end if;
    if v_rec.pct < 0 or v_rec.pct > 100 then raise exception 'commission percentage is invalid'; end if;
    if v_rec.max_amount is null then
      v_has_unbounded := true;
    else
      if v_rec.max_amount <= v_rec.min_amount then raise exception 'tier maximum must be greater than its minimum'; end if;
      v_expected := v_rec.max_amount;
    end if;
  end loop;
  if not v_has_unbounded then raise exception 'the last commission tier must have no maximum'; end if;
end;
$$;

create or replace function public.save_staff_commission_bonus(
  p_staff uuid,
  p_effective_month text,
  p_bonus_pct numeric
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_owner public.staff%rowtype;
begin
  v_owner := private.require_staff(true);
  if p_effective_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid commission period'; end if;
  if now() >= private.commission_close_at(p_effective_month) or exists (
    select 1 from public.commission_runs
    where branch_id = v_owner.branch_id and period_month = p_effective_month
  ) then
    raise exception 'commission period is already closed';
  end if;
  if p_bonus_pct is null or p_bonus_pct < 0 or p_bonus_pct > 100 then raise exception 'commission bonus must be between 0 and 100'; end if;
  if not exists (
    select 1 from public.staff s
    where s.id = p_staff and s.branch_id = v_owner.branch_id and s.active
  ) then
    raise exception 'staff member not found in this branch';
  end if;

  if p_bonus_pct = 0 then
    delete from public.staff_commission_bonuses
    where staff_id = p_staff and effective_month = p_effective_month;
    return;
  end if;

  insert into public.staff_commission_bonuses(branch_id, staff_id, effective_month, bonus_pct, created_by)
  values (v_owner.branch_id, p_staff, p_effective_month, round(p_bonus_pct, 2), v_owner.id)
  on conflict (staff_id, effective_month) do update
  set bonus_pct = excluded.bonus_pct,
      created_by = excluded.created_by,
      updated_at = now();
end;
$$;

create or replace function public.finalize_due_commissions()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_period text := to_char(timezone('Asia/Bangkok', now()) - interval '1 month', 'YYYY-MM');
  v_branch record;
  v_calculation jsonb;
  v_run_id uuid;
  v_finalized_count integer := 0;
begin
  for v_branch in select id from public.branches where active loop
    if now() < private.commission_close_at(v_period) or exists (
      select 1 from public.commission_runs
      where branch_id = v_branch.id and period_month = v_period
    ) then
      continue;
    end if;

    v_calculation := private.calculate_commission_period(v_branch.id, v_period);
    insert into public.commission_runs(
      branch_id, period_month, configured, team_net_sales,
      team_minimum_amount, tier_pct, source_configuration
    ) values (
      v_branch.id, v_period,
      coalesce((v_calculation ->> 'configured')::boolean, false),
      coalesce((v_calculation ->> 'team_net_sales')::numeric, 0),
      nullif(v_calculation ->> 'team_minimum_amount', '')::numeric,
      coalesce((v_calculation ->> 'tier_pct')::numeric, 0),
      v_calculation
    ) returning id into v_run_id;

    insert into public.staff_commission_results(
      commission_run_id, branch_id, staff_id, staff_name, net_sales,
      tier_pct, bonus_pct, effective_pct, commission_amount
    )
    select
      v_run_id, v_branch.id, x.staff_id, x.technician, x.total_sales,
      x.tier_pct, x.bonus_pct, x.effective_pct, x.commission
    from jsonb_to_recordset(coalesce(v_calculation -> 'rows', '[]'::jsonb)) as x(
      staff_id uuid,
      technician text,
      total_sales numeric,
      tier_pct numeric,
      bonus_pct numeric,
      effective_pct numeric,
      commission numeric
    );
    v_finalized_count := v_finalized_count + 1;
  end loop;
  return v_finalized_count;
end;
$$;

create or replace function public.commission_report(p_month text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_owner public.staff%rowtype;
  v_run public.commission_runs%rowtype;
  v_rows jsonb;
  v_report jsonb;
begin
  v_owner := private.require_staff(true);
  if p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid month'; end if;

  select * into v_run
  from public.commission_runs
  where branch_id = v_owner.branch_id and period_month = p_month;

  if found then
    select coalesce(jsonb_agg(jsonb_build_object(
      'staff_id', r.staff_id,
      'technician', r.staff_name,
      'total_sales', r.net_sales,
      'tier_pct', r.tier_pct,
      'bonus_pct', r.bonus_pct,
      'effective_pct', r.effective_pct,
      'commission', r.commission_amount
    ) order by r.staff_name), '[]'::jsonb)
    into v_rows
    from public.staff_commission_results r
    where r.commission_run_id = v_run.id;

    return jsonb_build_object(
      'month', p_month,
      'configured', v_run.configured,
      'team_net_sales', v_run.team_net_sales,
      'team_minimum_amount', v_run.team_minimum_amount,
      'tier_pct', v_run.tier_pct,
      'team_threshold_met', v_run.configured and v_run.team_net_sales >= coalesce(v_run.team_minimum_amount, 0),
      'rows', v_rows,
      'finalized', true,
      'can_edit', false,
      'close_at', v_run.finalized_at
    );
  end if;

  v_report := private.calculate_commission_period(v_owner.branch_id, p_month);
  return v_report || jsonb_build_object(
    'finalized', false,
    'can_edit', now() < private.commission_close_at(p_month),
    'close_at', private.commission_close_at(p_month)
  );
end;
$$;

revoke all on function public.finalize_due_commissions() from public, anon, authenticated;
grant execute on function public.finalize_due_commissions() to service_role;
revoke all on function public.commission_report(text) from public, anon;
grant execute on function public.commission_report(text) to authenticated;

do $$
declare
  v_job record;
begin
  for v_job in select jobid from cron.job where jobname = 'finalize-due-commissions' loop
    perform cron.unschedule(v_job.jobid);
  end loop;
  perform cron.schedule(
    'finalize-due-commissions',
    '5 17 * * *',
    'select public.finalize_due_commissions();'
  );
end;
$$;
