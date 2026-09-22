import { calculateLedger, equalOwnershipShares, fuelForRide, litresFromMoney } from "@/lib/ledger";
import { getSupabase, isCloudConfigured } from "@/lib/supabase";
import type {
  CreateFuelInput,
  CreateGroupInput,
  CreatePaymentInput,
  CreateRideInput,
  EventKind,
  EventRevision,
  FuelPurchase,
  Group,
  GroupData,
  LedgerEvent,
  Member,
  OpeningBalance,
  OpeningOwnershipMode,
  PaymentMethod,
  Ride,
  SaveOpeningBalanceInput,
  SettlementPayment,
} from "@/lib/types";

const LOCAL_DATABASE_KEY = "fuelshare_database_v1";
const LOCAL_USER_KEY = "fuelshare_user_id";
const ACTIVE_GROUP_KEY = "fuelshare_active_group";
const PENDING_ACTIONS_KEY = "fuelshare_pending_actions_v1";

interface LocalDatabase {
  groups: Group[];
  members: Member[];
  purchases: FuelPurchase[];
  openingBalances: OpeningBalance[];
  rides: Ride[];
  payments: SettlementPayment[];
  revisions: EventRevision[];
}

interface PendingCloudAction {
  event: Exclude<LedgerEvent, OpeningBalance>;
}

type QueueableEvent = Exclude<LedgerEvent, OpeningBalance>;

interface GroupRow {
  id: string;
  name: string;
  invite_code: string;
  vehicle_name: string;
  tank_capacity_ml: number;
  mileage_m_per_litre: number;
  admin_user_id: string;
  setup_status?: "pending" | "complete";
  created_at: string;
}

interface MemberRow {
  id: string;
  group_id: string;
  user_id: string;
  display_name: string;
  role: "admin" | "member";
  created_at: string;
}

interface FuelRow {
  id: string; group_id: string; payer_member_id: string; created_by_user_id: string;
  amount_paise: number; unit_price_paise_per_litre: number; volume_ml: number; is_full_tank: boolean;
  occurred_at: string; created_at: string; updated_at: string; deleted_at: string | null; note: string;
}

interface OpeningRow {
  id: string; group_id: string; created_by_user_id: string; amount_paise: number;
  unit_price_paise_per_litre: number; volume_ml: number; ownership_mode: OpeningOwnershipMode;
  occurred_at: string; created_at: string; updated_at: string; deleted_at: string | null; note: string;
}

interface OpeningOwnerRow {
  opening_balance_id: string; member_id: string; share_basis_points: number;
}

interface RideRow {
  id: string; group_id: string; rider_member_id: string; created_by_user_id: string;
  distance_m: number; efficiency_m_per_litre: number; consumed_ml: number;
  occurred_at: string; created_at: string; updated_at: string; deleted_at: string | null; note: string;
}

interface PaymentRow {
  id: string; group_id: string; payer_member_id: string; recipient_member_id: string; created_by_user_id: string;
  amount_paise: number; method: PaymentMethod; reference: string;
  occurred_at: string; created_at: string; updated_at: string; deleted_at: string | null; note: string;
}

interface RevisionRow {
  id: string; group_id: string; entity_type: EventKind; entity_id: string;
  changed_by_user_id: string; previous_data: Record<string, unknown>; created_at: string;
}

function emptyDatabase(): LocalDatabase {
  return { groups: [], members: [], purchases: [], openingBalances: [], rides: [], payments: [], revisions: [] };
}

function loadLocalDatabase(): LocalDatabase {
  const raw = window.localStorage.getItem(LOCAL_DATABASE_KEY);
  if (!raw) return emptyDatabase();
  try {
    const parsed = JSON.parse(raw) as LocalDatabase;
    parsed.openingBalances ??= [];
    parsed.groups = parsed.groups.map((group) => ({ ...group, setupStatus: group.setupStatus ?? "complete" }));
    return parsed;
  } catch {
    return emptyDatabase();
  }
}

function saveLocalDatabase(database: LocalDatabase): void {
  window.localStorage.setItem(LOCAL_DATABASE_KEY, JSON.stringify(database));
}

function loadPendingActions(): PendingCloudAction[] {
  const raw = window.localStorage.getItem(PENDING_ACTIONS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PendingCloudAction[];
  } catch {
    return [];
  }
}

function savePendingActions(actions: PendingCloudAction[]): void {
  window.localStorage.setItem(PENDING_ACTIONS_KEY, JSON.stringify(actions));
}

