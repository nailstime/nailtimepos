-- Add terminated status: once terminated a reward is hidden everywhere
-- (different from active=false which just hides from POS but still shows in admin).
alter table public.rewards add column if not exists terminated boolean not null default false;

create or replace function public.update_reward(
  p_reward uuid,
  p_name text,
  p_points_cost integer,
  p_description text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_owner public.staff%rowtype;
begin
  v_owner := private.require_staff(true);
  if length(btrim(coalesce(p_name, ''))) not between 1 and 160 then raise exception 'invalid reward name'; end if;
  if p_points_cost is null or p_points_cost <= 0 then raise exception 'invalid points cost'; end if;
  update public.rewards
  set name = btrim(p_name),
      points_cost = p_points_cost,
      description = nullif(btrim(coalesce(p_description, '')), '')
  where id = p_reward and branch_id = v_owner.branch_id and not terminated;
  if not found then raise exception 'reward not found'; end if;
end;
$$;

revoke all on function public.update_reward(uuid, text, integer, text) from public, anon;
grant execute on function public.update_reward(uuid, text, integer, text) to authenticated;

create or replace function public.terminate_reward(p_reward uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_owner public.staff%rowtype;
begin
  v_owner := private.require_staff(true);
  update public.rewards
  set terminated = true, active = false
  where id = p_reward and branch_id = v_owner.branch_id;
  if not found then raise exception 'reward not found'; end if;
end;
$$;

revoke all on function public.terminate_reward(uuid) from public, anon;
grant execute on function public.terminate_reward(uuid) to authenticated;
