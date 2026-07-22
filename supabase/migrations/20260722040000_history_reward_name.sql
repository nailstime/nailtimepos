-- Add reward_name to history entries for redemption source types
create or replace function public.line_get_member(p_line_user_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_member public.members%rowtype; v_threshold numeric;
begin
  select * into v_member from public.members where line_user_id = p_line_user_id;
  if not found then return null; end if;
  select value::numeric into v_threshold from public.settings
  where branch_id = v_member.branch_id and key = 'point_threshold_baht';
  return jsonb_build_object(
    'member', jsonb_build_object(
      'id', v_member.id, 'name', v_member.name,
      'points_balance', v_member.points_balance,
      'accumulated_baht', v_member.accumulated_baht
    ),
    'threshold', v_threshold,
    'pending', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'reward', rw.name, 'points_cost', r.points_cost_snapshot
      ) order by r.created_at), '[]'::jsonb)
      from public.redemptions r
      join public.rewards rw on rw.id = r.reward_id
      join public.orders o on o.id = r.order_id and o.status = 'awaiting_payment'
      where r.member_id = v_member.id and r.status = 'pending'
    ),
    'history', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'change', x.change, 'source', x.source, 'at', x.created_at, 'reward_name', x.reward_name
      ) order by x.created_at desc), '[]'::jsonb)
      from (
        select pl.change, pl.source, pl.created_at, rw.name as reward_name
        from public.points_ledger pl
        left join public.redemptions rd on rd.id = pl.ref_redemption_id
        left join public.rewards rw on rw.id = rd.reward_id
        where pl.member_id = v_member.id
        order by pl.created_at desc
        limit 20
      ) x
    )
  );
end;
$$;
