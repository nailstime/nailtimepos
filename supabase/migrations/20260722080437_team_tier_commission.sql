-- A single commission system: team net-sales tier plus an optional staff bonus.
-- Historic per-service percentages remain stored temporarily, but are no longer
-- configured or used to calculate commissions.

alter table public.commission_settings
  add column if not exists team_minimum_amount numeric(12,2) not null default 0
  check (team_minimum_amount >= 0);

update public.commission_settings
set mode = 'tiered_monthly'
where mode is distinct from 'tiered_monthly';

alter table public.commission_settings
  drop constraint if exists commission_settings_mode_check;

alter table public.commission_settings
  add constraint commission_settings_mode_check check (mode = 'tiered_monthly');

alter table public.commission_settings
  alter column mode set default 'tiered_monthly';

alter table public.commission_tiers
  drop constraint if exists commission_tiers_bounds_check;

alter table public.commission_tiers
  add constraint commission_tiers_bounds_check
  check (max_amount is null or max_amount > min_amount);

create table if not exists public.staff_commission_bonuses (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  staff_id uuid not null references public.staff(id) on delete cascade,
  effective_month text not null check (effective_month ~ '^\\d{4}-(0[1-9]|1[0-2])$'),
  bonus_pct numeric(5,2) not null check (bonus_pct >= 0 and bonus_pct <= 100),
  created_by uuid not null references public.staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, effective_month)
);

create index if not exists staff_commission_bonuses_lookup_idx
  on public.staff_commission_bonuses(branch_id, effective_month, staff_id);

alter table public.staff_commission_bonuses enable row level security;

create policy staff_commission_bonuses_owner_read
  on public.staff_commission_bonuses for select to authenticated
  using (
    (select private.is_owner())
    and branch_id = (select private.current_branch_id())
  );

revoke all on table public.staff_commission_bonuses from public, anon;
grant select on table public.staff_commission_bonuses to authenticated;

create or replace function public.admin_staff_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_next_month text := to_char(
    date_trunc('month', timezone('Asia/Bangkok', now())) + interval '1 month',
    'YYYY-MM'
  );
begin
  perform private.require_staff(true);

  return jsonb_build_object(
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
        on scb.staff_id = s.id and scb.effective_month = v_next_month
    )
  );
end;
$$;

