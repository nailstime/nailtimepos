-- A paid POS receipt may be printed by the staff member who opened it, or by
-- the branch owner.  The function keeps the document payload to one order so
-- it can safely bypass the direct table policies used by the POS UI.
create or replace function public.get_pos_thermal_receipt(p_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff%rowtype;
  v_result jsonb;
begin
  v_staff := private.require_staff(false);

  select jsonb_build_object(
    'order', jsonb_build_object(
      'id', o.id,
      'order_no', o.order_no,
      'subtotal', o.subtotal,
      'discount', o.discount,
      'total', o.total,
      'created_at', o.created_at,
      'paid_at', o.paid_at
    ),
    'branch', jsonb_build_object('code', b.code, 'name', b.name),
    'member', case when m.id is null then null else jsonb_build_object(
      'name', m.name, 'phone', m.phone
    ) end,
    'payment', jsonb_build_object(
      'method', p.method,
      'amount', p.amount,
      'confirmed_at', p.confirmed_at
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', oi.name_snapshot,
        'qty', oi.qty,
        'line_total', oi.price_snapshot * oi.qty
      ) order by oi.id)
      from public.order_items oi
      where oi.order_id = o.id
    ), '[]'::jsonb)
  ) into v_result
  from public.orders o
  join public.branches b on b.id = o.branch_id
  left join public.members m on m.id = o.member_id
  join public.payments p on p.order_id = o.id and p.status = 'confirmed'
  where o.id = p_order
    and o.branch_id = v_staff.branch_id
    and o.status = 'paid'
    and (o.opened_by_staff_id = v_staff.id or v_staff.role = 'owner');

  if v_result is null then raise exception 'paid receipt not found'; end if;
  return v_result;
end;
$$;

-- SECURITY DEFINER functions receive no default public access.  The function
-- does its own active-staff and branch checks above, then only authenticated
-- POS sessions can invoke it.
revoke execute on function public.get_pos_thermal_receipt(uuid) from public, anon, authenticated;
grant execute on function public.get_pos_thermal_receipt(uuid) to authenticated;