function queueCloudEvent(event: QueueableEvent): void {
  const actions = loadPendingActions();
  if (!actions.some((action) => action.event.id === event.id)) actions.push({ event });
  savePendingActions(actions);
}

function cloudRecordFor(event: QueueableEvent): Record<string, string | number | boolean | null> {
  const base = {
    id: event.id,
    group_id: event.groupId,
    created_by_user_id: event.createdByUserId,
    occurred_at: event.occurredAt,
    note: event.note,
    created_at: event.createdAt,
    updated_at: event.updatedAt,
    deleted_at: event.deletedAt,
  };
  if (event.kind === "fuel_purchase") return {
    ...base, payer_member_id: event.payerMemberId, amount_paise: event.amountPaise,
    unit_price_paise_per_litre: event.unitPricePaisePerLitre, volume_ml: event.volumeMl,
    is_full_tank: event.isFullTank,
  };
  if (event.kind === "ride") return {
    ...base, rider_member_id: event.riderMemberId, distance_m: event.distanceM,
    efficiency_m_per_litre: event.efficiencyMPerLitre, consumed_ml: event.consumedMl,
  };
  return {
    ...base, payer_member_id: event.payerMemberId, recipient_member_id: event.recipientMemberId,
    amount_paise: event.amountPaise, method: event.method, reference: event.reference,
  };
}

async function insertCloudEvent(event: QueueableEvent): Promise<{ code?: string; message?: string } | null> {
  const table = event.kind === "fuel_purchase" ? "fuel_purchases" : event.kind === "ride" ? "rides" : "payments";
  const { error } = await getSupabase().from(table).insert(cloudRecordFor(event));
  return error ? { code: error.code, message: error.message } : null;
}

function isConnectivityError(message = ""): boolean {
  return !navigator.onLine || /fetch|network|connection|offline/i.test(message);
}

async function insertOrQueueCloudEvent(event: QueueableEvent): Promise<void> {
  if (!navigator.onLine) {
    queueCloudEvent(event);
    return;
  }
  const error = await insertCloudEvent(event);
  if (!error || error.code === "23505") return;
  if (isConnectivityError(error.message)) {
    queueCloudEvent(event);
    return;
  }
  throw new Error(error.message ?? "Could not save this entry.");
}

async function flushPendingActions(groupId: string): Promise<void> {
  const actions = loadPendingActions();
  if (!navigator.onLine || actions.length === 0) return;
  const remaining: PendingCloudAction[] = [];
  for (const action of actions) {
    if (action.event.groupId !== groupId) {
      remaining.push(action);
      continue;
    }
    const error = await insertCloudEvent(action.event);
    if (error && error.code !== "23505") remaining.push(action);
    if (error && isConnectivityError(error.message)) {
      remaining.push(...actions.slice(actions.indexOf(action) + 1));
      break;
    }
  }
  savePendingActions(remaining);
}