drop function if exists public.catalog_create(text, text, numeric, numeric, boolean, uuid);
create function public.catalog_create(
  p_kind text,
  p_name text,
  p_price numeric,
  p_counts_toward_points boolean,
  p_category uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_owner public.staff%rowtype;
  v_id uuid;
begin
  v_owner := private.require_staff(true);
  if p_kind not in ('service', 'product') then raise exception 'invalid catalog kind'; end if;
  if length(btrim(coalesce(p_name, ''))) not between 1 and 160 then raise exception 'name is required'; end if;
  if p_price is null or p_price < 0 or p_price > 1000000 then raise exception 'catalog price is invalid'; end if;
  if p_category is not null and not exists (
    select 1 from public.catalog_categories c
    where c.id = p_category and c.branch_id = v_owner.branch_id and c.kind = p_kind
  ) then
    raise exception 'catalog category not found';
  end if;

  if p_kind = 'service' then
    insert into public.services(branch_id, name, price, counts_toward_points, category_id)
    values (v_owner.branch_id, btrim(p_name), p_price, coalesce(p_counts_toward_points, true), p_category)
    returning id into v_id;
  else
    insert into public.products(branch_id, name, price, counts_toward_points, category_id)
    values (v_owner.branch_id, btrim(p_name), p_price, coalesce(p_counts_toward_points, true), p_category)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

drop function if exists public.catalog_update(text, uuid, text, numeric, numeric, boolean, uuid);
create function public.catalog_update(
  p_kind text,
  p_item uuid,
  p_name text,
  p_price numeric,
  p_counts_toward_points boolean,
  p_category uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_owner public.staff%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_result jsonb;
begin
  v_owner := private.require_staff(true);
  if p_kind not in ('service', 'product') then raise exception 'invalid catalog kind'; end if;
  if length(v_name) not between 1 and 160 then raise exception 'catalog name is invalid'; end if;
  if p_price is null or p_price < 0 or p_price > 1000000 then raise exception 'catalog price is invalid'; end if;
  if p_category is not null and not exists (
    select 1 from public.catalog_categories c
    where c.id = p_category and c.branch_id = v_owner.branch_id and c.kind = p_kind
  ) then
    raise exception 'catalog category not found';
  end if;

  if p_kind = 'service' then
    update public.services
    set name = v_name,
        price = round(p_price, 2),
        counts_toward_points = coalesce(p_counts_toward_points, true),
        category_id = p_category
    where id = p_item and branch_id = v_owner.branch_id
    returning jsonb_build_object(
      'id', id, 'name', name, 'price', price, 'category_id', category_id,
      'counts_toward_points', counts_toward_points, 'is_active', is_active
    ) into v_result;
  else
    update public.products
    set name = v_name,
        price = round(p_price, 2),
        counts_toward_points = coalesce(p_counts_toward_points, true),
        category_id = p_category
    where id = p_item and branch_id = v_owner.branch_id
    returning jsonb_build_object(
      'id', id, 'name', name, 'price', price, 'category_id', category_id,
      'counts_toward_points', counts_toward_points, 'active', active
    ) into v_result;
  end if;

  if v_result is null then raise exception 'catalog item not found'; end if;
  return v_result;
exception
  when unique_violation then raise exception 'catalog name already exists';
end;
$$;

drop function if exists public.save_commission_configuration(text, text, jsonb);
create function public.save_team_commission_configuration(
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
  v_next_month text := to_char(
    date_trunc('month', timezone('Asia/Bangkok', now())) + interval '1 month',
    'YYYY-MM'
  );
begin
  v_owner := private.require_staff(true);
  if p_effective_month <> v_next_month then raise exception 'commission settings can only target next month'; end if;
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

create function public.save_staff_commission_bonus(
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
  v_next_month text := to_char(
    date_trunc('month', timezone('Asia/Bangkok', now())) + interval '1 month',
    'YYYY-MM'
  );
begin
  v_owner := private.require_staff(true);
  if p_effective_month <> v_next_month then raise exception 'staff commission bonuses can only target next month'; end if;
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

create or replace function public.commission_report(p_month text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_owner public.staff%rowtype;
  v_settings public.commission_settings%rowtype;
  v_team_net_sales numeric := 0;
  v_tier_pct numeric := 0;
  v_rows jsonb := '[]'::jsonb;
begin
  v_owner := private.require_staff(true);
  if p_month !~ '^\\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid month'; end if;

  select * into v_settings
  from public.commission_settings
  where branch_id = v_owner.branch_id and effective_month = p_month;

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
  where o.branch_id = v_owner.branch_id
    and to_char(timezone('Asia/Bangkok', o.paid_at), 'YYYY-MM') = p_month
    and o.subtotal > 0
    and oi.item_type in ('service', 'product');

  if v_team_net_sales >= v_settings.team_minimum_amount then
    select coalesce(ct.pct, 0) into v_tier_pct
    from public.commission_tiers ct
    where ct.branch_id = v_owner.branch_id
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
    where o.branch_id = v_owner.branch_id
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

revoke all on function public.catalog_create(text, text, numeric, boolean, uuid) from public, anon;
revoke all on function public.catalog_update(text, uuid, text, numeric, boolean, uuid) from public, anon;
revoke all on function public.save_team_commission_configuration(text, numeric, jsonb) from public, anon;
revoke all on function public.save_staff_commission_bonus(uuid, text, numeric) from public, anon;

grant execute on function public.catalog_create(text, text, numeric, boolean, uuid) to authenticated;
grant execute on function public.catalog_update(text, uuid, text, numeric, boolean, uuid) to authenticated;
grant execute on function public.save_team_commission_configuration(text, numeric, jsonb) to authenticated;
grant execute on function public.save_staff_commission_bonus(uuid, text, numeric) to authenticated;
