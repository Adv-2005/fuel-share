create extension if not exists pgcrypto;

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 60),
  invite_code uuid not null unique default gen_random_uuid(),
  vehicle_name text not null check (char_length(trim(vehicle_name)) between 1 and 60),
  tank_capacity_ml integer not null check (tank_capacity_ml between 500 and 50000),
  mileage_m_per_litre integer not null check (mileage_m_per_litre between 1000 and 200000),
  admin_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 40),
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create unique index members_group_display_name_unique
  on public.members (group_id, lower(display_name));

create table public.fuel_purchases (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  payer_member_id uuid not null references public.members(id) on delete restrict,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  amount_paise integer not null check (amount_paise between 1 and 10000000),
  unit_price_paise_per_litre integer not null check (unit_price_paise_per_litre between 1 and 100000),
  volume_ml integer not null check (volume_ml between 1 and 50000),
  occurred_at timestamptz not null,
  note text not null default '' check (char_length(note) <= 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.rides (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  rider_member_id uuid not null references public.members(id) on delete restrict,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  distance_m integer not null check (distance_m between 1 and 1000000),
  efficiency_m_per_litre integer not null check (efficiency_m_per_litre between 1000 and 200000),
  consumed_ml integer not null check (consumed_ml between 1 and 50000),
  occurred_at timestamptz not null,
  note text not null default '' check (char_length(note) <= 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  payer_member_id uuid not null references public.members(id) on delete restrict,
  recipient_member_id uuid not null references public.members(id) on delete restrict,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  amount_paise integer not null check (amount_paise between 1 and 10000000),
  method text not null check (method in ('upi', 'cash')),
  reference text not null default '' check (char_length(reference) <= 120),
  note text not null default '' check (char_length(note) <= 240),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (payer_member_id <> recipient_member_id)
);

create table public.event_revisions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  entity_type text not null check (entity_type in ('fuel_purchase', 'ride', 'payment')),
  entity_id uuid not null,
  changed_by_user_id uuid not null references auth.users(id) on delete restrict,
  previous_data jsonb not null,
  created_at timestamptz not null default now()
);

create index fuel_purchases_group_time_idx on public.fuel_purchases(group_id, occurred_at);
create index rides_group_time_idx on public.rides(group_id, occurred_at);
create index payments_group_time_idx on public.payments(group_id, occurred_at);
create index revisions_group_entity_idx on public.event_revisions(group_id, entity_id);

create or replace function public.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members
    where group_id = p_group_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_group_admin(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.groups
    where id = p_group_id and admin_user_id = auth.uid()
  );
$$;

create or replace function public.is_own_member(p_member_id uuid, p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members
    where id = p_member_id and group_id = p_group_id and user_id = auth.uid()
  );
$$;

revoke all on function public.is_group_member(uuid) from public;
revoke all on function public.is_group_admin(uuid) from public;
revoke all on function public.is_own_member(uuid, uuid) from public;
grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.is_group_admin(uuid) to authenticated;
grant execute on function public.is_own_member(uuid, uuid) to authenticated;

alter table public.groups enable row level security;
alter table public.members enable row level security;
alter table public.fuel_purchases enable row level security;
alter table public.rides enable row level security;
alter table public.payments enable row level security;
alter table public.event_revisions enable row level security;

create policy groups_select_members on public.groups for select to authenticated
  using (public.is_group_member(id));
create policy groups_update_admin on public.groups for update to authenticated
  using (admin_user_id = auth.uid())
  with check (admin_user_id = auth.uid());

create policy members_select_group on public.members for select to authenticated
  using (public.is_group_member(group_id));

create policy fuel_select_group on public.fuel_purchases for select to authenticated
  using (public.is_group_member(group_id));
create policy fuel_insert_own on public.fuel_purchases for insert to authenticated
  with check (created_by_user_id = auth.uid() and public.is_own_member(payer_member_id, group_id));
create policy fuel_update_own on public.fuel_purchases for update to authenticated
  using (created_by_user_id = auth.uid())
  with check (created_by_user_id = auth.uid() and public.is_own_member(payer_member_id, group_id));

create policy rides_select_group on public.rides for select to authenticated
  using (public.is_group_member(group_id));
create policy rides_insert_own on public.rides for insert to authenticated
  with check (created_by_user_id = auth.uid() and public.is_own_member(rider_member_id, group_id));
create policy rides_update_own on public.rides for update to authenticated
  using (created_by_user_id = auth.uid())
  with check (created_by_user_id = auth.uid() and public.is_own_member(rider_member_id, group_id));

create policy payments_select_group on public.payments for select to authenticated
  using (public.is_group_member(group_id));
create policy payments_insert_own on public.payments for insert to authenticated
  with check (
    created_by_user_id = auth.uid()
    and public.is_own_member(payer_member_id, group_id)
    and exists (select 1 from public.members where id = recipient_member_id and group_id = payments.group_id)
  );
create policy payments_update_own on public.payments for update to authenticated
  using (created_by_user_id = auth.uid())
  with check (
    created_by_user_id = auth.uid()
    and public.is_own_member(payer_member_id, group_id)
    and exists (select 1 from public.members where id = recipient_member_id and group_id = payments.group_id)
  );

create policy revisions_select_group on public.event_revisions for select to authenticated
  using (public.is_group_member(group_id));

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger fuel_set_updated_at before update on public.fuel_purchases
  for each row execute function public.set_updated_at();
create trigger rides_set_updated_at before update on public.rides
  for each row execute function public.set_updated_at();
create trigger payments_set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

create or replace function public.audit_ledger_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_type text;
begin
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

create trigger fuel_audit after update on public.fuel_purchases
  for each row execute function public.audit_ledger_event();
create trigger rides_audit after update on public.rides
  for each row execute function public.audit_ledger_event();
create trigger payments_audit after update on public.payments
  for each row execute function public.audit_ledger_event();

create or replace function public.assert_valid_tank_timeline(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  capacity integer;
  lowest bigint;
  highest bigint;
begin
  select tank_capacity_ml into capacity from public.groups where id = p_group_id;
  with deltas as (
    select id, occurred_at, 0 as priority, volume_ml::bigint as delta
      from public.fuel_purchases where group_id = p_group_id and deleted_at is null
    union all
    select id, occurred_at, 1 as priority, (-consumed_ml)::bigint as delta
      from public.rides where group_id = p_group_id and deleted_at is null
  ), timeline as (
    select sum(delta) over (order by occurred_at, priority, id) as balance from deltas
  )
  select min(balance), max(balance) into lowest, highest from timeline;
  if coalesce(lowest, 0) < 0 then
    raise exception 'This change would make the estimated tank go below zero.' using errcode = 'check_violation';
  end if;
  if coalesce(highest, 0) > capacity then
    raise exception 'This change would put the estimated tank above its configured capacity.' using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function public.validate_tank_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_valid_tank_timeline(coalesce(new.group_id, old.group_id));
  return coalesce(new, old);
end;
$$;

create constraint trigger fuel_validate_timeline after insert or update or delete on public.fuel_purchases
  deferrable initially immediate for each row execute function public.validate_tank_event();
create constraint trigger rides_validate_timeline after insert or update or delete on public.rides
  deferrable initially immediate for each row execute function public.validate_tank_event();

create or replace function public.validate_group_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_valid_tank_timeline(new.id);
  return new;
end;
$$;

create trigger group_validate_capacity after update of tank_capacity_ml on public.groups
  for each row execute function public.validate_group_capacity();

create or replace function public.create_fuelshare_group(
  p_group_name text,
  p_vehicle_name text,
  p_display_name text,
  p_tank_capacity_ml integer,
  p_mileage_m_per_litre integer,
  p_initial_amount_paise integer,
  p_initial_unit_price_paise integer,
  p_initial_volume_ml integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  created_group public.groups;
  created_member public.members;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if p_initial_volume_ml > p_tank_capacity_ml then raise exception 'Initial refill exceeds tank capacity.'; end if;
  insert into public.groups(name, vehicle_name, tank_capacity_ml, mileage_m_per_litre, admin_user_id)
  values (trim(p_group_name), trim(p_vehicle_name), p_tank_capacity_ml, p_mileage_m_per_litre, auth.uid())
  returning * into created_group;
  insert into public.members(group_id, user_id, display_name, role)
  values (created_group.id, auth.uid(), trim(p_display_name), 'admin')
  returning * into created_member;
  insert into public.fuel_purchases(
    group_id, payer_member_id, created_by_user_id, amount_paise,
    unit_price_paise_per_litre, volume_ml, occurred_at, note
  ) values (
    created_group.id, created_member.id, auth.uid(), p_initial_amount_paise,
    p_initial_unit_price_paise, p_initial_volume_ml, now(), 'Initial known-tank refill'
  );
  return jsonb_build_object('group_id', created_group.id, 'member_id', created_member.id, 'invite_code', created_group.invite_code);
end;
$$;

create or replace function public.join_fuelshare_group(p_invite_code uuid, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_group public.groups;
  joined_member public.members;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  select * into target_group from public.groups where invite_code = p_invite_code;
  if target_group.id is null then raise exception 'Invite not found.'; end if;
  select * into joined_member from public.members where group_id = target_group.id and user_id = auth.uid();
  if joined_member.id is null then
    insert into public.members(group_id, user_id, display_name, role)
    values (target_group.id, auth.uid(), trim(p_display_name), 'member')
    returning * into joined_member;
  end if;
  return jsonb_build_object('group_id', target_group.id, 'member_id', joined_member.id);
end;
$$;

revoke all on function public.create_fuelshare_group(text, text, text, integer, integer, integer, integer, integer) from public;
revoke all on function public.join_fuelshare_group(uuid, text) from public;
grant execute on function public.create_fuelshare_group(text, text, text, integer, integer, integer, integer, integer) to authenticated;
grant execute on function public.join_fuelshare_group(uuid, text) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.members;
  alter publication supabase_realtime add table public.fuel_purchases;
  alter publication supabase_realtime add table public.rides;
  alter publication supabase_realtime add table public.payments;
exception when duplicate_object then null;
end $$;
