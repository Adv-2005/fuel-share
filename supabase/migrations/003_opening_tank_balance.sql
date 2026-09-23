alter table public.groups
  add column if not exists setup_status text not null default 'complete'
  check (setup_status in ('pending', 'complete'));

alter table public.event_revisions drop constraint if exists event_revisions_entity_type_check;
alter table public.event_revisions add constraint event_revisions_entity_type_check
  check (entity_type in ('opening_balance', 'fuel_purchase', 'ride', 'payment'));

create table public.opening_balances (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  amount_paise integer not null check (amount_paise between 0 and 10000000),
  unit_price_paise_per_litre integer not null check (unit_price_paise_per_litre between 0 and 100000),
  volume_ml integer not null check (volume_ml between 0 and 50000),
  ownership_mode text not null check (ownership_mode in ('empty', 'single', 'equal', 'shared')),
  occurred_at timestamptz not null,
  note text not null default '' check (char_length(note) <= 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index opening_balances_one_active_per_group
  on public.opening_balances(group_id) where deleted_at is null;
create index opening_balances_group_time_idx on public.opening_balances(group_id, occurred_at);

create table public.opening_balance_owners (
  opening_balance_id uuid not null references public.opening_balances(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete restrict,
  share_basis_points integer not null check (share_basis_points between 1 and 10000),
  primary key (opening_balance_id, member_id)
);
create index opening_balance_owners_group_idx on public.opening_balance_owners(group_id);

alter table public.opening_balances enable row level security;
alter table public.opening_balance_owners enable row level security;

create policy opening_select_group on public.opening_balances for select to authenticated
  using (public.is_group_member(group_id));

create policy opening_owners_select_group on public.opening_balance_owners for select to authenticated
  using (public.is_group_member(group_id));

create trigger opening_set_updated_at before update on public.opening_balances
  for each row execute function public.set_updated_at();

create or replace function public.audit_opening_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.event_revisions(group_id, entity_type, entity_id, changed_by_user_id, previous_data)
  values (old.group_id, 'opening_balance', old.id, auth.uid(),
    to_jsonb(old) || jsonb_build_object('ownerShares', coalesce((
      select jsonb_agg(jsonb_build_object('memberId', member_id, 'shareBasisPoints', share_basis_points) order by member_id)
      from public.opening_balance_owners where opening_balance_id = old.id
    ), '[]'::jsonb)));
  return new;
end;
$$;

create trigger opening_audit after update on public.opening_balances
  for each row execute function public.audit_opening_balance();

create or replace function public.assert_valid_opening_balance(p_opening_balance_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  opening public.opening_balances;
  capacity integer;
  owner_count integer;
  share_total integer;
  minimum_share integer;
  maximum_share integer;
  wrong_group_count integer;
begin
  select * into opening from public.opening_balances where id = p_opening_balance_id;
  if opening.id is null or opening.deleted_at is not null then return; end if;
  select tank_capacity_ml into capacity from public.groups where id = opening.group_id;
  select count(*), coalesce(sum(obo.share_basis_points), 0), min(obo.share_basis_points), max(obo.share_basis_points),
    count(*) filter (where not exists (
      select 1 from public.members m where m.id = obo.member_id and m.group_id = opening.group_id
    ))
  into owner_count, share_total, minimum_share, maximum_share, wrong_group_count
  from public.opening_balance_owners obo where obo.opening_balance_id = opening.id;

  if opening.volume_ml > capacity then raise exception 'Opening petrol exceeds tank capacity.' using errcode = 'check_violation'; end if;
  if opening.volume_ml > 0 and opening.unit_price_paise_per_litre <= 0 then
    raise exception 'Opening petrol requires a positive estimated price.' using errcode = 'check_violation';
  end if;
  if opening.amount_paise <> round((opening.volume_ml::numeric * opening.unit_price_paise_per_litre) / 1000) then
    raise exception 'Opening petrol value does not match volume and price.' using errcode = 'check_violation';
  end if;
  if wrong_group_count > 0 then raise exception 'Opening fuel owners must belong to the group.' using errcode = 'check_violation'; end if;

  if opening.ownership_mode = 'empty' and not (opening.volume_ml = 0 and opening.amount_paise = 0 and opening.unit_price_paise_per_litre = 0 and owner_count = 0) then
    raise exception 'An empty opening balance must contain no fuel, value, or owners.' using errcode = 'check_violation';
  elsif opening.ownership_mode = 'single' and not (opening.volume_ml > 0 and owner_count = 1 and share_total = 10000) then
    raise exception 'Single-owner opening fuel requires one 100%% owner.' using errcode = 'check_violation';
  elsif opening.ownership_mode = 'equal' and not (opening.volume_ml > 0 and owner_count >= 2 and share_total = 10000 and maximum_share - minimum_share <= 1) then
    raise exception 'Equal opening ownership requires at least two owners totalling 100%%.' using errcode = 'check_violation';
  elsif opening.ownership_mode = 'shared' and not (opening.volume_ml > 0 and owner_count = 0) then
    raise exception 'Shared opening fuel must not have reimbursable owners.' using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function public.validate_opening_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'opening_balances' then
    perform public.assert_valid_opening_balance(coalesce(new.id, old.id));
  else
    perform public.assert_valid_opening_balance(coalesce(new.opening_balance_id, old.opening_balance_id));
  end if;
  return coalesce(new, old);
end;
$$;

create constraint trigger opening_validate_ownership
  after insert or update or delete on public.opening_balances
  deferrable initially deferred for each row execute function public.validate_opening_balance();
create constraint trigger opening_owner_validate_ownership
  after insert or update or delete on public.opening_balance_owners
  deferrable initially deferred for each row execute function public.validate_opening_balance();

create or replace function public.assert_valid_tank_timeline(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  capacity integer;
  status text;
  balance bigint := 0;
  tank_event record;
  opening_count integer;
  first_normal_at timestamptz;
  opening_at timestamptz;
begin
  select tank_capacity_ml, setup_status into capacity, status from public.groups where id = p_group_id;
  select count(*), min(occurred_at) into opening_count, opening_at
    from public.opening_balances where group_id = p_group_id and deleted_at is null;
  select min(occurred_at) into first_normal_at from (
    select occurred_at from public.fuel_purchases where group_id = p_group_id and deleted_at is null
    union all
    select occurred_at from public.rides where group_id = p_group_id and deleted_at is null
  ) normal_events;
  if opening_count > 1 then raise exception 'Only one active opening balance is allowed.' using errcode = 'check_violation'; end if;
  if opening_at is not null and first_normal_at is not null and opening_at > first_normal_at then
    raise exception 'The opening balance must occur before rides and refills.' using errcode = 'check_violation';
  end if;
  if status = 'pending' and first_normal_at is not null then
    raise exception 'Finish the opening tank setup before logging rides or refills.' using errcode = 'check_violation';
  end if;

  for tank_event in
    select id, occurred_at, 0 as priority, 'opening' as event_type,
      volume_ml::bigint as volume_ml, false as is_full_tank
    from public.opening_balances where group_id = p_group_id and deleted_at is null
    union all
    select id, occurred_at, 1 as priority, 'fuel' as event_type,
      volume_ml::bigint as volume_ml, is_full_tank
    from public.fuel_purchases where group_id = p_group_id and deleted_at is null
    union all
    select id, occurred_at, 2 as priority, 'ride' as event_type,
      consumed_ml::bigint as volume_ml, false as is_full_tank
    from public.rides where group_id = p_group_id and deleted_at is null
    order by occurred_at, priority, id
  loop
    if tank_event.event_type = 'ride' then
      balance := balance - tank_event.volume_ml;
    elsif tank_event.event_type = 'fuel' and tank_event.is_full_tank then
      if tank_event.volume_ml > capacity then
        raise exception 'This refill is larger than the configured tank capacity.' using errcode = 'check_violation';
      end if;
      balance := capacity;
    else
      balance := balance + tank_event.volume_ml;
    end if;
    if balance < 0 then raise exception 'This change would make the estimated tank go below zero.' using errcode = 'check_violation'; end if;
    if balance > capacity then raise exception 'This change would put the estimated tank above its configured capacity.' using errcode = 'check_violation'; end if;
  end loop;
end;
$$;

create constraint trigger opening_validate_timeline
  after insert or update or delete on public.opening_balances
  deferrable initially deferred for each row execute function public.validate_tank_event();

create or replace function public.validate_group_setup_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.setup_status = 'pending' and new.setup_status = 'complete'
    and not exists (select 1 from public.opening_balances where group_id = new.id and deleted_at is null) then
    raise exception 'An opening balance is required before setup can be completed.' using errcode = 'check_violation';
  end if;
  perform public.assert_valid_tank_timeline(new.id);
  return new;
end;
$$;

create trigger group_validate_setup_status after update of setup_status on public.groups
  for each row execute function public.validate_group_setup_status();

create or replace function public.create_fuelshare_group_v2(
  p_group_name text,
  p_vehicle_name text,
  p_display_name text,
  p_tank_capacity_ml integer,
  p_mileage_m_per_litre integer,
  p_setup_status text,
  p_opening_amount_paise integer,
  p_opening_unit_price_paise integer,
  p_opening_volume_ml integer,
  p_ownership_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  created_group public.groups;
  created_member public.members;
  created_opening public.opening_balances;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if p_setup_status not in ('pending', 'complete') then raise exception 'Invalid setup status.'; end if;
  if p_opening_volume_ml < 0 or p_opening_volume_ml > p_tank_capacity_ml then raise exception 'Opening petrol exceeds tank capacity.'; end if;
  if p_setup_status = 'pending' and (p_opening_volume_ml <> 0 or p_opening_amount_paise <> 0) then raise exception 'Deferred setup cannot contain opening fuel.'; end if;
  if p_setup_status = 'complete' and p_ownership_mode not in ('empty', 'single', 'shared') then raise exception 'Invalid opening ownership.'; end if;

  insert into public.groups(name, vehicle_name, tank_capacity_ml, mileage_m_per_litre, admin_user_id, setup_status)
  values (trim(p_group_name), trim(p_vehicle_name), p_tank_capacity_ml, p_mileage_m_per_litre, auth.uid(), p_setup_status)
  returning * into created_group;
  insert into public.members(group_id, user_id, display_name, role)
  values (created_group.id, auth.uid(), trim(p_display_name), 'admin')
  returning * into created_member;

  if p_setup_status = 'complete' then
    insert into public.opening_balances(
      group_id, created_by_user_id, amount_paise, unit_price_paise_per_litre,
      volume_ml, ownership_mode, occurred_at, note
    ) values (
      created_group.id, auth.uid(), p_opening_amount_paise, p_opening_unit_price_paise,
      p_opening_volume_ml, p_ownership_mode, created_group.created_at, 'Estimated opening tank balance'
    ) returning * into created_opening;
    if p_ownership_mode = 'single' then
      insert into public.opening_balance_owners(opening_balance_id, group_id, member_id, share_basis_points)
      values (created_opening.id, created_group.id, created_member.id, 10000);
    end if;
  end if;
  return jsonb_build_object('group_id', created_group.id, 'member_id', created_member.id, 'invite_code', created_group.invite_code);
end;
$$;

create or replace function public.save_opening_balance(
  p_group_id uuid,
  p_opening_balance_id uuid,
  p_volume_ml integer,
  p_unit_price_paise integer,
  p_amount_paise integer,
  p_ownership_mode text,
  p_owner_shares jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.opening_balances;
  share jsonb;
begin
  if not public.is_group_admin(p_group_id) then raise exception 'Only the group admin can change the opening balance.'; end if;
  if p_opening_balance_id is null then
    if exists (select 1 from public.fuel_purchases where group_id = p_group_id and deleted_at is null)
      or exists (select 1 from public.rides where group_id = p_group_id and deleted_at is null) then
      raise exception 'The opening balance must be set before rides and refills.';
    end if;
    insert into public.opening_balances(
      group_id, created_by_user_id, amount_paise, unit_price_paise_per_litre,
      volume_ml, ownership_mode, occurred_at, note
    ) select p_group_id, auth.uid(), p_amount_paise, p_unit_price_paise,
      p_volume_ml, p_ownership_mode, created_at, 'Estimated opening tank balance'
      from public.groups where id = p_group_id
    returning * into target;
  else
    select * into target from public.opening_balances
      where id = p_opening_balance_id and group_id = p_group_id and deleted_at is null for update;
    if target.id is null then raise exception 'Opening balance not found.'; end if;
    update public.opening_balances set amount_paise = p_amount_paise,
      unit_price_paise_per_litre = p_unit_price_paise, volume_ml = p_volume_ml,
      ownership_mode = p_ownership_mode where id = target.id returning * into target;
    delete from public.opening_balance_owners where opening_balance_id = target.id;
  end if;

  for share in select * from jsonb_array_elements(coalesce(p_owner_shares, '[]'::jsonb)) loop
    insert into public.opening_balance_owners(opening_balance_id, group_id, member_id, share_basis_points)
    values (target.id, p_group_id, (share->>'memberId')::uuid, (share->>'shareBasisPoints')::integer);
  end loop;
  update public.groups set setup_status = 'complete' where id = p_group_id;
  perform public.assert_valid_opening_balance(target.id);
  perform public.assert_valid_tank_timeline(p_group_id);
  return target.id;
end;
$$;

revoke all on function public.create_fuelshare_group_v2(text, text, text, integer, integer, text, integer, integer, integer, text) from public;
revoke all on function public.save_opening_balance(uuid, uuid, integer, integer, integer, text, jsonb) from public;
grant execute on function public.create_fuelshare_group_v2(text, text, text, integer, integer, text, integer, integer, integer, text) to authenticated;
grant execute on function public.save_opening_balance(uuid, uuid, integer, integer, integer, text, jsonb) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.groups;
  alter publication supabase_realtime add table public.opening_balances;
  alter publication supabase_realtime add table public.opening_balance_owners;
exception when duplicate_object then null;
end $$;