function localUserId(): string {
  const existing = window.localStorage.getItem(LOCAL_USER_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.localStorage.setItem(LOCAL_USER_KEY, created);
  return created;
}

function rememberGroup(groupId: string): void {
  window.localStorage.setItem(ACTIVE_GROUP_KEY, groupId);
}

function forgetActiveGroup(): void {
  window.localStorage.removeItem(ACTIVE_GROUP_KEY);
}

function activeGroupId(): string | null {
  return window.localStorage.getItem(ACTIVE_GROUP_KEY);
}

export function selectAccessibleGroupId(preferredGroupId: string | null, accessibleGroupIds: string[]): string | null {
  if (preferredGroupId && accessibleGroupIds.includes(preferredGroupId)) return preferredGroupId;
  return accessibleGroupIds[0] ?? null;
}

function groupFromRow(row: GroupRow): Group {
  return {
    id: row.id, name: row.name, inviteCode: row.invite_code, vehicleName: row.vehicle_name,
    tankCapacityMl: row.tank_capacity_ml, mileageMPerLitre: row.mileage_m_per_litre,
    adminUserId: row.admin_user_id, createdAt: row.created_at,
    setupStatus: row.setup_status ?? "complete",
  };
}

function openingFromRow(row: OpeningRow, owners: OpeningOwnerRow[]): OpeningBalance {
  return {
    id: row.id, kind: "opening_balance", groupId: row.group_id, createdByUserId: row.created_by_user_id,
    amountPaise: row.amount_paise, unitPricePaisePerLitre: row.unit_price_paise_per_litre,
    volumeMl: row.volume_ml, ownershipMode: row.ownership_mode,
    ownerShares: owners.filter((owner) => owner.opening_balance_id === row.id).map((owner) => ({
      memberId: owner.member_id, shareBasisPoints: owner.share_basis_points,
    })),
    occurredAt: row.occurred_at, createdAt: row.created_at, updatedAt: row.updated_at,
    deletedAt: row.deleted_at, note: row.note,
  };
}

function memberFromRow(row: MemberRow): Member {
  return { id: row.id, groupId: row.group_id, userId: row.user_id, displayName: row.display_name, role: row.role, createdAt: row.created_at };
}

function fuelFromRow(row: FuelRow): FuelPurchase {
  return {
    id: row.id, kind: "fuel_purchase", groupId: row.group_id, payerMemberId: row.payer_member_id,
    createdByUserId: row.created_by_user_id, amountPaise: row.amount_paise,
    unitPricePaisePerLitre: row.unit_price_paise_per_litre, volumeMl: row.volume_ml,
    isFullTank: row.is_full_tank ?? false,
    occurredAt: row.occurred_at, createdAt: row.created_at, updatedAt: row.updated_at,
    deletedAt: row.deleted_at, note: row.note,
  };
}

function rideFromRow(row: RideRow): Ride {
  return {
    id: row.id, kind: "ride", groupId: row.group_id, riderMemberId: row.rider_member_id,
    createdByUserId: row.created_by_user_id, distanceM: row.distance_m,
    efficiencyMPerLitre: row.efficiency_m_per_litre, consumedMl: row.consumed_ml,
    occurredAt: row.occurred_at, createdAt: row.created_at, updatedAt: row.updated_at,
    deletedAt: row.deleted_at, note: row.note,
  };
}

function paymentFromRow(row: PaymentRow): SettlementPayment {
  return {
    id: row.id, kind: "payment", groupId: row.group_id, payerMemberId: row.payer_member_id,
    recipientMemberId: row.recipient_member_id, createdByUserId: row.created_by_user_id,
    amountPaise: row.amount_paise, method: row.method, reference: row.reference,
    occurredAt: row.occurred_at, createdAt: row.created_at, updatedAt: row.updated_at,
    deletedAt: row.deleted_at, note: row.note,
  };
}

function revisionFromRow(row: RevisionRow): EventRevision {
  return {
    id: row.id, groupId: row.group_id, entityType: row.entity_type, entityId: row.entity_id,
    changedByUserId: row.changed_by_user_id, previousData: row.previous_data, createdAt: row.created_at,
  };
}

async function ensureCloudUser(): Promise<string> {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.id) return data.session.user.id;
  const { data: signIn, error } = await supabase.auth.signInAnonymously();
  if (error || !signIn.user) throw new Error(error?.message ?? "Could not create a device session.");
  return signIn.user.id;
}

function localGroupData(groupId: string): GroupData | null {
  const database = loadLocalDatabase();
  const userId = localUserId();
  const group = database.groups.find((entry) => entry.id === groupId);
  const currentMember = database.members.find((member) => member.groupId === groupId && member.userId === userId);
  if (!group || !currentMember) return null;
  return {
    group,
    members: database.members.filter((item) => item.groupId === groupId),
    purchases: database.purchases.filter((item) => item.groupId === groupId),
    openingBalances: database.openingBalances.filter((item) => item.groupId === groupId),
    rides: database.rides.filter((item) => item.groupId === groupId),
    payments: database.payments.filter((item) => item.groupId === groupId),
    revisions: database.revisions.filter((item) => item.groupId === groupId),
    currentUserId: userId,
    currentMemberId: currentMember.id,
    pendingEventIds: [],
    mode: "local",
  };
}

