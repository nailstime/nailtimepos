-- Copy this file to seed.local.sql, replace every value below, and keep the
-- local file out of source control. Run it only after both migrations.

do $$
declare
  v_branch_code text := 'CHANGE_ME';
  v_branch_name text := 'CHANGE_ME';
  v_promptpay_id text := 'CHANGE_ME';
  v_owner_name text := 'CHANGE_ME';
  v_owner_pin text := 'CHANGE_ME';
  v_counter_code text := 'C1';
  v_display_token text := 'CHANGE_ME_USE_AT_LEAST_32_RANDOM_CHARACTERS';
  v_branch_id uuid;
begin
  if v_branch_code = 'CHANGE_ME'
     or v_branch_name = 'CHANGE_ME'
     or v_promptpay_id = 'CHANGE_ME'
     or v_owner_name = 'CHANGE_ME'
     or v_owner_pin = 'CHANGE_ME'
     or v_display_token like 'CHANGE_ME%' then
    raise exception 'replace every CHANGE_ME value before running this seed';
  end if;
  if v_owner_pin !~ '^\d{6}$' then
    raise exception 'owner PIN must contain exactly 6 digits';
  end if;
  if length(v_display_token) < 32 then
    raise exception 'display token must contain at least 32 characters';
  end if;

  insert into public.branches(code, name, promptpay_id)
  values (upper(v_branch_code), v_branch_name, v_promptpay_id)
  returning id into v_branch_id;

  insert into public.staff(branch_id, name, role, pin_hash)
  values (v_branch_id, v_owner_name, 'owner', crypt(v_owner_pin, gen_salt('bf')));

  insert into public.counters(branch_id, code, display_token_hash)
  values (v_branch_id, upper(v_counter_code), encode(digest(v_display_token, 'sha256'), 'hex'));

  insert into public.settings(branch_id, key, value)
  values (v_branch_id, 'point_threshold_baht', '1500');

  insert into public.services(
    branch_id, name, price, commission_pct, counts_toward_points, sort_order
  ) values
    (v_branch_id, 'ทำเล็บเจล', 450, 40, true, 1),
    (v_branch_id, 'เพ้นท์เล็บ', 200, 40, true, 2),
    (v_branch_id, 'ต่อเล็บเจล', 900, 40, true, 3),
    (v_branch_id, 'ถอดเจล', 200, 40, true, 4),
    (v_branch_id, 'สปามือ', 500, 40, true, 5),
    (v_branch_id, 'สปาเท้า', 650, 40, true, 6);
end;
$$;

-- Customer display URL:
-- https://YOUR_APP/display?counter=C1&token=THE_SAME_DISPLAY_TOKEN
