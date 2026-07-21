-- Owner-only receipt history and customer CRM analytics.

alter table public.members add column birth_date date;

alter table public.members
  add constraint members_birth_date_min_check
  check (birth_date is null or birth_date >= date '1900-01-01');

create index orders_branch_activity_idx
  on public.orders(branch_id, (coalesce(paid_at, created_at)) desc, id desc);
create index orders_branch_status_activity_idx
  on public.orders(branch_id, status, (coalesce(paid_at, created_at)) desc, id desc);
create index members_branch_joined_idx
  on public.members(branch_id, joined_at desc, id desc);

create or replace function public.admin_search_receipts(
  p_query text default null,
  p_status text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_limit integer default 30,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner public.staff%rowtype;
  v_limit integer;
  v_query text;
  v_start timestamptz;
  v_end timestamptz;
  v_items jsonb;
begin
  v_owner := private.require_staff(true);
  v_limit := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_query := nullif(btrim(p_query), '');
  if p_status is not null and p_status not in ('draft', 'awaiting_payment', 'paid', 'void') then
    raise exception 'invalid order status';
  end if;
  if p_date_from is not null and p_date_to is not null and p_date_to < p_date_from then
    raise exception 'date range is invalid';
  end if;
  if (p_cursor_at is null) <> (p_cursor_id is null) then
    raise exception 'receipt cursor is incomplete';
  end if;

  v_start := case when p_date_from is null then null
    else p_date_from::timestamp at time zone 'Asia/Bangkok' end;
  v_end := case when p_date_to is null then null
    else (p_date_to + 1)::timestamp at time zone 'Asia/Bangkok' end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', x.id,
    'order_no', x.order_no,
    'status', x.status,
    'subtotal', x.subtotal,
    'discount', x.discount,
    'total', x.total,
    'created_at', x.created_at,
    'paid_at', x.paid_at,
    'activity_at', x.activity_at,
    'member_id', x.member_id,
    'member_name', x.member_name,
    'member_phone', x.member_phone,
    'opened_by', x.opened_by,
    'payment_method', x.payment_method,
    'payment_status', x.payment_status,
    'confirmed_by', x.confirmed_by,
    'item_count', x.item_count,
    'void_reason', x.void_reason
  ) order by x.activity_at desc, x.id desc), '[]'::jsonb)
  into v_items
  from (
    select
      o.id, o.order_no, o.status, o.subtotal, o.discount, o.total,
      o.created_at, o.paid_at, coalesce(o.paid_at, o.created_at) as activity_at,
      o.member_id, m.name as member_name, m.phone as member_phone,
      opener.name as opened_by, p.method as payment_method, p.status as payment_status,
      confirmer.name as confirmed_by, coalesce(item_stats.item_count, 0) as item_count,
      o.void_reason
    from public.orders o
    join public.staff opener on opener.id = o.opened_by_staff_id
    left join public.members m on m.id = o.member_id
    left join public.payments p on p.order_id = o.id
    left join public.staff confirmer on confirmer.id = p.confirmed_by_staff_id
    left join lateral (
      select coalesce(sum(oi.qty), 0)::integer as item_count
      from public.order_items oi
      where oi.order_id = o.id
    ) item_stats on true
    where o.branch_id = v_owner.branch_id
      and (p_status is null or o.status = p_status)
      and (v_start is null or coalesce(o.paid_at, o.created_at) >= v_start)
      and (v_end is null or coalesce(o.paid_at, o.created_at) < v_end)
      and (
        v_query is null
        or o.order_no ilike '%' || v_query || '%'
        or m.name ilike '%' || v_query || '%'
        or m.phone ilike '%' || v_query || '%'
      )
      and (
        p_cursor_at is null
        or (coalesce(o.paid_at, o.created_at), o.id) < (p_cursor_at, p_cursor_id)
      )
    order by coalesce(o.paid_at, o.created_at) desc, o.id desc
    limit v_limit
  ) x;

  return jsonb_build_object('items', v_items, 'limit', v_limit);
