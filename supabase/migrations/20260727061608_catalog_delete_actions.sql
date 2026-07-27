-- Permanent catalog deletion is allowed only when no operational history
-- depends on the item.  Historical records are intentionally protected.

create or replace function public.catalog_delete(p_kind text, p_item uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner public.staff%rowtype;
  v_count integer := 0;
begin
  v_owner := private.require_staff(true);
  if p_kind = 'service' then
    if exists (select 1 from public.order_items where service_id = p_item)
      or exists (select 1 from public.bookings where service_id = p_item) then
      raise exception 'service has history and cannot be deleted; disable it instead';
    end if;
    delete from public.services where id = p_item and branch_id = v_owner.branch_id;
    get diagnostics v_count = row_count;
  elsif p_kind = 'product' then
    if exists (select 1 from public.order_items where product_id = p_item)
      or exists (select 1 from public.stock_movements where product_id = p_item)
      or exists (select 1 from public.products where id = p_item and stock_qty <> 0) then
      raise exception 'product has sales or stock history and cannot be deleted; disable it instead';
    end if;
    delete from public.products where id = p_item and branch_id = v_owner.branch_id;
    get diagnostics v_count = row_count;
  else
    raise exception 'invalid catalog kind';
  end if;
  if v_count = 0 then raise exception 'catalog item not found'; end if;
  return true;
end;
$$;

create or replace function public.promotion_delete(p_promotion uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_owner public.staff%rowtype;
  v_count integer := 0;
begin
  v_owner := private.require_staff(true);
  -- Orders retain their immutable promotion snapshot. The FK is ON DELETE SET
  -- NULL, so removing a configuration never changes historic receipts.
  delete from public.promotions where id = p_promotion and branch_id = v_owner.branch_id;
  get diagnostics v_count = row_count;
  if v_count = 0 then raise exception 'promotion not found'; end if;
  return true;
end;
$$;

revoke all on function public.catalog_delete(text, uuid) from public, anon;
revoke all on function public.promotion_delete(uuid) from public, anon;
grant execute on function public.catalog_delete(text, uuid) to authenticated;
grant execute on function public.promotion_delete(uuid) to authenticated;