async function cloudGroupData(groupId?: string | null): Promise<GroupData | null> {
  const supabase = getSupabase();
  const userId = await ensureCloudUser();
  const { data: membershipData, error: membershipError } = await supabase
    .from("members")
    .select("group_id")
    .eq("user_id", userId)
    .order("created_at");
  if (membershipError) throw new Error(membershipError.message);
  const accessibleGroupIds = (membershipData as unknown as Array<{ group_id: string }>).map((membership) => membership.group_id);
  const selectedGroupId = selectAccessibleGroupId(groupId ?? activeGroupId(), accessibleGroupIds);
  if (!selectedGroupId) {
    forgetActiveGroup();
    return null;
  }
  await flushPendingActions(selectedGroupId);

  const [groupResult, membersResult, openingResult, openingOwnersResult, fuelResult, ridesResult, paymentsResult, revisionsResult] = await Promise.all([
    supabase.from("groups").select("*").eq("id", selectedGroupId).maybeSingle(),
    supabase.from("members").select("*").eq("group_id", selectedGroupId).order("created_at"),
    supabase.from("opening_balances").select("*").eq("group_id", selectedGroupId),
    supabase.from("opening_balance_owners").select("*").eq("group_id", selectedGroupId),
    supabase.from("fuel_purchases").select("*").eq("group_id", selectedGroupId),
    supabase.from("rides").select("*").eq("group_id", selectedGroupId),
    supabase.from("payments").select("*").eq("group_id", selectedGroupId),
    supabase.from("event_revisions").select("*").eq("group_id", selectedGroupId).order("created_at", { ascending: false }),
  ]);
  const error = groupResult.error ?? membersResult.error ?? openingResult.error ?? openingOwnersResult.error ?? fuelResult.error ?? ridesResult.error ?? paymentsResult.error ?? revisionsResult.error;
  if (error) throw new Error(error.message);
  if (!groupResult.data) {
    forgetActiveGroup();
    return null;
  }
  const memberRows = membersResult.data as unknown as MemberRow[];
  const currentMember = memberRows.find((member) => member.user_id === userId);
  if (!currentMember) return null;
  rememberGroup(selectedGroupId);
  const pending = loadPendingActions().filter((action) => action.event.groupId === selectedGroupId);
  const purchases = (fuelResult.data as unknown as FuelRow[]).map(fuelFromRow);
  const rides = (ridesResult.data as unknown as RideRow[]).map(rideFromRow);
  const payments = (paymentsResult.data as unknown as PaymentRow[]).map(paymentFromRow);
  for (const action of pending) {
    if (action.event.kind === "fuel_purchase" && !purchases.some((entry) => entry.id === action.event.id)) purchases.push(action.event);
    if (action.event.kind === "ride" && !rides.some((entry) => entry.id === action.event.id)) rides.push(action.event);
    if (action.event.kind === "payment" && !payments.some((entry) => entry.id === action.event.id)) payments.push(action.event);
  }
  return {
    group: groupFromRow(groupResult.data as unknown as GroupRow),
    members: memberRows.map(memberFromRow),
    openingBalances: (openingResult.data as unknown as OpeningRow[]).map((row) => openingFromRow(row, openingOwnersResult.data as unknown as OpeningOwnerRow[])),
    purchases,
    rides,
    payments,
    revisions: (revisionsResult.data as unknown as RevisionRow[]).map(revisionFromRow),
    currentUserId: userId,
    currentMemberId: currentMember.id,
    pendingEventIds: pending.map((action) => action.event.id),
    mode: "cloud",
  };
}

export async function loadCurrentGroup(groupId?: string | null): Promise<GroupData | null> {
  if (isCloudConfigured()) return cloudGroupData(groupId);
  const selected = groupId ?? activeGroupId();
  return selected ? localGroupData(selected) : null;
}

export async function createGroup(input: CreateGroupInput): Promise<GroupData> {
  const capacityMl = Math.round(input.tankCapacityLitres * 1000);
  const volumeMl = input.opening.state === "existing" ? Math.round(input.opening.volumeLitres * 1000) : 0;
  const pricePaise = input.opening.state === "existing" ? Math.round(input.opening.pricePerLitre * 100) : 0;
  const amountPaise = Math.round((volumeMl * pricePaise) / 1000);
  if (volumeMl < 0 || volumeMl > capacityMl) throw new Error("Opening petrol must be between zero and the tank capacity.");
  if (volumeMl > 0 && pricePaise <= 0) throw new Error("Enter a positive estimated petrol price.");
  const setupStatus = input.opening.state === "deferred" ? "pending" : "complete";
  const ownershipMode = input.opening.state === "existing" ? input.opening.ownershipMode : "empty";
  if (input.opening.state === "existing" && volumeMl === 0) throw new Error("Enter an estimated amount of petrol greater than zero.");
  if (isCloudConfigured()) {
    await ensureCloudUser();
    const { data, error } = await getSupabase().rpc("create_fuelshare_group_v2", {
      p_group_name: input.groupName,
      p_vehicle_name: input.vehicleName,
      p_display_name: input.displayName,
      p_tank_capacity_ml: capacityMl,
      p_mileage_m_per_litre: Math.round(input.mileageKmPerLitre * 1000),
      p_setup_status: setupStatus,
      p_opening_amount_paise: amountPaise,
      p_opening_unit_price_paise: pricePaise,
      p_opening_volume_ml: volumeMl,
      p_ownership_mode: ownershipMode,
    });
    if (error) throw new Error(error.message);
    const result = data as unknown as { group_id: string };
    rememberGroup(result.group_id);
    const loaded = await cloudGroupData(result.group_id);
    if (!loaded) throw new Error("The group was created but could not be loaded.");
    return loaded;
  }

  const database = loadLocalDatabase();
  const now = new Date().toISOString();
  const userId = localUserId();
  const groupId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const group: Group = {
    id: groupId, name: input.groupName.trim(), inviteCode: crypto.randomUUID(), vehicleName: input.vehicleName.trim(),
    tankCapacityMl: capacityMl, mileageMPerLitre: Math.round(input.mileageKmPerLitre * 1000), adminUserId: userId,
    setupStatus, createdAt: now,
  };
  database.groups.push(group);
  database.members.push({ id: memberId, groupId, userId, displayName: input.displayName.trim(), role: "admin", createdAt: now });
  if (setupStatus === "complete") database.openingBalances.push({
    id: crypto.randomUUID(), kind: "opening_balance", groupId, createdByUserId: userId,
    amountPaise, unitPricePaisePerLitre: pricePaise, volumeMl, ownershipMode,
    ownerShares: ownershipMode === "single" ? [{ memberId, shareBasisPoints: 10_000 }] : [],
    occurredAt: now, createdAt: now, updatedAt: now, deletedAt: null, note: "Estimated opening tank balance",
  });
  saveLocalDatabase(database);
  rememberGroup(groupId);
  const loaded = localGroupData(groupId);
  if (!loaded) throw new Error("The local group could not be loaded.");
  return loaded;
}

