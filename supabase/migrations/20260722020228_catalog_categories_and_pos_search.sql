-- Categories stay branch-scoped so each shop can organise its POS catalog in
-- the way staff expect. Existing rows deliberately remain uncategorised.
create table public.catalog_categories (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  kind text not null check (kind in ('service', 'product')),
  name text not null check (length(btrim(name)) between 1 and 80),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index catalog_categories_branch_kind_name_unique
  on public.catalog_categories(branch_id, kind, lower(name));
create index catalog_categories_branch_kind_sort_idx
  on public.catalog_categories(branch_id, kind, sort_order, name);

alter table public.services
  add column if not exists category_id uuid references public.catalog_categories(id) on delete set null;
alter table public.products
  add column if not exists category_id uuid references public.catalog_categories(id) on delete set null;

create index services_branch_category_sort_idx
  on public.services(branch_id, category_id, sort_order, name);
create index products_branch_category_name_idx
  on public.products(branch_id, category_id, name);

alter table public.catalog_categories enable row level security;
create policy catalog_categories_branch_read on public.catalog_categories for select to authenticated
  using (branch_id = (select private.current_branch_id()));

create or replace function public.catalog_category_create(p_kind text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_owner public.staff%rowtype;
  v_kind text := btrim(coalesce(p_kind, ''));
  v_name text := btrim(coalesce(p_name, ''));
  v_category public.catalog_categories%rowtype;
begin
  v_owner := private.require_staff(true);
  if v_kind not in ('service', 'product') then raise exception 'invalid catalog category kind'; end if;
  if length(v_name) not between 1 and 80 then raise exception 'category name must be 1 to 80 characters'; end if;

  insert into public.catalog_categories(branch_id, kind, name)
  values (v_owner.branch_id, v_kind, v_name)
  returning * into v_category;

  return jsonb_build_object('id', v_category.id, 'kind', v_category.kind, 'name', v_category.name, 'sort_order', v_category.sort_order);
exception
  when unique_violation then raise exception 'category name already exists';
end;
$$;

create or replace function public.catalog_category_rename(p_category uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_owner public.staff%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_category public.catalog_categories%rowtype;
begin
  v_owner := private.require_staff(true);
  if length(v_name) not between 1 and 80 then raise exception 'category name must be 1 to 80 characters'; end if;

  update public.catalog_categories
  set name = v_name
  where id = p_category and branch_id = v_owner.branch_id
  returning * into v_category;
  if not found then raise exception 'catalog category not found'; end if;

  return jsonb_build_object('id', v_category.id, 'kind', v_category.kind, 'name', v_category.name, 'sort_order', v_category.sort_order);
exception
  when unique_violation then raise exception 'category name already exists';
end;
$$;

create or replace function public.catalog_category_delete(p_category uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_owner public.staff%rowtype;
begin
  v_owner := private.require_staff(true);
  delete from public.catalog_categories
  where id = p_category and branch_id = v_owner.branch_id;
  if not found then raise exception 'catalog category not found'; end if;
  return true;
end;
$$;

drop function if exists public.catalog_create(text, text, numeric, numeric, boolean);
create function public.catalog_create(
  p_kind text,
  p_name text,
  p_price numeric,
  p_commission_pct numeric,
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
  if p_price < 0 or p_commission_pct not between 0 and 100 then raise exception 'invalid price or commission'; end if;
  if p_category is not null and not exists (
    select 1 from public.catalog_categories c
    where c.id = p_category and c.branch_id = v_owner.branch_id and c.kind = p_kind
  ) then
    raise exception 'catalog category not found';
  end if;

  if p_kind = 'service' then
    insert into public.services(branch_id, name, price, commission_pct, counts_toward_points, category_id)
    values (v_owner.branch_id, btrim(p_name), p_price, p_commission_pct, p_counts_toward_points, p_category)
    returning id into v_id;
  else
    insert into public.products(branch_id, name, price, commission_pct, counts_toward_points, category_id)
    values (v_owner.branch_id, btrim(p_name), p_price, p_commission_pct, p_counts_toward_points, p_category)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

drop function if exists public.catalog_update(text, uuid, text, numeric, numeric, boolean);
create function public.catalog_update(
  p_kind text,
  p_item uuid,
  p_name text,
  p_price numeric,
  p_commission_pct numeric,
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
  if p_commission_pct is null or p_commission_pct < 0 or p_commission_pct > 100 then raise exception 'catalog commission is invalid'; end if;
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
        commission_pct = round(p_commission_pct, 2),
        counts_toward_points = coalesce(p_counts_toward_points, true),
        category_id = p_category
    where id = p_item and branch_id = v_owner.branch_id
    returning jsonb_build_object(
      'id', id, 'name', name, 'price', price, 'category_id', category_id,
      'commission_pct', commission_pct, 'counts_toward_points', counts_toward_points,
      'is_active', is_active
    ) into v_result;
  else
    update public.products
    set name = v_name,
        price = round(p_price, 2),
        commission_pct = round(p_commission_pct, 2),
        counts_toward_points = coalesce(p_counts_toward_points, true),
        category_id = p_category
    where id = p_item and branch_id = v_owner.branch_id
    returning jsonb_build_object(
      'id', id, 'name', name, 'price', price, 'category_id', category_id,
      'commission_pct', commission_pct, 'counts_toward_points', counts_toward_points,
      'active', active
    ) into v_result;
  end if;

  if v_result is null then raise exception 'catalog item not found'; end if;
  return v_result;
exception
  when unique_violation then raise exception 'catalog name already exists';
end;
$$;

revoke all on table public.catalog_categories from public, anon;
grant select on table public.catalog_categories to authenticated;

revoke all on function public.catalog_category_create(text, text) from public, anon;
revoke all on function public.catalog_category_rename(uuid, text) from public, anon;
revoke all on function public.catalog_category_delete(uuid) from public, anon;
revoke all on function public.catalog_create(text, text, numeric, numeric, boolean, uuid) from public, anon;
revoke all on function public.catalog_update(text, uuid, text, numeric, numeric, boolean, uuid) from public, anon;

grant execute on function public.catalog_category_create(text, text) to authenticated;
grant execute on function public.catalog_category_rename(uuid, text) to authenticated;
grant execute on function public.catalog_category_delete(uuid) to authenticated;
grant execute on function public.catalog_create(text, text, numeric, numeric, boolean, uuid) to authenticated;
grant execute on function public.catalog_update(text, uuid, text, numeric, numeric, boolean, uuid) to authenticated;
