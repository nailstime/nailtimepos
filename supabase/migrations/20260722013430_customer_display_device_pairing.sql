-- Customer Display devices must survive being installed as a PWA.  A QR link
-- remains a convenient bootstrap option, while this pairing flow gives every
-- installed display its own revocable credential.

create table public.customer_display_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  counter_id uuid not null references public.counters(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by_staff_id uuid not null references public.staff(id),
  created_at timestamptz not null default now()
);

create index customer_display_pairing_codes_counter_active_idx
  on public.customer_display_pairing_codes(counter_id, expires_at)
  where used_at is null;

create table public.customer_display_devices (
  id uuid primary key default gen_random_uuid(),
  counter_id uuid not null references public.counters(id) on delete cascade,
  device_token_hash text not null unique,
  paired_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index customer_display_devices_counter_active_idx
  on public.customer_display_devices(counter_id)
  where revoked_at is null;

alter table public.customer_display_pairing_codes enable row level security;
alter table public.customer_display_devices enable row level security;

create or replace function public.create_customer_display_pairing_code(p_counter uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_owner public.staff%rowtype;
  v_counter public.counters%rowtype;
  v_code text := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 8));
begin
  v_owner := private.require_staff(true);

  select * into v_counter
  from public.counters
  where id = p_counter and branch_id = v_owner.branch_id
  for update;
  if not found then
    raise exception 'counter not found';
  end if;

  -- There is only one usable code for each counter.  Creating another one
  -- immediately invalidates the prior code, including an expired one.
  delete from public.customer_display_pairing_codes
  where counter_id = v_counter.id and used_at is null;

  insert into public.customer_display_pairing_codes(
    counter_id, code_hash, expires_at, created_by_staff_id
  ) values (
    v_counter.id,
    encode(digest(v_code, 'sha256'), 'hex'),
    now() + interval '10 minutes',
    v_owner.id
  );

  return jsonb_build_object(
    'code', v_counter.code,
    'pairing_code', v_code,
    'expires_at', now() + interval '10 minutes'
  );
end;
$$;