export async function joinGroup(inviteCode: string, displayName: string): Promise<GroupData> {
  if (isCloudConfigured()) {
    await ensureCloudUser();
    const { data, error } = await getSupabase().rpc("join_fuelshare_group", {
      p_invite_code: inviteCode,
      p_display_name: displayName,
    });
    if (error) throw new Error(error.message);
    const result = data as unknown as { group_id: string };
    rememberGroup(result.group_id);
    const loaded = await cloudGroupData(result.group_id);
    if (!loaded) throw new Error("The group was joined but could not be loaded.");
    return loaded;
  }
  const database = loadLocalDatabase();
  const group = database.groups.find((entry) => entry.inviteCode === inviteCode);
  if (!group) throw new Error("That invite is not available on this device. Configure Supabase to share across phones.");
  const userId = localUserId();
  let member = database.members.find((entry) => entry.groupId === group.id && entry.userId === userId);
  if (!member) {
    if (database.members.some((entry) => entry.groupId === group.id && entry.displayName.toLowerCase() === displayName.trim().toLowerCase())) {
      throw new Error("That display name is already in this group.");
    }
    member = { id: crypto.randomUUID(), groupId: group.id, userId, displayName: displayName.trim(), role: "member", createdAt: new Date().toISOString() };
    database.members.push(member);
    saveLocalDatabase(database);
  }
  rememberGroup(group.id);
  const loaded = localGroupData(group.id);
  if (!loaded) throw new Error("The local group could not be loaded.");
  return loaded;
}

function validateLocal(database: LocalDatabase, groupId: string): void {
  const group = database.groups.find((entry) => entry.id === groupId);
  if (!group) throw new Error("Group not found.");
  const activeOpenings = database.openingBalances.filter((entry) => entry.groupId === groupId && !entry.deletedAt);
  if (activeOpenings.length > 1) throw new Error("Only one active opening balance is allowed.");
  const firstNormalAt = [
    ...database.purchases.filter((entry) => entry.groupId === groupId && !entry.deletedAt),
    ...database.rides.filter((entry) => entry.groupId === groupId && !entry.deletedAt),
  ].map((entry) => entry.occurredAt).sort()[0];
  if (activeOpenings[0] && firstNormalAt && activeOpenings[0].occurredAt > firstNormalAt) {
    throw new Error("The opening balance must occur before rides and refills.");
  }
  const result = calculateLedger(
    group,
    database.members.filter((entry) => entry.groupId === groupId),
    database.purchases.filter((entry) => entry.groupId === groupId),
    database.rides.filter((entry) => entry.groupId === groupId),
    database.payments.filter((entry) => entry.groupId === groupId),
    database.openingBalances.filter((entry) => entry.groupId === groupId),
  );
  if (result.issues[0]) throw new Error(result.issues[0].message);
}

function assertSetupComplete(data: GroupData): void {
  if (data.group.setupStatus !== "complete") throw new Error("Finish the opening tank setup before logging rides or refills.");
}

