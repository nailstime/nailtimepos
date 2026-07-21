-- Notes are mutable only by their author, except that an Owner may correct or
-- remove any note in the branch. The client never receives a direct table grant.

create or replace function public.staff_customer_detail(p_member uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff%rowtype;
  v_member public.members%rowtype;
  v_paid_bills integer := 0;
  v_lifetime numeric(14,2) := 0;
  v_last_visit timestamptz;
  v_favorites jsonb := '[]'::jsonb;
  v_recent_visits jsonb := '[]'::jsonb;
  v_notes jsonb := '[]'::jsonb;
begin
  v_staff := private.require_staff(false);

  select * into v_member
  from public.members
  where id = p_member and branch_id = v_staff.branch_id;
  if not found then raise exception 'customer not found'; end if;

  select count(*)::integer, coalesce(sum(total), 0), max(paid_at)
  into v_paid_bills, v_lifetime, v_last_visit
  from public.orders
  where member_id = v_member.id and status = 'paid';

  select coalesce(jsonb_agg(jsonb_build_object(
    'name', f.name,
    'usage_count', f.usage_count,
    'total_spend', f.total_spend,
    'last_used_at', f.last_used_at
  ) order by f.usage_count desc, f.last_used_at desc), '[]'::jsonb)
  into v_favorites
  from (
    select
      oi.name_snapshot as name,
      sum(oi.qty)::integer as usage_count,
      sum(oi.price_snapshot * oi.qty) as total_spend,
      max(o.paid_at) as last_used_at
    from public.orders o
    join public.order_items oi on oi.order_id = o.id and oi.item_type = 'service'
    where o.member_id = v_member.id and o.status = 'paid'
    group by oi.name_snapshot
    order by sum(oi.qty) desc, max(o.paid_at) desc
    limit 5
  ) f;

  select coalesce(jsonb_agg(jsonb_build_object(
    'paid_at', r.paid_at,
    'total', r.total,
    'items', r.items
  ) order by r.paid_at desc), '[]'::jsonb)
  into v_recent_visits
  from (
    select
      o.paid_at,
      o.total,
      coalesce(string_agg(oi.name_snapshot || case when oi.qty > 1 then ' x' || oi.qty::text else '' end, ', ' order by oi.id), '') as items
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    where o.member_id = v_member.id and o.status = 'paid'
    group by o.id
    order by o.paid_at desc, o.id desc
    limit 12
  ) r;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id,
    'note', n.note,
    'created_at', n.created_at,
    'created_by', s.name,
    'can_delete', n.created_by_staff_id = v_staff.id or v_staff.role = 'owner'
  ) order by n.created_at desc, n.id desc), '[]'::jsonb)
  into v_notes
  from (
    select id, note, created_at, created_by_staff_id
    from public.customer_notes
    where member_id = v_member.id and branch_id = v_staff.branch_id
    order by created_at desc, id desc
    limit 50
  ) n
  join public.staff s on s.id = n.created_by_staff_id;

  return jsonb_build_object(
    'member', jsonb_build_object(
      'id', v_member.id,
      'name', v_member.name,
      'phone', v_member.phone,
      'line_linked', v_member.line_user_id is not null,
      'points_balance', v_member.points_balance,
      'accumulated_baht', v_member.accumulated_baht,
      'joined_at', v_member.joined_at
    ),
    'stats', jsonb_build_object(
      'paid_bills', v_paid_bills,
      'lifetime_spend', v_lifetime,
      'last_visit', v_last_visit
    ),
    'favorite_services', v_favorites,
    'recent_visits', v_recent_visits,
    'notes', v_notes
  );
end;
$$;

create or replace function public.staff_delete_customer_note(p_note uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff%rowtype;
  v_note public.customer_notes%rowtype;
begin
  v_staff := private.require_staff(false);

  select * into v_note
  from public.customer_notes
  where id = p_note and branch_id = v_staff.branch_id
  for update;
  if not found then raise exception 'customer note not found'; end if;

  if v_note.created_by_staff_id <> v_staff.id and v_staff.role <> 'owner' then
    raise exception 'you can only delete your own customer notes';
  end if;

  delete from public.customer_notes where id = v_note.id;
  return jsonb_build_object('id', v_note.id, 'deleted', true);
end;
$$;

revoke execute on function public.staff_customer_detail(uuid)
  from public, anon, authenticated;
revoke execute on function public.staff_delete_customer_note(uuid)
  from public, anon, authenticated;

grant execute on function public.staff_customer_detail(uuid)
  to authenticated;
grant execute on function public.staff_delete_customer_note(uuid)
  to authenticated;
