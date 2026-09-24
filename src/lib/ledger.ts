import type {
  DashboardSnapshot,
  FuelOwnerPosition,
  FuelPurchase,
  Group,
  Member,
  MemberBalance,
  OpeningBalance,
  OpeningOwnerShare,
  Ride,
  SettlementPayment,
  SuggestedTransfer,
} from "@/lib/types";

interface FuelLot {
  ownerPositions: Array<{
    memberId: string;
    remainingMl: number;
    remainingValuePaise: number;
  }>;
  source: "owned" | "shared_opening" | "calibration";
  remainingMl: number;
  remainingValuePaise: number;
}

type TankEvent =
  | { type: "opening"; occurredAt: string; id: string; value: OpeningBalance }
  | { type: "fuel"; occurredAt: string; id: string; value: FuelPurchase }
  | { type: "ride"; occurredAt: string; id: string; value: Ride };

function chronologicalTankEvents(openings: OpeningBalance[], purchases: FuelPurchase[], rides: Ride[]): TankEvent[] {
  return [
    ...openings.filter((entry) => !entry.deletedAt).map((value) => ({
      type: "opening" as const, occurredAt: value.occurredAt, id: value.id, value,
    })),
    ...purchases.filter((entry) => !entry.deletedAt).map((value) => ({
      type: "fuel" as const, occurredAt: value.occurredAt, id: value.id, value,
    })),
    ...rides.filter((entry) => !entry.deletedAt).map((value) => ({
      type: "ride" as const, occurredAt: value.occurredAt, id: value.id, value,
    })),
  ].sort((a, b) => {
    const time = a.occurredAt.localeCompare(b.occurredAt);
    if (time !== 0) return time;
    const priority = { opening: 0, fuel: 1, ride: 2 } as const;
    if (a.type !== b.type) return priority[a.type] - priority[b.type];
    return a.id.localeCompare(b.id);
  });
}

/** Splits an integer without losing a unit, using stable largest-remainder rounding. */
export function splitByOwnership(total: number, shares: OpeningOwnerShare[]): Array<{ memberId: string; amount: number }> {
  if (total <= 0 || shares.length === 0) return shares.map((share) => ({ memberId: share.memberId, amount: 0 }));
  const parts = shares.map((share) => {
    const exactNumerator = total * share.shareBasisPoints;
    return {
      memberId: share.memberId,
      amount: Math.floor(exactNumerator / 10_000),
      remainder: exactNumerator % 10_000,
    };
  });
  const unallocated = total - parts.reduce((sum, part) => sum + part.amount, 0);
  const roundingOrder = [...parts].sort((a, b) => b.remainder - a.remainder || a.memberId.localeCompare(b.memberId));
  for (let index = 0; index < unallocated; index += 1) roundingOrder[index % roundingOrder.length].amount += 1;
  return parts.map(({ memberId, amount }) => ({ memberId, amount }));
}

function createFuelLot(
  ownerShares: OpeningOwnerShare[],
  source: FuelLot["source"],
  volumeMl: number,
  valuePaise: number,
): FuelLot {
  const volumes = new Map(splitByOwnership(volumeMl, ownerShares).map((part) => [part.memberId, part.amount]));
  const values = new Map(splitByOwnership(valuePaise, ownerShares).map((part) => [part.memberId, part.amount]));
  return {
    ownerPositions: ownerShares.map((share) => ({
      memberId: share.memberId,
      remainingMl: volumes.get(share.memberId) ?? 0,
      remainingValuePaise: values.get(share.memberId) ?? 0,
    })),
    source,
    remainingMl: volumeMl,
    remainingValuePaise: valuePaise,
  };
}

function consumeOwnerPositions(
  amount: number,
  positions: FuelLot["ownerPositions"],
  field: "remainingMl" | "remainingValuePaise",
): Array<{ memberId: string; amount: number }> {
  const available = positions.reduce((sum, position) => sum + position[field], 0);
  if (amount <= 0 || available <= 0) return positions.map((position) => ({ memberId: position.memberId, amount: 0 }));

  const consumed = Math.min(amount, available);
  const parts = positions.map((position) => {
    const exactNumerator = consumed * position[field];
    return {
      memberId: position.memberId,
      amount: Math.floor(exactNumerator / available),
      remainder: exactNumerator % available,
      position,
    };
  });
  const unallocated = consumed - parts.reduce((sum, part) => sum + part.amount, 0);
  const roundingOrder = [...parts].sort((a, b) => b.remainder - a.remainder || a.memberId.localeCompare(b.memberId));
  for (let index = 0; index < unallocated; index += 1) roundingOrder[index].amount += 1;
  for (const part of parts) part.position[field] -= part.amount;
  return parts.map(({ memberId, amount: allocated }) => ({ memberId, amount: allocated }));
}

