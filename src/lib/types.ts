export type MemberRole = "admin" | "member";
export type PaymentMethod = "upi" | "cash";
export type EventKind = "opening_balance" | "fuel_purchase" | "ride" | "payment";
export type SetupStatus = "pending" | "complete";
export type OpeningOwnershipMode = "empty" | "single" | "equal" | "shared";

export interface Group {
  id: string;
  name: string;
  inviteCode: string;
  vehicleName: string;
  tankCapacityMl: number;
  mileageMPerLitre: number;
  adminUserId: string;
  setupStatus: SetupStatus;
  createdAt: string;
}

export interface Member {
  id: string;
  groupId: string;
  userId: string;
  displayName: string;
  role: MemberRole;
  createdAt: string;
}

interface BaseEvent {
  id: string;
  groupId: string;
  createdByUserId: string;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  note: string;
}

export interface FuelPurchase extends BaseEvent {
  kind: "fuel_purchase";
  payerMemberId: string;
  amountPaise: number;
  unitPricePaisePerLitre: number;
  volumeMl: number;
  isFullTank: boolean;
}

export interface OpeningOwnerShare {
  memberId: string;
  shareBasisPoints: number;
}

export interface OpeningBalance extends BaseEvent {
  kind: "opening_balance";
  amountPaise: number;
  unitPricePaisePerLitre: number;
  volumeMl: number;
  ownershipMode: OpeningOwnershipMode;
  ownerShares: OpeningOwnerShare[];
}

export interface Ride extends BaseEvent {
  kind: "ride";
  riderMemberId: string;
  distanceM: number;
  efficiencyMPerLitre: number;
  consumedMl: number;
}

export interface SettlementPayment extends BaseEvent {
  kind: "payment";
  payerMemberId: string;
  recipientMemberId: string;
  amountPaise: number;
  method: PaymentMethod;
  reference: string;
}

export type LedgerEvent = OpeningBalance | FuelPurchase | Ride | SettlementPayment;

export interface EventRevision {
  id: string;
  groupId: string;
  entityType: EventKind;
  entityId: string;
  changedByUserId: string;
  previousData: Record<string, unknown>;
  createdAt: string;
}

export interface FuelOwnerPosition {
  memberId: string;
  remainingMl: number;
  remainingValuePaise: number;
}

export interface MemberBalance {
  memberId: string;
  balancePaise: number;
  rideCostPaise: number;
  distanceM: number;
}

export interface SuggestedTransfer {
  fromMemberId: string;
  toMemberId: string;
  amountPaise: number;
}

export interface LedgerIssue {
  eventId: string;
  code: "tank_underflow" | "tank_overflow";
  message: string;
}

export interface FuelCalibration {
  eventId: string;
  estimatedBeforeMl: number;
  actualBeforeMl: number;
  adjustmentMl: number;
}

export interface DashboardSnapshot {
  tank: {
    remainingMl: number;
    remainingValuePaise: number;
    unattributedMl: number;
    sharedOpeningMl: number;
    sharedOpeningValuePaise: number;
    capacityMl: number;
    percent: number;
  };
  calibrations: FuelCalibration[];
  fuelOwners: FuelOwnerPosition[];
  memberBalances: MemberBalance[];
  suggestedTransfers: SuggestedTransfer[];
  issues: LedgerIssue[];
}

export interface GroupData {
  group: Group;
  members: Member[];
  purchases: FuelPurchase[];
  openingBalances: OpeningBalance[];
  rides: Ride[];
  payments: SettlementPayment[];
  revisions: EventRevision[];
  currentUserId: string;
  currentMemberId: string;
  pendingEventIds: string[];
  mode: "local" | "cloud";
}

export interface CreateGroupInput {
  groupName: string;
  vehicleName: string;
  displayName: string;
  tankCapacityLitres: number;
  mileageKmPerLitre: number;
  opening:
    | { state: "empty" }
    | { state: "deferred" }
    | {
        state: "existing";
        volumeLitres: number;
        pricePerLitre: number;
        ownershipMode: "single" | "shared";
      };
}

export interface SaveOpeningBalanceInput {
  volumeLitres: number;
  pricePerLitre: number;
  ownershipMode: OpeningOwnershipMode;
  ownerMemberIds: string[];
}

export interface CreateRideInput {
  distanceKm: number;
  occurredAt: string;
  note?: string;
}

export interface CreateFuelInput {
  amountRupees: number;
  pricePerLitre: number;
  isFullTank: boolean;
  occurredAt: string;
  note?: string;
}

export interface CreatePaymentInput {
  recipientMemberId: string;
  amountRupees: number;
  method: PaymentMethod;
  reference?: string;
  occurredAt: string;
}