export function validateOpeningBalanceInput(
  input: SaveOpeningBalanceInput,
  capacityMl: number,
  joinedMemberIds: string[],
): { volumeMl: number; pricePaise: number; amountPaise: number; ownerShares: OpeningBalance["ownerShares"] } {
  const volumeMl = Math.round(input.volumeLitres * 1000);
  const pricePaise = Math.round(input.pricePerLitre * 100);
  const selectedIds = [...new Set(input.ownerMemberIds)];
  if (volumeMl < 0 || volumeMl > capacityMl) throw new Error("Opening petrol must be between zero and the tank capacity.");
  if (volumeMl > 0 && pricePaise <= 0) throw new Error("Enter a positive estimated petrol price.");
  if (volumeMl === 0 && input.ownershipMode !== "empty") throw new Error("Use the empty-tank option when the opening volume is zero.");
  if (volumeMl > 0 && input.ownershipMode === "empty") throw new Error("Choose who owns the opening petrol.");
  if (selectedIds.some((memberId) => !joinedMemberIds.includes(memberId))) throw new Error("Every opening fuel owner must be a joined member.");
  if (input.ownershipMode === "single" && selectedIds.length !== 1) throw new Error("Select one member who paid for the opening petrol.");
  if (input.ownershipMode === "equal" && selectedIds.length < 2) throw new Error("Equal ownership requires at least two selected members.");
  if ((input.ownershipMode === "shared" || input.ownershipMode === "empty") && selectedIds.length > 0) {
    throw new Error("Shared opening fuel cannot have a reimbursable owner.");
  }
  const ownerShares = input.ownershipMode === "single"
    ? [{ memberId: selectedIds[0], shareBasisPoints: 10_000 }]
    : input.ownershipMode === "equal" ? equalOwnershipShares(selectedIds) : [];
  if (ownerShares.length > 0 && ownerShares.reduce((sum, share) => sum + share.shareBasisPoints, 0) !== 10_000) {
    throw new Error("Opening ownership shares must total exactly 100%.");
  }
  return { volumeMl, pricePaise, amountPaise: Math.round((volumeMl * pricePaise) / 1000), ownerShares };
}

export async function saveOpeningBalance(data: GroupData, input: SaveOpeningBalanceInput): Promise<void> {
  if (data.currentUserId !== data.group.adminUserId) throw new Error("Only the group admin can finish or correct the opening tank setup.");
  const current = data.openingBalances.find((entry) => !entry.deletedAt);
  const values = validateOpeningBalanceInput(input, data.group.tankCapacityMl, data.members.map((member) => member.id));
  if (data.mode === "cloud") {
    const { error } = await getSupabase().rpc("save_opening_balance", {
      p_group_id: data.group.id,
      p_opening_balance_id: current?.id ?? null,
      p_volume_ml: values.volumeMl,
      p_unit_price_paise: values.pricePaise,
      p_amount_paise: values.amountPaise,
      p_ownership_mode: input.ownershipMode,
      p_owner_shares: values.ownerShares,
    });
    if (error) throw new Error(error.message);
    return;
  }

  const database = loadLocalDatabase();
  const group = database.groups.find((entry) => entry.id === data.group.id);
  if (!group) throw new Error("Group not found.");
  const storedCurrent = database.openingBalances.find((entry) => entry.groupId === group.id && !entry.deletedAt);
  const now = new Date().toISOString();
  if (storedCurrent) {
    database.revisions.unshift({
      id: crypto.randomUUID(), groupId: group.id, entityType: "opening_balance", entityId: storedCurrent.id,
      changedByUserId: data.currentUserId, previousData: { ...storedCurrent, ownerShares: storedCurrent.ownerShares.map((share) => ({ ...share })) }, createdAt: now,
    });
    Object.assign(storedCurrent, {
      volumeMl: values.volumeMl, unitPricePaisePerLitre: values.pricePaise, amountPaise: values.amountPaise,
      ownershipMode: input.ownershipMode, ownerShares: values.ownerShares, updatedAt: now,
    });
  } else {
    if (database.purchases.some((entry) => entry.groupId === group.id && !entry.deletedAt) || database.rides.some((entry) => entry.groupId === group.id && !entry.deletedAt)) {
      throw new Error("The opening balance must be set before rides and refills.");
    }
    database.openingBalances.push({
      id: crypto.randomUUID(), kind: "opening_balance", groupId: group.id, createdByUserId: data.currentUserId,
      volumeMl: values.volumeMl, unitPricePaisePerLitre: values.pricePaise, amountPaise: values.amountPaise,
      ownershipMode: input.ownershipMode, ownerShares: values.ownerShares,
      occurredAt: group.createdAt, createdAt: now, updatedAt: now, deletedAt: null, note: "Estimated opening tank balance",
    });
  }
  group.setupStatus = "complete";
  validateLocal(database, group.id);
  saveLocalDatabase(database);
}