export function equalOwnershipShares(memberIds: string[]): OpeningOwnerShare[] {
  const uniqueIds = [...new Set(memberIds)].sort();
  if (uniqueIds.length === 0) return [];
  const base = Math.floor(10_000 / uniqueIds.length);
  const remainder = 10_000 - base * uniqueIds.length;
  return uniqueIds.map((memberId, index) => ({ memberId, shareBasisPoints: base + (index < remainder ? 1 : 0) }));
}

/** Split a fuel-lot cost in paise, with remainder going to the driver first. */
export function splitRideCost(
  costPaise: number,
  driverMemberId: string,
  participantMemberIds: string[],
): Array<{ memberId: string; amountPaise: number }> {
  const additionalParticipants = participantMemberIds
    .filter((memberId) => memberId !== driverMemberId)
    .sort((a, b) => a.localeCompare(b));
  const orderedParticipants = [driverMemberId, ...additionalParticipants];
  if (orderedParticipants.length === 0) return [];
  const baseShare = Math.floor(costPaise / orderedParticipants.length);
  const remainder = costPaise - baseShare * orderedParticipants.length;
  return orderedParticipants.map((memberId, index) => ({
    memberId,
    amountPaise: baseShare + (index < remainder ? 1 : 0),
  }));
}

function buildTransfers(balances: MemberBalance[], memberNames: Map<string, string>): SuggestedTransfer[] {
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
    if (amount > 0) transfers.push({ fromMemberId: debtor.memberId, toMemberId: creditor.memberId, amountPaise: amount });
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
  openingBalances: OpeningBalance[] = [],
): DashboardSnapshot {
  const balances = new Map<string, MemberBalance>();
  for (const member of members) balances.set(member.id, { memberId: member.id, balancePaise: 0, rideCostPaise: 0, distanceM: 0 });

  const lots: FuelLot[] = [];
  const issues: DashboardSnapshot["issues"] = [];
  const calibrations: DashboardSnapshot["calibrations"] = [];
  let tankMl = 0;

  for (const event of chronologicalTankEvents(openingBalances, purchases, rides)) {
    if (event.type === "opening") {
      const opening = event.value;
      tankMl += opening.volumeMl;
      lots.push(createFuelLot(
        opening.ownerShares,
        opening.ownershipMode === "shared" ? "shared_opening" : "owned",
        opening.volumeMl,
        opening.amountPaise,
      ));
      if (tankMl > group.tankCapacityMl) issues.push({
        eventId: opening.id,
        code: "tank_overflow",
        message: "The opening petrol exceeds the configured tank capacity.",
      });
      continue;
    }

    if (event.type === "fuel") {
      const purchase = event.value;
      if (purchase.isFullTank) {
        const estimatedBeforeMl = Math.max(0, lots.reduce((sum, lot) => sum + lot.remainingMl, 0));
        const actualBeforeMl = Math.max(0, group.tankCapacityMl - purchase.volumeMl);
        const adjustmentMl = actualBeforeMl - estimatedBeforeMl;

        if (adjustmentMl < 0) {
          let correctionMl = -adjustmentMl;
          for (const lot of lots) {
            if (correctionMl <= 0) break;
            if (lot.remainingMl <= 0) continue;
            const removedMl = Math.min(correctionMl, lot.remainingMl);
            const removedValuePaise = removedMl === lot.remainingMl
              ? lot.remainingValuePaise
              : Math.round((lot.remainingValuePaise * removedMl) / lot.remainingMl);
            consumeOwnerPositions(removedMl, lot.ownerPositions, "remainingMl");
            consumeOwnerPositions(removedValuePaise, lot.ownerPositions, "remainingValuePaise");
            lot.remainingMl -= removedMl;
            lot.remainingValuePaise -= removedValuePaise;
            correctionMl -= removedMl;
          }
        } else if (adjustmentMl > 0) {
          lots.push(createFuelLot([], "calibration", adjustmentMl, 0));
        }

        calibrations.push({ eventId: purchase.id, estimatedBeforeMl, actualBeforeMl, adjustmentMl });
        tankMl = actualBeforeMl;
      }
      tankMl += purchase.volumeMl;
      lots.push(createFuelLot(
        [{ memberId: purchase.payerMemberId, shareBasisPoints: 10_000 }],
        "owned",
        purchase.volumeMl,
        purchase.amountPaise,
      ));
      if (tankMl > group.tankCapacityMl) issues.push({
        eventId: purchase.id,
        code: "tank_overflow",
        message: "This refill would put the estimated tank above its configured capacity.",
      });
      continue;
    }

    const ride = event.value;
    const participantMemberIds = ride.participantMemberIds?.length
      ? ride.participantMemberIds
      : [ride.riderMemberId];
    for (const participantId of participantMemberIds) {
      const participantBalance = balances.get(participantId);
      if (participantBalance) participantBalance.distanceM += ride.distanceM;
    }
    let requiredMl = ride.consumedMl;
    tankMl -= requiredMl;
    if (tankMl < 0) issues.push({
      eventId: ride.id,
      code: "tank_underflow",
      message: "This ride uses more fuel than the ledger says was available.",
    });

    for (const lot of lots) {
      if (requiredMl <= 0) break;
      if (lot.remainingMl <= 0) continue;
      const consumedMl = Math.min(requiredMl, lot.remainingMl);
      const consumedCost = consumedMl === lot.remainingMl
        ? lot.remainingValuePaise
        : Math.round((lot.remainingValuePaise * consumedMl) / lot.remainingMl);
      consumeOwnerPositions(consumedMl, lot.ownerPositions, "remainingMl");
      const ownerAllocations = consumeOwnerPositions(consumedCost, lot.ownerPositions, "remainingValuePaise");
      lot.remainingMl -= consumedMl;
      lot.remainingValuePaise -= consumedCost;
      requiredMl -= consumedMl;

      for (const allocation of ownerAllocations) {
        const ownerBalance = balances.get(allocation.memberId);
        if (ownerBalance) ownerBalance.balancePaise += allocation.amount;
      }
      for (const share of splitRideCost(consumedCost, ride.riderMemberId, participantMemberIds)) {
        const participantBalance = balances.get(share.memberId);
        if (participantBalance) participantBalance.rideCostPaise += share.amountPaise;
        // Unowned shared opening fuel has a cost for statistics, but creates no debt.
        if (participantBalance && ownerAllocations.length > 0) participantBalance.balancePaise -= share.amountPaise;
      }
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
    if (lot.remainingMl <= 0 || lot.ownerPositions.length === 0) continue;
    for (const position of lot.ownerPositions) {
      const current = fuelOwnerMap.get(position.memberId) ?? { memberId: position.memberId, remainingMl: 0, remainingValuePaise: 0 };
      current.remainingMl += position.remainingMl;
      current.remainingValuePaise += position.remainingValuePaise;
      fuelOwnerMap.set(position.memberId, current);
    }
  }

  const memberBalances = [...balances.values()];
  const memberNames = new Map(members.map((member) => [member.id, member.displayName]));
  const remainingMl = Math.max(0, lots.reduce((sum, lot) => sum + lot.remainingMl, 0));
  const remainingValuePaise = lots.reduce((sum, lot) => sum + lot.remainingValuePaise, 0);
  const unattributedMl = lots.reduce((sum, lot) => sum + (lot.source === "calibration" ? lot.remainingMl : 0), 0);
  const sharedOpeningMl = lots.reduce((sum, lot) => sum + (lot.source === "shared_opening" ? lot.remainingMl : 0), 0);
  const sharedOpeningValuePaise = lots.reduce((sum, lot) => sum + (lot.source === "shared_opening" ? lot.remainingValuePaise : 0), 0);

  return {
    tank: {
      remainingMl,
      remainingValuePaise,
      unattributedMl,
      sharedOpeningMl,
      sharedOpeningValuePaise,
      capacityMl: group.tankCapacityMl,
      percent: group.tankCapacityMl > 0 ? Math.min(100, Math.max(0, (remainingMl / group.tankCapacityMl) * 100)) : 0,
    },
    calibrations,
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
