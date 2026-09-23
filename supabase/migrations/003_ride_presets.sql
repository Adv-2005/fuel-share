create table public.ride_presets (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  label text not null check (char_length(trim(label)) between 1 and 32),
  distance_m integer not null check (distance_m between 100 and 200000),
  is_pinned boolean not null default true,
  display_order smallint not null check (display_order >= 0),
  last_used_at timestamptz,
  usage_count integer not null default 0 check (usage_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, member_id, id)
);

create unique index ride_presets_member_label_unique
  on public.ride_presets (group_id, member_id, lower(trim(label)));
create index ride_presets_member_idx on public.ride_presets(member_id);
create index ride_presets_group_idx on public.ride_presets(group_id);
create index ride_presets_dashboard_order_idx
  on public.ride_presets(member_id, is_pinned, display_order);

create or replace function public.validate_ride_preset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  preset_count integer;
begin
  if tg_op = 'UPDATE' and (new.group_id <> old.group_id or new.member_id <> old.member_id) then
    raise exception 'A quick ride cannot be moved to another member or group.' using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from public.members
    where id = new.member_id and group_id = new.group_id
  ) then
    raise exception 'Preset member must belong to its group.' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    perform 1 from public.members where id = new.member_id for update;
    select count(*) into preset_count
    from public.ride_presets where member_id = new.member_id and group_id = new.group_id;
    if preset_count >= 6 then
      raise exception 'A member can have at most 6 quick rides.' using errcode = 'check_violation';
    end if;
  end if;

  new.label := trim(new.label);
  return new;
end;
$$;

create trigger ride_presets_validate before insert or update on public.ride_presets
  for each row execute function public.validate_ride_preset();
create trigger ride_presets_set_updated_at before update on public.ride_presets
  for each row execute function public.set_updated_at();

alter table public.rides
  add column preset_id uuid,
  add column preset_label text check (preset_label is null or char_length(preset_label) between 1 and 32),
  add constraint rides_preset_id_fkey foreign key (preset_id)
    references public.ride_presets(id) on delete set null;

create index rides_preset_id_idx on public.rides(preset_id);

create or replace function public.validate_ride_preset_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_label text;
begin
  if new.preset_id is null then return new; end if;
  select label into current_label
  from public.ride_presets
  where id = new.preset_id
    and group_id = new.group_id
    and member_id = new.rider_member_id;
  if current_label is null then
    raise exception 'Ride preset must belong to the rider in this group.' using errcode = 'check_violation';
  end if;
  new.preset_label := current_label;
  return new;
end;
$$;

create trigger rides_validate_preset before insert or update of preset_id on public.rides
  for each row execute function public.validate_ride_preset_reference();

alter table public.ride_presets enable row level security;

create policy ride_presets_select_own on public.ride_presets for select to authenticated
  using (public.is_own_member(member_id, group_id));
create policy ride_presets_insert_own on public.ride_presets for insert to authenticated
  with check (public.is_own_member(member_id, group_id));
create policy ride_presets_update_own on public.ride_presets for update to authenticated
  using (public.is_own_member(member_id, group_id))
  with check (public.is_own_member(member_id, group_id));
create policy ride_presets_delete_own on public.ride_presets for delete to authenticated
  using (public.is_own_member(member_id, group_id));

-- Deleting a preset nulls its reference without turning that metadata cleanup into
-- a financial correction. Any actual ride correction or soft delete is still audited.
create or replace function public.audit_ledger_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_type text;
begin
  if tg_table_name = 'rides'
    and old.preset_id is not null and new.preset_id is null
    and (to_jsonb(old) - 'preset_id' - 'updated_at') = (to_jsonb(new) - 'preset_id' - 'updated_at') then
    return new;
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

do $$
begin
  alter publication supabase_realtime add table public.ride_presets;
exception when duplicate_object then null;
end $$;
