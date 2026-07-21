-- Walk-in customers can become members at the counter without having LINE.
-- A later LIFF signup with the six-digit claim code binds the same record.
create or replace function public.create_pos_member(
  p_name text,
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff%rowtype;
  v_member public.members%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_created boolean := false;
begin
  v_staff := private.require_staff(false);
  if length(v_name) not between 1 and 160 then raise exception 'member name is invalid'; end if;
  if v_phone !~ '^\d{9,15}$' then raise exception 'member phone is invalid'; end if;

  insert into public.members(branch_id, name, phone)
  values (v_staff.branch_id, v_name, v_phone)
  on conflict (branch_id, phone) do nothing
  returning * into v_member;
  v_created := found;

  if not v_created then
    select * into v_member
    from public.members
    where branch_id = v_staff.branch_id and phone = v_phone;
  end if;

  return jsonb_build_object(
    'created', v_created,
    'member', jsonb_build_object(
      'id', v_member.id,
      'name', v_member.name,
      'phone', v_member.phone,
      'line_linked', v_member.line_user_id is not null,
      'points_balance', v_member.points_balance,
      'accumulated_baht', v_member.accumulated_baht
    )
  );
end;
$$;

-- A reward redemption creates a pending LINE confirmation. Do not allow an
-- unlinked member to start that flow, even if an API caller bypasses the POS.
create or replace function private.require_line_link_for_redemption()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.members m
    join public.orders o on o.id = new.order_id
    where m.id = new.member_id
      and m.branch_id = o.branch_id
      and m.line_user_id is not null
  ) then
    raise exception 'member must link LINE before redeeming rewards';
  end if;
  return new;
end;
$$;

drop trigger if exists redemptions_require_line_link on public.redemptions;
create trigger redemptions_require_line_link
before insert on public.redemptions
for each row execute function private.require_line_link_for_redemption();

revoke all on function private.require_line_link_for_redemption() from public;
revoke execute on function public.create_pos_member(text, text) from public, anon, authenticated;
grant execute on function public.create_pos_member(text, text) to authenticated;
