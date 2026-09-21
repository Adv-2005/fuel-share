import type {
  DashboardSnapshot,
  FuelOwnerPosition,
  FuelPurchase,
  Group,
  Member,
  MemberBalance,
  Ride,
  SettlementPayment,
  SuggestedTransfer,
} from "@/lib/types";

interface FuelLot {
  ownerMemberId: string;
  remainingMl: number;
  remainingValuePaise: number;
}

type TankEvent =
  | { type: "fuel"; occurredAt: string; id: string; value: FuelPurchase }
  | { type: "ride"; occurredAt: string; id: string; value: Ride };

function chronologicalTankEvents(purchases: FuelPurchase[], rides: Ride[]): TankEvent[] {
  return [
    ...purchases.filter((entry) => !entry.deletedAt).map((value) => ({
      type: "fuel" as const,
      occurredAt: value.occurredAt,
      id: value.id,
      value,
    })),
    ...rides.filter((entry) => !entry.deletedAt).map((value) => ({
      type: "ride" as const,
      occurredAt: value.occurredAt,
      id: value.id,
      value,
    })),
  ].sort((a, b) => {
    const time = a.occurredAt.localeCompare(b.occurredAt);
    if (time !== 0) return time;
    if (a.type !== b.type) return a.type === "fuel" ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}

function buildTransfers(
  balances: MemberBalance[],
  memberNames: Map<string, string>,
): SuggestedTransfer[] {
  const debtors = balances
    .filter((item) => item.balancePaise < 0)
    .map((item) => ({ memberId: item.memberId, amount: -item.balancePaise }))
    .sort((a, b) => b.amount - a.amount || (memberNames.get(a.memberId) ?? "").localeCompare(memberNames.get(b.memberId) ?? ""));
  const creditors = balances
    .filter((item) => item.balancePaise > 0)
    .map((item) => ({ memberId: item.memberId, amount: item.balancePaise }))
    .sort((a, b) => b.amount - a.amount || (memberNames.get(a.memberId) ?? "").localeCompare(memberNames.get(b.memberId) ?? ""));

  const transfers: SuggestedTransfer[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = Math.min(debtor.amount, creditor.amount);
    if (amount > 0) {
      transfers.push({ fromMemberId: debtor.memberId, toMemberId: creditor.memberId, amountPaise: amount });
    }
    debtor.amount -= amount;
    creditor.amount -= amount;
    if (debtor.amount === 0) debtorIndex += 1;
    if (creditor.amount === 0) creditorIndex += 1;
  }
  return transfers;
}

export function calculateLedger(
  group: Group,
  members: Member[],
  purchases: FuelPurchase[],
  rides: Ride[],
  payments: SettlementPayment[],
): DashboardSnapshot {
  const balances = new Map<string, MemberBalance>();
  for (const member of members) {
    balances.set(member.id, { memberId: member.id, balancePaise: 0, rideCostPaise: 0, distanceM: 0 });
  }

  const lots: FuelLot[] = [];
  const issues: DashboardSnapshot["issues"] = [];
  let tankMl = 0;

  for (const event of chronologicalTankEvents(purchases, rides)) {
    if (event.type === "fuel") {
      const purchase = event.value;
      tankMl += purchase.volumeMl;
      lots.push({
        ownerMemberId: purchase.payerMemberId,
        remainingMl: purchase.volumeMl,
        remainingValuePaise: purchase.amountPaise,
      });
      if (tankMl > group.tankCapacityMl) {
        issues.push({
          eventId: purchase.id,
          code: "tank_overflow",
          message: "This refill would put the estimated tank above its configured capacity.",
        });
      }
      continue;
    }

    const ride = event.value;
    const riderBalance = balances.get(ride.riderMemberId);
    if (riderBalance) riderBalance.distanceM += ride.distanceM;
    let requiredMl = ride.consumedMl;
    tankMl -= requiredMl;
    if (tankMl < 0) {
      issues.push({
        eventId: ride.id,
        code: "tank_underflow",
        message: "This ride uses more fuel than the ledger says was available.",
      });
    }

    for (const lot of lots) {
      if (requiredMl <= 0) break;
      if (lot.remainingMl <= 0) continue;
      const consumedMl = Math.min(requiredMl, lot.remainingMl);
      const consumedCost = consumedMl === lot.remainingMl
        ? lot.remainingValuePaise
        : Math.round((lot.remainingValuePaise * consumedMl) / lot.remainingMl);
      lot.remainingMl -= consumedMl;
      lot.remainingValuePaise -= consumedCost;
      requiredMl -= consumedMl;

      if (lot.ownerMemberId !== ride.riderMemberId) {
        const ownerBalance = balances.get(lot.ownerMemberId);
        if (ownerBalance) ownerBalance.balancePaise += consumedCost;
        if (riderBalance) riderBalance.balancePaise -= consumedCost;
      }
      if (riderBalance) riderBalance.rideCostPaise += consumedCost;
    }
  }

  for (const payment of payments.filter((entry) => !entry.deletedAt)) {
    const payer = balances.get(payment.payerMemberId);
    const recipient = balances.get(payment.recipientMemberId);
    if (payer) payer.balancePaise += payment.amountPaise;
    if (recipient) recipient.balancePaise -= payment.amountPaise;
  }

  const fuelOwnerMap = new Map<string, FuelOwnerPosition>();
  for (const lot of lots) {
    if (lot.remainingMl <= 0) continue;
    const current = fuelOwnerMap.get(lot.ownerMemberId) ?? {
      memberId: lot.ownerMemberId,
      remainingMl: 0,
      remainingValuePaise: 0,
    };
    current.remainingMl += lot.remainingMl;
    current.remainingValuePaise += lot.remainingValuePaise;
    fuelOwnerMap.set(lot.ownerMemberId, current);
  }

  const memberBalances = [...balances.values()];
  const memberNames = new Map(members.map((member) => [member.id, member.displayName]));
  const remainingMl = Math.max(0, lots.reduce((sum, lot) => sum + lot.remainingMl, 0));
  const remainingValuePaise = lots.reduce((sum, lot) => sum + lot.remainingValuePaise, 0);

  return {
    tank: {
      remainingMl,
      remainingValuePaise,
      capacityMl: group.tankCapacityMl,
      percent: group.tankCapacityMl > 0 ? Math.min(100, Math.max(0, (remainingMl / group.tankCapacityMl) * 100)) : 0,
    },
    fuelOwners: [...fuelOwnerMap.values()].sort((a, b) => b.remainingValuePaise - a.remainingValuePaise),
    memberBalances,
    suggestedTransfers: buildTransfers(memberBalances, memberNames),
    issues,
  };
}

export function litresFromMoney(amountRupees: number, pricePerLitre: number): number {
  return Math.round((amountRupees / pricePerLitre) * 1000);
}

export function fuelForRide(distanceKm: number, mileageKmPerLitre: number): number {
  return Math.round((distanceKm / mileageKmPerLitre) * 1000);
}