-- This endpoint deliberately permits anon access: the high-entropy, short
-- lived pairing code is the authorization factor.  It returns only a new
-- opaque device credential and never exposes business or customer data.
create or replace function public.pair_customer_display(
  p_counter_code text,
  p_pairing_code text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_counter_code text := upper(btrim(coalesce(p_counter_code, '')));
  v_pairing_code text := upper(btrim(coalesce(p_pairing_code, '')));
  v_pairing public.customer_display_pairing_codes%rowtype;
  v_counter public.counters%rowtype;
  v_device_token text := encode(gen_random_bytes(32), 'hex');
begin
  if v_counter_code !~ '^[A-Z0-9_-]{1,20}$' then
    raise exception 'invalid counter code';
  end if;
  if v_pairing_code !~ '^[A-F0-9]{8}$' then
    raise exception 'invalid pairing code';
  end if;

  select pc.* into v_pairing
  from public.customer_display_pairing_codes pc
  join public.counters c on c.id = pc.counter_id
  join public.branches b on b.id = c.branch_id and b.active
  where c.code = v_counter_code
    and pc.code_hash = encode(digest(v_pairing_code, 'sha256'), 'hex')
    and pc.used_at is null
    and pc.expires_at > now()
  for update of pc;
  if not found then
    raise exception 'pairing code is invalid or expired';
  end if;

  update public.customer_display_pairing_codes
  set used_at = now()
  where id = v_pairing.id;

  select * into v_counter from public.counters where id = v_pairing.counter_id;
  insert into public.customer_display_devices(counter_id, device_token_hash)
  values (v_counter.id, encode(digest(v_device_token, 'sha256'), 'hex'));

  return jsonb_build_object('counter_code', v_counter.code, 'device_token', v_device_token);
end;
$$;

create or replace function public.rotate_counter_display_token(p_counter uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_owner public.staff%rowtype;
  v_counter public.counters%rowtype;
  v_token text := encode(gen_random_bytes(32), 'hex');
begin
  v_owner := private.require_staff(true);
  select * into v_counter
  from public.counters
  where id = p_counter and branch_id = v_owner.branch_id
  for update;
  if not found then
    raise exception 'counter not found';
  end if;

  update public.counters
  set display_token_hash = encode(digest(v_token, 'sha256'), 'hex')
  where id = v_counter.id;

  -- Rotating the QR token is an emergency reset for every paired display too.
  update public.customer_display_devices
  set revoked_at = now()
  where counter_id = v_counter.id and revoked_at is null;

  return jsonb_build_object('id', v_counter.id, 'code', v_counter.code, 'display_token', v_token);
end;
$$;

create or replace function public.get_customer_display(p_counter_code text, p_display_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_counter public.counters%rowtype;
  v_branch public.branches%rowtype;
  v_order public.orders%rowtype;
  v_media_type text := 'artwork';
  v_media_path text;
  v_campaign jsonb;
  v_token_hash text := encode(digest(coalesce(p_display_token, ''), 'sha256'), 'hex');
begin
  select c.* into v_counter
  from public.counters c
  join public.branches b on b.id = c.branch_id and b.active
  where c.code = upper(btrim(coalesce(p_counter_code, '')))
    and (
      c.display_token_hash = v_token_hash
      or exists (
        select 1
        from public.customer_display_devices d
        where d.counter_id = c.id
          and d.device_token_hash = v_token_hash
          and d.revoked_at is null
      )
    )
  limit 1;
  if not found then return null; end if;

  select * into v_branch from public.branches where id = v_counter.branch_id;
  select
    coalesce(max(s.value) filter (where s.key = 'customer_display_media_type'), 'artwork'),
    nullif(max(s.value) filter (where s.key = 'customer_display_media_path'), '')
  into v_media_type, v_media_path
  from public.settings s
  where s.branch_id = v_counter.branch_id
    and s.key in ('customer_display_media_type', 'customer_display_media_path');

  if v_media_type not in ('artwork', 'image', 'video') or v_media_path is null then
    v_media_type := 'artwork';
    v_media_path := null;
  end if;
  v_campaign := jsonb_build_object('type', v_media_type, 'path', v_media_path);

  if v_counter.current_order_id is null then
    return jsonb_build_object(
      'branch', jsonb_build_object('name', v_branch.name),
      'order', null,
      'campaign', v_campaign
    );
  end if;

  select * into v_order from public.orders where id = v_counter.current_order_id;
  if not found then
    return jsonb_build_object(
      'branch', jsonb_build_object('name', v_branch.name),
      'order', null,
      'campaign', v_campaign
    );
  end if;

  return jsonb_build_object(
    'branch', jsonb_build_object('name', v_branch.name, 'promptpay_id', v_branch.promptpay_id),
    'order', jsonb_build_object(
      'id', v_order.id, 'order_no', v_order.order_no, 'status', v_order.status,
      'subtotal', v_order.subtotal, 'discount', v_order.discount, 'total', v_order.total
    ),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', oi.id, 'name', oi.name_snapshot, 'qty', oi.qty, 'price', oi.price_snapshot
      ) order by oi.id), '[]'::jsonb)
      from public.order_items oi where oi.order_id = v_order.id
    ),
    'member', (
      select jsonb_build_object(
        'name', m.name, 'points_balance', m.points_balance, 'accumulated_baht', m.accumulated_baht
      ) from public.members m where m.id = v_order.member_id
    ),
    'campaign', v_campaign
  );
end;
$$;

revoke all on table public.customer_display_pairing_codes from public, anon, authenticated;
revoke all on table public.customer_display_devices from public, anon, authenticated;
revoke all on function public.create_customer_display_pairing_code(uuid) from public, anon;
revoke all on function public.pair_customer_display(text, text) from public, authenticated;
revoke all on function public.rotate_counter_display_token(uuid) from public, anon;

grant execute on function public.create_customer_display_pairing_code(uuid) to authenticated;
grant execute on function public.pair_customer_display(text, text) to anon, authenticated;
grant execute on function public.rotate_counter_display_token(uuid) to authenticated;