export async function addRide(data: GroupData, input: CreateRideInput): Promise<void> {
  assertSetupComplete(data);
  const distanceM = Math.round(input.distanceKm * 1000);
  const consumedMl = fuelForRide(input.distanceKm, data.group.mileageMPerLitre / 1000);
  const now = new Date().toISOString();
  const event: Ride = {
    id: crypto.randomUUID(), kind: "ride", groupId: data.group.id, riderMemberId: data.currentMemberId,
    createdByUserId: data.currentUserId, distanceM, efficiencyMPerLitre: data.group.mileageMPerLitre,
    consumedMl, occurredAt: input.occurredAt, createdAt: now, updatedAt: now, deletedAt: null, note: input.note?.trim() ?? "",
  };
  if (data.mode === "cloud") {
    await insertOrQueueCloudEvent(event);
    return;
  }
  const database = loadLocalDatabase();
  database.rides.push(event);
  validateLocal(database, data.group.id);
  saveLocalDatabase(database);
}

export async function addFuel(data: GroupData, input: CreateFuelInput): Promise<void> {
  assertSetupComplete(data);
  const volumeMl = litresFromMoney(input.amountRupees, input.pricePerLitre);
  const now = new Date().toISOString();
  const event: FuelPurchase = {
    id: crypto.randomUUID(), kind: "fuel_purchase", groupId: data.group.id, payerMemberId: data.currentMemberId,
    createdByUserId: data.currentUserId, amountPaise: Math.round(input.amountRupees * 100),
    unitPricePaisePerLitre: Math.round(input.pricePerLitre * 100), volumeMl, isFullTank: input.isFullTank,
    occurredAt: input.occurredAt, note: input.note?.trim() ?? "", createdAt: now, updatedAt: now, deletedAt: null,
  };
  if (data.mode === "cloud") {
    await insertOrQueueCloudEvent(event);
    return;
  }
  const database = loadLocalDatabase();
  database.purchases.push(event);
  validateLocal(database, data.group.id);
  saveLocalDatabase(database);
}

export async function addPayment(data: GroupData, input: CreatePaymentInput): Promise<void> {
  if (input.recipientMemberId === data.currentMemberId) throw new Error("Choose another member as the recipient.");
  const now = new Date().toISOString();
  const event: SettlementPayment = {
    id: crypto.randomUUID(), kind: "payment", groupId: data.group.id, payerMemberId: data.currentMemberId,
    recipientMemberId: input.recipientMemberId, createdByUserId: data.currentUserId,
    amountPaise: Math.round(input.amountRupees * 100), method: input.method, reference: input.reference?.trim() ?? "",
    occurredAt: input.occurredAt, note: "", createdAt: now, updatedAt: now, deletedAt: null,
  };
  if (data.mode === "cloud") {
    await insertOrQueueCloudEvent(event);
    return;
  }
  const database = loadLocalDatabase();
  database.payments.push(event);
  saveLocalDatabase(database);
}

export interface EventUpdateInput {
  amountRupees?: number;
  pricePerLitre?: number;
  isFullTank?: boolean;
  distanceKm?: number;
  recipientMemberId?: string;
  method?: PaymentMethod;
  reference?: string;
  occurredAt: string;
  note?: string;
}

function localCollection(database: LocalDatabase, kind: Exclude<EventKind, "opening_balance">): QueueableEvent[] {
  if (kind === "fuel_purchase") return database.purchases;
  if (kind === "ride") return database.rides;
  return database.payments;
}

