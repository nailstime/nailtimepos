
-- Lists selectable counters for the active staff member's branch without
-- exposing customer-display tokens or counter configuration controls.
create or replace function public.list_pos_counters()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_staff public.staff%rowtype;
begin
  v_staff := private.require_staff(false);

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'code', c.code,
          'has_open_order', c.current_order_id is not null,
          'active_order_no', o.order_no
        )
        order by c.code
      ),
      '[]'::jsonb
    )
    from public.counters c
    left join public.orders o
      on o.id = c.current_order_id
      and o.branch_id = v_staff.branch_id
      and o.status = 'awaiting_payment'
    where c.branch_id = v_staff.branch_id
  );
end;
$$;

revoke all on function public.list_pos_counters() from public, anon;
grant execute on function public.list_pos_counters() to authenticated;

comment on function public.list_pos_counters() is
  'Lists counters in the authenticated staff member branch for POS selection.';
