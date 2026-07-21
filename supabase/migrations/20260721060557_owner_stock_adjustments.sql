-- Manual stock corrections are owner-only, always require an explanation, and
-- flow through stock_movements so the existing trigger preserves the audit log
-- and never permits a negative on-hand quantity.
create or replace function public.adjust_stock(
  p_product uuid,
  p_qty_change integer,
  p_note text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner public.staff%rowtype;
  v_product public.products%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
begin
  v_owner := private.require_staff(true);

  if p_qty_change is null or p_qty_change = 0 or abs(p_qty_change) > 100000 then
    raise exception 'invalid stock adjustment quantity';
  end if;
  if length(v_note) not between 2 and 500 then
    raise exception 'stock adjustment reason is required';
  end if;

  select * into v_product
  from public.products
  where id = p_product and branch_id = v_owner.branch_id
  for update;
  if not found then raise exception 'product not found'; end if;
  if v_product.stock_qty + p_qty_change < 0 then
    raise exception 'stock adjustment would make stock negative';
  end if;

  insert into public.stock_movements(product_id, qty, type, staff_id, note)
  values (p_product, p_qty_change, 'adjust', v_owner.id, v_note);

  return v_product.stock_qty + p_qty_change;
end;
$$;

revoke execute on function public.adjust_stock(uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.adjust_stock(uuid, integer, text)
  to authenticated;
