-- Staff-facing customer insights. This keeps receipt detail and reprint controls
-- owner-only while still giving the service team useful, branch-scoped context.

create table public.customer_notes (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  note text not null check (char_length(btrim(note)) between 1 and 500),
  created_by_staff_id uuid not null references public.staff(id),
  created_at timestamptz not null default now()
);

create index customer_notes_member_created_idx
  on public.customer_notes (member_id, created_at desc);

create index customer_notes_created_by_staff_idx
  on public.customer_notes (created_by_staff_id);

alter table public.customer_notes enable row level security;

-- Direct reads are limited to the authenticated staff member's own branch.
-- Inserts go through the RPC below so the author and branch cannot be forged.
create policy customer_notes_branch_read on public.customer_notes
  for select to authenticated
  using (branch_id = (select private.current_branch_id()));

create or replace function public.staff_search_customers(
  p_query text default null,
  p_limit integer default 30,
  p_cursor_joined_at timestamptz default null,
  p_cursor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff%rowtype;
  v_limit integer;
  v_query text;
  v_items jsonb;
begin
  v_staff := private.require_staff(false);
  v_limit := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_query := nullif(btrim(p_query), '');

  if (p_cursor_joined_at is null) <> (p_cursor_id is null) then
    raise exception 'customer cursor is incomplete';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', x.id,
    'name', x.name,
    'phone', x.phone,
    'line_linked', x.line_linked,
    'points_balance', x.points_balance,
    'joined_at', x.joined_at,
    'paid_bills', x.paid_bills,
    'lifetime_spend', x.lifetime_spend,
    'last_visit', x.last_visit,
    'favorite_service', x.favorite_service,
    'favorite_service_count', x.favorite_service_count
  ) order by x.joined_at desc, x.id desc), '[]'::jsonb)
  into v_items
  from (
    select
      m.id,
      m.name,
      m.phone,
      m.line_user_id is not null as line_linked,
      m.points_balance,
      m.joined_at,
      coalesce(stats.paid_bills, 0) as paid_bills,
      coalesce(stats.lifetime_spend, 0) as lifetime_spend,
      stats.last_visit,
      favorite.name as favorite_service,
      coalesce(favorite.usage_count, 0) as favorite_service_count
    from public.members m
    left join lateral (
      select
        count(*)::integer as paid_bills,
        coalesce(sum(o.total), 0) as lifetime_spend,
        max(o.paid_at) as last_visit
      from public.orders o
      where o.member_id = m.id and o.status = 'paid'
    ) stats on true
    left join lateral (
      select oi.name_snapshot as name, sum(oi.qty)::integer as usage_count
      from public.orders o
      join public.order_items oi on oi.order_id = o.id and oi.item_type = 'service'
      where o.member_id = m.id and o.status = 'paid'
      group by oi.name_snapshot
      order by sum(oi.qty) desc, max(o.paid_at) desc
      limit 1
    ) favorite on true
    where m.branch_id = v_staff.branch_id
      and (
        v_query is null
        or m.name ilike '%' || v_query || '%'
        or m.phone ilike '%' || v_query || '%'
      )
      and (
        p_cursor_joined_at is null
        or (m.joined_at, m.id) < (p_cursor_joined_at, p_cursor_id)
      )
    order by m.joined_at desc, m.id desc
    limit v_limit
  ) x;

  return jsonb_build_object('items', v_items, 'limit', v_limit);
end;
$$;

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

  -- No order id or receipt route is returned: this is a service reference only.
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
    'created_by', s.name
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

create or replace function public.staff_add_customer_note(
  p_member uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
  v_row public.customer_notes%rowtype;
begin
  v_staff := private.require_staff(false);

  if char_length(v_note) not between 1 and 500 then
    raise exception 'note must be between 1 and 500 characters';
  end if;

  perform 1
  from public.members
  where id = p_member and branch_id = v_staff.branch_id;
  if not found then raise exception 'customer not found'; end if;

  insert into public.customer_notes (branch_id, member_id, note, created_by_staff_id)
  values (v_staff.branch_id, p_member, v_note, v_staff.id)
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'note', v_row.note,
    'created_at', v_row.created_at,
    'created_by', v_staff.name
  );
end;
$$;

revoke all on table public.customer_notes from public, anon, authenticated;
grant select on table public.customer_notes to authenticated;

revoke execute on function public.staff_search_customers(text, integer, timestamptz, uuid)
  from public, anon, authenticated;
revoke execute on function public.staff_customer_detail(uuid)
  from public, anon, authenticated;
revoke execute on function public.staff_add_customer_note(uuid, text)
  from public, anon, authenticated;

grant execute on function public.staff_search_customers(text, integer, timestamptz, uuid)
  to authenticated;
grant execute on function public.staff_customer_detail(uuid)
  to authenticated;
grant execute on function public.staff_add_customer_note(uuid, text)
  to authenticated;