end;
$$;

create or replace function public.admin_receipt_detail(p_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner public.staff%rowtype;
  v_result jsonb;
begin
  v_owner := private.require_staff(true);

  select jsonb_build_object(
    'order', jsonb_build_object(
      'id', o.id,
      'order_no', o.order_no,
      'status', o.status,
      'subtotal', o.subtotal,
      'discount', o.discount,
      'total', o.total,
      'created_at', o.created_at,
      'paid_at', o.paid_at,
      'points_awarded', o.points_awarded,
      'void_reason', o.void_reason
    ),
    'branch', jsonb_build_object('id', b.id, 'code', b.code, 'name', b.name),
    'member', case when m.id is null then null else jsonb_build_object(
      'id', m.id, 'name', m.name, 'phone', m.phone, 'birth_date', m.birth_date
    ) end,
    'staff', jsonb_build_object(
      'opened_by', opener.name,
      'void_approved_by', voider.name
    ),
    'payment', case when p.id is null then null else jsonb_build_object(
      'id', p.id,
      'method', p.method,
      'amount', p.amount,
      'status', p.status,
      'confirmed_at', p.confirmed_at,
      'confirmed_by', confirmer.name,
      'verified', p.verified
    ) end,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', oi.id,
        'item_type', oi.item_type,
        'name', oi.name_snapshot,
        'price', oi.price_snapshot,
        'qty', oi.qty,
        'line_total', oi.price_snapshot * oi.qty,
        'technician_id', oi.technician_id,
        'technician', technician.name
      ) order by oi.id)
      from public.order_items oi
      join public.staff technician on technician.id = oi.technician_id
      where oi.order_id = o.id
    ), '[]'::jsonb)
  ) into v_result
  from public.orders o
  join public.branches b on b.id = o.branch_id
  join public.staff opener on opener.id = o.opened_by_staff_id
  left join public.staff voider on voider.id = o.void_approved_by
  left join public.members m on m.id = o.member_id
  left join public.payments p on p.order_id = o.id
  left join public.staff confirmer on confirmer.id = p.confirmed_by_staff_id
  where o.id = p_order and o.branch_id = v_owner.branch_id;

  if v_result is null then raise exception 'receipt not found'; end if;
  return v_result;
end;
$$;

create or replace function public.admin_search_customers(
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
  v_owner public.staff%rowtype;
  v_limit integer;
  v_query text;
  v_items jsonb;
begin
  v_owner := private.require_staff(true);
  v_limit := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_query := nullif(btrim(p_query), '');
  if (p_cursor_joined_at is null) <> (p_cursor_id is null) then
    raise exception 'customer cursor is incomplete';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', x.id,
    'name', x.name,
    'phone', x.phone,
    'birth_date', x.birth_date,
    'line_linked', x.line_user_id is not null,
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
      m.id, m.name, m.phone, m.birth_date, m.line_user_id,
      m.points_balance, m.joined_at,
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
    where m.branch_id = v_owner.branch_id
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

create or replace function public.admin_customer_detail(p_member uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner public.staff%rowtype;
  v_member public.members%rowtype;
  v_paid_bills integer := 0;
  v_lifetime numeric(14,2) := 0;
  v_average numeric(14,2) := 0;
  v_first_visit timestamptz;
  v_last_visit timestamptz;
  v_favorites jsonb := '[]'::jsonb;
  v_receipts jsonb := '[]'::jsonb;
begin
  v_owner := private.require_staff(true);
  select * into v_member
  from public.members
  where id = p_member and branch_id = v_owner.branch_id;
  if not found then raise exception 'customer not found'; end if;

  select
    count(*)::integer,
    coalesce(sum(total), 0),
    coalesce(avg(total), 0),
    min(paid_at),
    max(paid_at)
  into v_paid_bills, v_lifetime, v_average, v_first_visit, v_last_visit
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
    'id', r.id,
    'order_no', r.order_no,
    'total', r.total,
    'paid_at', r.paid_at,
    'payment_method', r.payment_method,
    'item_count', r.item_count
  ) order by r.paid_at desc, r.id desc), '[]'::jsonb)
  into v_receipts
  from (
    select o.id, o.order_no, o.total, o.paid_at, p.method as payment_method,
      coalesce(sum(oi.qty), 0)::integer as item_count
    from public.orders o
    left join public.payments p on p.order_id = o.id
    left join public.order_items oi on oi.order_id = o.id
    where o.member_id = v_member.id and o.status = 'paid'
    group by o.id, p.method
    order by o.paid_at desc, o.id desc
    limit 50
  ) r;

  return jsonb_build_object(
    'member', jsonb_build_object(
      'id', v_member.id,
      'name', v_member.name,
      'phone', v_member.phone,
      'birth_date', v_member.birth_date,
      'line_linked', v_member.line_user_id is not null,
      'points_balance', v_member.points_balance,
      'accumulated_baht', v_member.accumulated_baht,
      'joined_at', v_member.joined_at
    ),
    'stats', jsonb_build_object(
      'paid_bills', v_paid_bills,
      'lifetime_spend', v_lifetime,
      'average_ticket', round(v_average, 2),
      'first_visit', v_first_visit,
      'last_visit', v_last_visit
    ),
    'favorite_services', v_favorites,
    'receipts', v_receipts
  );
