-- Keep the established owner-only RPC, but allow one calendar year because
-- the dashboard switches to monthly visualization after 31 days.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.get_owner_dashboard_range(date, date)'::regprocedure)
  into v_definition;

  if v_definition is null then
    raise exception 'get_owner_dashboard_range(date, date) must exist before this migration';
  end if;

  v_definition := replace(v_definition, 'p_date_to - p_date_from > 92', 'p_date_to - p_date_from > 365');
  v_definition := replace(v_definition, 'date range cannot exceed 93 days', 'date range cannot exceed 366 days');
  execute v_definition;
end;
$$;

notify pgrst, 'reload schema';
