-- Add optional duration update to catalog_update for services.
-- duration must be a positive multiple of 15 (minutes); null = keep existing.
drop function if exists public.catalog_update(text, uuid, text, numeric, boolean, uuid);
create function public.catalog_update(
  p_kind text,
  p_item uuid,
  p_name text,
  p_price numeric,
  p_counts_toward_points boolean,
  p_category uuid,
  p_duration int default null
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
  if p_kind = 'service' and p_duration is not null then
    if p_duration <= 0 or p_duration % 15 <> 0 or p_duration > 480 then
      raise exception 'duration must be a positive multiple of 15 and at most 480 minutes';
    end if;
  end if;

  if p_kind = 'service' then
    update public.services
    set name = v_name,
        price = round(p_price, 2),
        counts_toward_points = coalesce(p_counts_toward_points, true),
        category_id = p_category,
        duration = coalesce(p_duration, duration)
    where id = p_item and branch_id = v_owner.branch_id
    returning jsonb_build_object(
      'id', id, 'name', name, 'price', price, 'category_id', category_id,
      'counts_toward_points', counts_toward_points, 'is_active', is_active,
      'duration', duration
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

revoke all on function public.catalog_update(text, uuid, text, numeric, boolean, uuid, int) from public, anon;
grant execute on function public.catalog_update(text, uuid, text, numeric, boolean, uuid, int) to authenticated;
