-- Keep 004 immutable because it may already be deployed. Replacing these
-- functions updates existing databases and also leaves fresh installs correct.
create or replace function public.validate_ride_preset_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_label text;
begin
  if tg_op = 'UPDATE' then
    if new.preset_id is distinct from old.preset_id then
      if new.preset_id is null then
        new.preset_label := old.preset_label;
        return new;
      end if;
      raise exception 'A ride preset cannot be changed after a ride is logged.'
        using errcode = 'check_violation';
    end if;

    if new.preset_id is null then
      new.preset_label := old.preset_label;
      return new;
    end if;
  elsif new.preset_id is null then
    new.preset_label := null;
    return new;
  end if;

  select label into current_label
  from public.ride_presets
  where id = new.preset_id
    and group_id = new.group_id
    and member_id = new.rider_member_id;
  if current_label is null then
    raise exception 'Ride preset must belong to the rider in this group.' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    new.preset_label := current_label;
  else
    new.preset_label := old.preset_label;
  end if;
  return new;
end;
$$;

drop trigger if exists rides_validate_preset on public.rides;
create trigger rides_validate_preset before insert or update of preset_id, preset_label on public.rides
  for each row execute function public.validate_ride_preset_reference();

create or replace function public.audit_ledger_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_type text;
begin
  if tg_table_name = 'rides' then
    if old.preset_id is not null and new.preset_id is null
      and (to_jsonb(old) - 'preset_id' - 'updated_at') = (to_jsonb(new) - 'preset_id' - 'updated_at') then
      return new;
    end if;
  end if;

  event_type := case tg_table_name
    when 'fuel_purchases' then 'fuel_purchase'
    when 'rides' then 'ride'
    else 'payment'
  end;
  insert into public.event_revisions(group_id, entity_type, entity_id, changed_by_user_id, previous_data)
  values (old.group_id, event_type, old.id, auth.uid(), to_jsonb(old));
  return new;
end;
$$;
