-- Returns the full stock movement history for a product,
-- joined with staff name, order number, and member name.
create or replace function public.get_product_stock_history(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller public.staff%rowtype;
  v_product public.products%rowtype;
  v_movements jsonb;
begin
  v_caller := private.require_staff(false);

  select * into v_product
  from public.products
  where id = p_product_id and branch_id = v_caller.branch_id;
  if not found then raise exception 'product not found'; end if;

  with ranked as (
    select
      sm.id,
      sm.qty,
      sm.type,
      sm.note,
      sm.created_at,
      st.name  as staff_name,
      o.order_no,
      m.name   as member_name
    from public.stock_movements sm
    left join public.staff       st on st.id = sm.staff_id
    left join public.orders       o on  o.id = sm.ref_order_id
    left join public.members      m on  m.id = o.member_id
    where sm.product_id = p_product_id
    order by sm.created_at desc
    limit 200
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',          r.id,
      'qty',         r.qty,
      'type',        r.type,
      'note',        r.note,
      'created_at',  r.created_at,
      'staff_name',  r.staff_name,
      'order_no',    r.order_no,
      'member_name', r.member_name
    ) order by r.created_at desc
  ), '[]'::jsonb)
  into v_movements
  from ranked r;

  return jsonb_build_object(
    'product', jsonb_build_object(
      'id',              v_product.id,
      'name',            v_product.name,
      'price',           v_product.price,
      'stock_qty',       v_product.stock_qty,
      'low_stock_alert', v_product.low_stock_alert,
      'active',          v_product.active
    ),
    'movements', v_movements
  );
end;
$$;

revoke all on function public.get_product_stock_history(uuid) from public, anon;
grant execute on function public.get_product_stock_history(uuid) to authenticated;
