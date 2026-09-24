alter table public.rides
  add column if not exists participant_member_ids uuid[];

-- This is a schema backfill, not a user correction. The existing audit trigger
-- requires auth.uid(), which is null when a migration runs from the SQL editor.
alter table public.rides disable trigger rides_audit;
alter table public.rides disable trigger rides_set_updated_at;

update public.rides
set participant_member_ids = array[rider_member_id]
where participant_member_ids is null;

alter table public.rides enable trigger rides_audit;
alter table public.rides enable trigger rides_set_updated_at;

alter table public.rides
  alter column participant_member_ids set not null,
  add constraint rides_participant_count_check
    check (cardinality(participant_member_ids) between 1 and 3),
  add constraint rides_driver_participates_check
    check (rider_member_id = any(participant_member_ids));

create or replace function public.validate_ride_participants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  unique_count integer;
  group_member_count integer;
begin
  if cardinality(new.participant_member_ids) = 0 then
    raise exception 'A ride must have at least one participant.' using errcode = 'check_violation';
  end if;
  if cardinality(new.participant_member_ids) > 3 then
    raise exception 'A ride can include at most three people.' using errcode = 'check_violation';
  end if;
  if not (new.rider_member_id = any(new.participant_member_ids)) then
    raise exception 'The driver must be included in the ride.' using errcode = 'check_violation';
  end if;

  select count(distinct participant_id)
  into unique_count
  from unnest(new.participant_member_ids) as participant_id;
  if unique_count <> cardinality(new.participant_member_ids) then
    raise exception 'Ride participants must be unique.' using errcode = 'check_violation';
  end if;

  select count(*)
  into group_member_count
  from public.members
  where group_id = new.group_id
    and id = any(new.participant_member_ids);
  if group_member_count <> cardinality(new.participant_member_ids) then
    raise exception 'Every ride participant must belong to the ride group.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger rides_validate_participants
  before insert or update of group_id, rider_member_id, participant_member_ids on public.rides
  for each row execute function public.validate_ride_participants();

-- The existing audit trigger serializes OLD in full, so corrections retain the
-- exact prior participant_member_ids array alongside all other ride fields.
