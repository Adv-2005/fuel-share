alter table public.fuel_purchases
  add column if not exists is_full_tank boolean not null default false;

create or replace function public.assert_valid_tank_timeline(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  capacity integer;
  balance bigint := 0;
  tank_event record;
begin
  select tank_capacity_ml into capacity from public.groups where id = p_group_id;

  for tank_event in
    select id, occurred_at, 0 as priority, 'fuel' as event_type,
      volume_ml::bigint as volume_ml, is_full_tank
    from public.fuel_purchases
    where group_id = p_group_id and deleted_at is null
    union all
    select id, occurred_at, 1 as priority, 'ride' as event_type,
      consumed_ml::bigint as volume_ml, false as is_full_tank
    from public.rides
    where group_id = p_group_id and deleted_at is null
    order by occurred_at, priority, id
  loop
    if tank_event.event_type = 'fuel' then
      if tank_event.is_full_tank then
        if tank_event.volume_ml > capacity then
          raise exception 'This refill is larger than the configured tank capacity.' using errcode = 'check_violation';
        end if;
        balance := capacity;
      else
        balance := balance + tank_event.volume_ml;
      end if;
    else
      balance := balance - tank_event.volume_ml;
    end if;

    if balance < 0 then
      raise exception 'This change would make the estimated tank go below zero.' using errcode = 'check_violation';
    end if;
    if balance > capacity then
      raise exception 'This change would put the estimated tank above its configured capacity.' using errcode = 'check_violation';
    end if;
  end loop;
end;
$$;
