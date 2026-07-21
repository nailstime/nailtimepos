-- Legacy website services predate the POS branch model. In this single-branch
-- rollout, make them owned by MAIN so owner-scoped catalog RPCs can manage them.
update public.services s
set branch_id = b.id
from public.branches b
where s.branch_id is null
  and b.code = 'MAIN';

create or replace function public.catalog_update(
  p_kind text,
  p_item uuid,
  p_name text,
  p_price numeric,
  p_commission_pct numeric,
  p_counts_toward_points boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
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
  if p_commission_pct is null or p_commission_pct < 0 or p_commission_pct > 100 then
    raise exception 'catalog commission is invalid';
  end if;

  if p_kind = 'service' then
    update public.services
    set name = v_name,
        price = round(p_price, 2),
        commission_pct = round(p_commission_pct, 2),
        counts_toward_points = coalesce(p_counts_toward_points, true)
    where id = p_item and branch_id = v_owner.branch_id
    returning jsonb_build_object(
      'id', id, 'name', name, 'price', price,
      'commission_pct', commission_pct,
      'counts_toward_points', counts_toward_points,
      'is_active', is_active
    ) into v_result;
  else
    update public.products
    set name = v_name,
        price = round(p_price, 2),
        commission_pct = round(p_commission_pct, 2),
        counts_toward_points = coalesce(p_counts_toward_points, true)
    where id = p_item and branch_id = v_owner.branch_id
    returning jsonb_build_object(
      'id', id, 'name', name, 'price', price,
      'commission_pct', commission_pct,
      'counts_toward_points', counts_toward_points,
      'active', active
    ) into v_result;
  end if;

  if v_result is null then raise exception 'catalog item not found'; end if;
  return v_result;
exception
  when unique_violation then raise exception 'catalog name already exists';
end;
$$;

revoke execute on function public.catalog_update(text, uuid, text, numeric, numeric, boolean)
  from public, anon, authenticated;
grant execute on function public.catalog_update(text, uuid, text, numeric, numeric, boolean)
  to authenticated;
