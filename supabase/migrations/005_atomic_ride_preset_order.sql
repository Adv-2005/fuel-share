create or replace function public.swap_ride_preset_order(
  p_preset_id uuid,
  p_target_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  preset_group_id uuid;
  preset_member_id uuid;
  preset_order smallint;
  target_group_id uuid;
  target_member_id uuid;
  target_order smallint;
begin
  if p_preset_id is null or p_target_id is null or p_preset_id = p_target_id then
    raise exception 'Two different quick rides are required.' using errcode = 'invalid_parameter_value';
  end if;

  -- Lock in UUID order so concurrent reorder requests cannot deadlock by taking
  -- the same two rows in opposite orders. RLS limits both rows to the caller.
  perform 1
  from public.ride_presets
  where id in (p_preset_id, p_target_id)
  order by id
  for update;

  select group_id, member_id, display_order
  into preset_group_id, preset_member_id, preset_order
  from public.ride_presets
  where id = p_preset_id;

  select group_id, member_id, display_order
  into target_group_id, target_member_id, target_order
  from public.ride_presets
  where id = p_target_id;

  if preset_group_id is null or target_group_id is null then
    raise exception 'Quick ride not found.' using errcode = 'no_data_found';
  end if;
  if preset_group_id <> target_group_id or preset_member_id <> target_member_id then
    raise exception 'Quick rides must belong to the same member and group.' using errcode = 'check_violation';
  end if;

  update public.ride_presets
  set display_order = case id
    when p_preset_id then target_order
    else preset_order
  end
  where id in (p_preset_id, p_target_id);
end;
$$;

revoke all on function public.swap_ride_preset_order(uuid, uuid) from public;
grant execute on function public.swap_ride_preset_order(uuid, uuid) to authenticated;
