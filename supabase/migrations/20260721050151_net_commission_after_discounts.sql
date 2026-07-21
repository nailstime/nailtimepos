-- Commission is based on actual money received.  A bill-level discount (and
-- future promotions) is allocated to each line in proportion to its gross
-- value, matching the member-points calculation at payment time.
create or replace function public.commission_report(p_month text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner public.staff%rowtype;
  v_mode text;
  v_result jsonb;
begin
  v_owner := private.require_staff(true);

  if p_month !~ '^\\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid month';
  end if;

  select mode into v_mode
  from public.commission_settings
  where branch_id = v_owner.branch_id
    and effective_month = p_month;
  v_mode := coalesce(v_mode, 'per_service');

  if v_mode = 'per_service' then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.technician), '[]'::jsonb)
      into v_result
    from (
      select
        s.name as technician,
        round(sum(oi.price_snapshot * oi.qty * o.total / nullif(o.subtotal, 0)), 2) as total_sales,
        round(sum(
          oi.price_snapshot * oi.qty * o.total / nullif(o.subtotal, 0)
          * oi.commission_pct_snapshot / 100
        ), 2) as commission,
        null::numeric as tier_pct
      from public.order_items oi
      join public.orders o on o.id = oi.order_id and o.status = 'paid'
      join public.staff s on s.id = oi.technician_id
      where o.branch_id = v_owner.branch_id
        and to_char(timezone('Asia/Bangkok', o.paid_at), 'YYYY-MM') = p_month
        and o.subtotal > 0
        and oi.item_type in ('service', 'product')
      group by s.id, s.name
    ) t;
  else
    select coalesce(jsonb_agg(to_jsonb(t) order by t.technician), '[]'::jsonb)
      into v_result
    from (
      with sales as (
        select
          s.id,
          s.name,
          sum(oi.price_snapshot * oi.qty * o.total / nullif(o.subtotal, 0)) as total_sales
        from public.order_items oi
        join public.orders o on o.id = oi.order_id and o.status = 'paid'
        join public.staff s on s.id = oi.technician_id
        where o.branch_id = v_owner.branch_id
          and to_char(timezone('Asia/Bangkok', o.paid_at), 'YYYY-MM') = p_month
          and o.subtotal > 0
          and oi.item_type in ('service', 'product')
        group by s.id, s.name
      )
      select
        sa.name as technician,
        round(sa.total_sales, 2) as total_sales,
        ct.pct as tier_pct,
        round(sa.total_sales * ct.pct / 100, 2) as commission
      from sales sa
      left join public.commission_tiers ct
        on ct.branch_id = v_owner.branch_id
       and ct.effective_month = p_month
       and sa.total_sales >= ct.min_amount
       and (ct.max_amount is null or sa.total_sales < ct.max_amount)
    ) t;
  end if;

  return jsonb_build_object('mode', v_mode, 'month', p_month, 'rows', v_result);
end;
$$;