end;
$$;

create or replace function public.admin_update_member_profile(
  p_member uuid,
  p_name text,
  p_phone text,
  p_birth_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner public.staff%rowtype;
  v_member public.members%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_today date := timezone('Asia/Bangkok', now())::date;
begin
  v_owner := private.require_staff(true);
  if length(v_name) not between 1 and 160 then raise exception 'member name is invalid'; end if;
  if v_phone !~ '^\d{9,15}$' then raise exception 'member phone is invalid'; end if;
  if p_birth_date is not null and (p_birth_date < date '1900-01-01' or p_birth_date > v_today) then
    raise exception 'birth date is invalid';
  end if;

  select * into v_member
  from public.members
  where id = p_member and branch_id = v_owner.branch_id
  for update;
  if not found then raise exception 'customer not found'; end if;

  update public.members
  set name = v_name, phone = v_phone, birth_date = p_birth_date
  where id = v_member.id
  returning * into v_member;

  if v_member.profile_id is not null then
    update public.profiles
    set full_name = v_name, phone = v_phone
    where id = v_member.profile_id;
  end if;

  return jsonb_build_object(
    'id', v_member.id,
    'name', v_member.name,
    'phone', v_member.phone,
    'birth_date', v_member.birth_date
  );
exception
  when unique_violation then raise exception 'member phone already exists';
end;
$$;

-- Birthday is owner-only personal data. Existing staff queries keep access to
-- operational member fields but cannot select the new column directly.
revoke select on public.members from authenticated;
grant select (
  id, profile_id, branch_id, name, phone, line_user_id,
  accumulated_baht, points_balance, joined_at
) on public.members to authenticated;

revoke execute on function public.admin_search_receipts(text, text, date, date, integer, timestamptz, uuid)
  from public, anon, authenticated;
revoke execute on function public.admin_receipt_detail(uuid)
  from public, anon, authenticated;
revoke execute on function public.admin_search_customers(text, integer, timestamptz, uuid)
  from public, anon, authenticated;
revoke execute on function public.admin_customer_detail(uuid)
  from public, anon, authenticated;
revoke execute on function public.admin_update_member_profile(uuid, text, text, date)
  from public, anon, authenticated;

grant execute on function public.admin_search_receipts(text, text, date, date, integer, timestamptz, uuid)
  to authenticated;
grant execute on function public.admin_receipt_detail(uuid)
  to authenticated;
grant execute on function public.admin_search_customers(text, integer, timestamptz, uuid)
  to authenticated;
grant execute on function public.admin_customer_detail(uuid)
  to authenticated;
grant execute on function public.admin_update_member_profile(uuid, text, text, date)
  to authenticated;