export async function updateEvent(data: GroupData, event: QueueableEvent, input: EventUpdateInput): Promise<void> {
  if (event.createdByUserId !== data.currentUserId) throw new Error("You can only correct entries that you recorded.");
  if (data.mode === "cloud") {
    const table = event.kind === "fuel_purchase" ? "fuel_purchases" : event.kind === "ride" ? "rides" : "payments";
    let update: Record<string, string | number | boolean>;
    if (event.kind === "fuel_purchase") {
      const amount = input.amountRupees ?? event.amountPaise / 100;
      const price = input.pricePerLitre ?? event.unitPricePaisePerLitre / 100;
      update = { amount_paise: Math.round(amount * 100), unit_price_paise_per_litre: Math.round(price * 100), volume_ml: litresFromMoney(amount, price), is_full_tank: input.isFullTank ?? event.isFullTank, occurred_at: input.occurredAt, note: input.note?.trim() ?? "" };
    } else if (event.kind === "ride") {
      const distance = input.distanceKm ?? event.distanceM / 1000;
      update = { distance_m: Math.round(distance * 1000), consumed_ml: fuelForRide(distance, event.efficiencyMPerLitre / 1000), occurred_at: input.occurredAt, note: input.note?.trim() ?? "" };
    } else {
      update = { amount_paise: Math.round((input.amountRupees ?? event.amountPaise / 100) * 100), recipient_member_id: input.recipientMemberId ?? event.recipientMemberId, method: input.method ?? event.method, reference: input.reference?.trim() ?? "", occurred_at: input.occurredAt };
    }
    const { error } = await getSupabase().from(table).update(update).eq("id", event.id);
    if (error) throw new Error(error.message);
    return;
  }

  const database = loadLocalDatabase();
  const collection = localCollection(database, event.kind);
  const index = collection.findIndex((entry) => entry.id === event.id);
  if (index < 0) throw new Error("Entry not found.");
  database.revisions.unshift({
    id: crypto.randomUUID(), groupId: data.group.id, entityType: event.kind, entityId: event.id,
    changedByUserId: data.currentUserId, previousData: { ...collection[index] }, createdAt: new Date().toISOString(),
  });
  if (event.kind === "fuel_purchase") {
    const amount = input.amountRupees ?? event.amountPaise / 100;
    const price = input.pricePerLitre ?? event.unitPricePaisePerLitre / 100;
    Object.assign(collection[index], { amountPaise: Math.round(amount * 100), unitPricePaisePerLitre: Math.round(price * 100), volumeMl: litresFromMoney(amount, price), isFullTank: input.isFullTank ?? event.isFullTank, occurredAt: input.occurredAt, note: input.note?.trim() ?? "", updatedAt: new Date().toISOString() });
  } else if (event.kind === "ride") {
    const distance = input.distanceKm ?? event.distanceM / 1000;
    Object.assign(collection[index], { distanceM: Math.round(distance * 1000), consumedMl: fuelForRide(distance, event.efficiencyMPerLitre / 1000), occurredAt: input.occurredAt, note: input.note?.trim() ?? "", updatedAt: new Date().toISOString() });
  } else {
    Object.assign(collection[index], { amountPaise: Math.round((input.amountRupees ?? event.amountPaise / 100) * 100), recipientMemberId: input.recipientMemberId ?? event.recipientMemberId, method: input.method ?? event.method, reference: input.reference?.trim() ?? "", occurredAt: input.occurredAt, updatedAt: new Date().toISOString() });
  }
  validateLocal(database, data.group.id);
  saveLocalDatabase(database);
}

export async function updateGroupSettings(data: GroupData, vehicleName: string, tankCapacityLitres: number, mileageKmPerLitre: number): Promise<void> {
  if (data.currentUserId !== data.group.adminUserId) throw new Error("Only the group admin can change scooter settings.");
  const update = {
    vehicle_name: vehicleName.trim(), tank_capacity_ml: Math.round(tankCapacityLitres * 1000),
    mileage_m_per_litre: Math.round(mileageKmPerLitre * 1000),
  };
  if (data.mode === "cloud") {
    const { error } = await getSupabase().from("groups").update(update).eq("id", data.group.id);
    if (error) throw new Error(error.message);
    return;
  }
  const database = loadLocalDatabase();
  const group = database.groups.find((entry) => entry.id === data.group.id);
  if (!group) throw new Error("Group not found.");
  Object.assign(group, { vehicleName: update.vehicle_name, tankCapacityMl: update.tank_capacity_ml, mileageMPerLitre: update.mileage_m_per_litre });
  validateLocal(database, group.id);
  saveLocalDatabase(database);
}

export function subscribeToGroup(groupId: string, onChange: () => void): () => void {
  if (!isCloudConfigured()) return () => undefined;
  const supabase = getSupabase();
  const channel = supabase.channel(`fuelshare:${groupId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "groups", filter: `id=eq.${groupId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "opening_balances", filter: `group_id=eq.${groupId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "opening_balance_owners", filter: `group_id=eq.${groupId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "fuel_purchases", filter: `group_id=eq.${groupId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "rides", filter: `group_id=eq.${groupId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "payments", filter: `group_id=eq.${groupId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "members", filter: `group_id=eq.${groupId}` }, onChange)
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}
