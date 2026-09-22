import { describe, expect, it } from "vitest";
import { calculateLedger, equalOwnershipShares, fuelForRide, litresFromMoney } from "@/lib/ledger";
import type { FuelPurchase, Group, Member, OpeningBalance, Ride, SettlementPayment } from "@/lib/types";

const group: Group = {
  id: "group",
  name: "Flat",
  inviteCode: "invite",
  vehicleName: "Activa",
  tankCapacityMl: 10_000,
  mileageMPerLitre: 45_000,
  adminUserId: "alice-user",
  setupStatus: "complete",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const members: Member[] = [
  { id: "alice", groupId: "group", userId: "alice-user", displayName: "Alice", role: "admin", createdAt: group.createdAt },
  { id: "bob", groupId: "group", userId: "bob-user", displayName: "Bob", role: "member", createdAt: group.createdAt },
  { id: "cara", groupId: "group", userId: "cara-user", displayName: "Cara", role: "member", createdAt: group.createdAt },
];

function purchase(overrides: Partial<FuelPurchase> = {}): FuelPurchase {
  return {
    id: "fuel-1", kind: "fuel_purchase", groupId: "group", payerMemberId: "alice", createdByUserId: "alice-user",
    amountPaise: 50_000, unitPricePaisePerLitre: 10_000, volumeMl: 5_000, isFullTank: false,
    occurredAt: "2026-01-01T10:00:00.000Z", createdAt: group.createdAt, updatedAt: group.createdAt, deletedAt: null, note: "", ...overrides,
  };
}

function ride(overrides: Partial<Ride> = {}): Ride {
  return {
    id: "ride-1", kind: "ride", groupId: "group", riderMemberId: "bob", createdByUserId: "bob-user",
    distanceM: 45_000, efficiencyMPerLitre: 45_000, consumedMl: 1_000,
    occurredAt: "2026-01-02T10:00:00.000Z", createdAt: group.createdAt, updatedAt: group.createdAt, deletedAt: null, note: "", ...overrides,
  };
}

function opening(overrides: Partial<OpeningBalance> = {}): OpeningBalance {
  return {
    id: "opening", kind: "opening_balance", groupId: "group", createdByUserId: "alice-user",
    amountPaise: 20_000, unitPricePaisePerLitre: 10_000, volumeMl: 2_000,
    ownershipMode: "single", ownerShares: [{ memberId: "alice", shareBasisPoints: 10_000 }],
    occurredAt: "2026-01-01T00:00:00.000Z", createdAt: group.createdAt, updatedAt: group.createdAt,
    deletedAt: null, note: "Estimated opening tank balance", ...overrides,
  };
}

it("converts money and rides to millilitres", () => {
  expect(litresFromMoney(500, 100)).toBe(5_000);
  expect(fuelForRide(45, 45)).toBe(1_000);
});

it("tracks remaining stock and charges the rider", () => {
  const result = calculateLedger(group, members, [purchase()], [ride()], []);
  expect(result.tank.remainingMl).toBe(4_000);
  expect(result.tank.remainingValuePaise).toBe(40_000);
  expect(result.memberBalances.find((item) => item.memberId === "alice")?.balancePaise).toBe(10_000);
  expect(result.memberBalances.find((item) => item.memberId === "bob")?.balancePaise).toBe(-10_000);
  expect(result.suggestedTransfers).toEqual([{ fromMemberId: "bob", toMemberId: "alice", amountPaise: 10_000 }]);
});

it("does not create debt when the fuel owner rides", () => {
  const result = calculateLedger(group, members, [purchase()], [ride({ riderMemberId: "alice" })], []);
  expect(result.memberBalances.every((item) => item.balancePaise === 0)).toBe(true);
  expect(result.tank.remainingValuePaise).toBe(40_000);
});

it("allocates fuel FIFO at each purchase price", () => {
  const purchases = [
    purchase({ id: "cheap", amountPaise: 20_000, volumeMl: 2_000 }),
    purchase({ id: "expensive", payerMemberId: "cara", createdByUserId: "cara-user", amountPaise: 36_000, unitPricePaisePerLitre: 12_000, volumeMl: 3_000, occurredAt: "2026-01-02T08:00:00.000Z" }),
  ];
  const result = calculateLedger(group, members, purchases, [ride({ distanceM: 135_000, consumedMl: 3_000, occurredAt: "2026-01-03T10:00:00.000Z" })], []);
  expect(result.memberBalances.find((item) => item.memberId === "bob")?.rideCostPaise).toBe(32_000);
  expect(result.memberBalances.find((item) => item.memberId === "alice")?.balancePaise).toBe(20_000);
  expect(result.memberBalances.find((item) => item.memberId === "cara")?.balancePaise).toBe(12_000);
  expect(result.tank.remainingValuePaise).toBe(24_000);
});

describe("full-tank calibration", () => {
  it("raises an underestimated balance to the actual pre-refill level", () => {
    const fullRefill = purchase({
      id: "full-refill",
      amountPaise: 50_000,
      volumeMl: 5_000,
      isFullTank: true,
      occurredAt: "2026-01-03T10:00:00.000Z",
    });

    const result = calculateLedger(group, members, [purchase(), fullRefill], [ride()], []);

    expect(result.tank.remainingMl).toBe(10_000);
    expect(result.tank.unattributedMl).toBe(1_000);
    expect(result.tank.remainingValuePaise).toBe(90_000);
    expect(result.calibrations).toEqual([{
      eventId: "full-refill",
      estimatedBeforeMl: 4_000,
      actualBeforeMl: 5_000,
      adjustmentMl: 1_000,
    }]);
    expect(result.issues).toEqual([]);
  });

  it("reduces an overestimated balance before adding the full refill", () => {
    const fullRefill = purchase({
      id: "full-refill",
      amountPaise: 70_000,
      volumeMl: 7_000,
      isFullTank: true,
      occurredAt: "2026-01-03T10:00:00.000Z",
    });

    const result = calculateLedger(group, members, [purchase(), fullRefill], [ride()], []);

    expect(result.tank.remainingMl).toBe(10_000);
    expect(result.tank.unattributedMl).toBe(0);
    expect(result.tank.remainingValuePaise).toBe(100_000);
    expect(result.calibrations[0]?.adjustmentMl).toBe(-1_000);
    expect(result.issues).toEqual([]);
  });

  it("still rejects a full refill larger than tank capacity", () => {
    const result = calculateLedger(group, members, [purchase({ volumeMl: 11_000, isFullTank: true })], [], []);
    expect(result.issues[0]?.code).toBe("tank_overflow");
  });
});

it("nets payments and simplifies transfers", () => {
  const rides = [ride(), ride({ id: "ride-2", riderMemberId: "cara", createdByUserId: "cara-user" })];
  const payment: SettlementPayment = {
    id: "pay", kind: "payment", groupId: "group", payerMemberId: "bob", recipientMemberId: "alice",
    createdByUserId: "bob-user", amountPaise: 6_000, method: "upi", reference: "", occurredAt: "2026-01-03T00:00:00.000Z",
    createdAt: group.createdAt, updatedAt: group.createdAt, deletedAt: null, note: "",
  };
  const result = calculateLedger(group, members, [purchase()], rides, [payment]);
  expect(result.suggestedTransfers).toEqual([
    { fromMemberId: "cara", toMemberId: "alice", amountPaise: 10_000 },
    { fromMemberId: "bob", toMemberId: "alice", amountPaise: 4_000 },
  ]);
});

describe("invalid timelines", () => {
  it("reports tank underflow", () => {
    const result = calculateLedger(group, members, [], [ride()], []);
    expect(result.issues[0]?.code).toBe("tank_underflow");
  });

  it("reports tank overflow", () => {
    const result = calculateLedger(group, members, [purchase({ volumeMl: 11_000 })], [], []);
    expect(result.issues[0]?.code).toBe("tank_overflow");
  });
});

describe("opening tank balance", () => {
  it("allows an empty opening followed by a partial refill", () => {
    const empty = opening({ amountPaise: 0, unitPricePaisePerLitre: 0, volumeMl: 0, ownershipMode: "empty", ownerShares: [] });
    const result = calculateLedger(group, members, [purchase({ amountPaise: 10_000, volumeMl: 1_000 })], [], [], [empty]);
    expect(result.tank.remainingMl).toBe(1_000);
    expect(result.issues).toEqual([]);
  });

  it("credits a single opening owner when another member consumes it", () => {
    const result = calculateLedger(group, members, [], [ride()], [], [opening()]);
    expect(result.memberBalances.find((balance) => balance.memberId === "alice")?.balancePaise).toBe(10_000);
    expect(result.memberBalances.find((balance) => balance.memberId === "bob")?.balancePaise).toBe(-10_000);
  });

  it("creates no debt when the single opening owner consumes it", () => {
    const result = calculateLedger(group, members, [], [ride({ riderMemberId: "alice" })], [], [opening()]);
    expect(result.memberBalances.every((balance) => balance.balancePaise === 0)).toBe(true);
  });

  it("credits two equal owners proportionally", () => {
    const equal = opening({ ownershipMode: "equal", ownerShares: equalOwnershipShares(["alice", "bob"]) });
    const result = calculateLedger(group, members, [], [ride({ riderMemberId: "cara" })], [], [equal]);
    expect(result.memberBalances.find((balance) => balance.memberId === "alice")?.balancePaise).toBe(5_000);
    expect(result.memberBalances.find((balance) => balance.memberId === "bob")?.balancePaise).toBe(5_000);
    expect(result.memberBalances.find((balance) => balance.memberId === "cara")?.balancePaise).toBe(-10_000);
  });

  it("preserves every paise when three owners split a rounded cost", () => {
    const dave: Member = { id: "dave", groupId: "group", userId: "dave-user", displayName: "Dave", role: "member", createdAt: group.createdAt };
    const equal = opening({ amountPaise: 101, volumeMl: 1_000, ownershipMode: "equal", ownerShares: equalOwnershipShares(["alice", "bob", "cara"]) });
    const result = calculateLedger(group, [...members, dave], [], [ride({ riderMemberId: "dave" })], [], [equal]);
    const balances = new Map(result.memberBalances.map((balance) => [balance.memberId, balance.balancePaise]));
    expect([balances.get("alice"), balances.get("bob"), balances.get("cara")]).toEqual([34, 34, 33]);
    expect(balances.get("dave")).toBe(-101);
    expect(result.memberBalances.reduce((sum, balance) => sum + balance.balancePaise, 0)).toBe(0);
  });

  it("ignores an equal owner's own portion", () => {
    const equal = opening({ ownershipMode: "equal", ownerShares: equalOwnershipShares(["alice", "bob"]) });
    const result = calculateLedger(group, members, [], [ride({ riderMemberId: "alice" })], [], [equal]);
    expect(result.memberBalances.find((balance) => balance.memberId === "alice")?.balancePaise).toBe(-5_000);
    expect(result.memberBalances.find((balance) => balance.memberId === "bob")?.balancePaise).toBe(5_000);
  });

  it("counts shared legacy fuel in ride cost without creating debt", () => {
    const shared = opening({ ownershipMode: "shared", ownerShares: [] });
    const result = calculateLedger(group, members, [], [ride()], [], [shared]);
    expect(result.memberBalances.every((balance) => balance.balancePaise === 0)).toBe(true);
    expect(result.memberBalances.find((balance) => balance.memberId === "bob")?.rideCostPaise).toBe(10_000);
    expect(result.tank.sharedOpeningMl).toBe(1_000);
    expect(result.tank.sharedOpeningValuePaise).toBe(10_000);
  });

  it("consumes opening fuel before a later differently priced refill", () => {
    const later = purchase({ id: "later", payerMemberId: "cara", createdByUserId: "cara-user", amountPaise: 36_000, unitPricePaisePerLitre: 12_000, volumeMl: 3_000, occurredAt: "2026-01-02T00:00:00.000Z" });
    const result = calculateLedger(group, members, [later], [ride({ consumedMl: 3_000, distanceM: 135_000, occurredAt: "2026-01-03T00:00:00.000Z" })], [], [opening()]);
    expect(result.memberBalances.find((balance) => balance.memberId === "alice")?.balancePaise).toBe(20_000);
    expect(result.memberBalances.find((balance) => balance.memberId === "cara")?.balancePaise).toBe(12_000);
    expect(result.memberBalances.find((balance) => balance.memberId === "bob")?.rideCostPaise).toBe(32_000);
    expect(result.tank.remainingValuePaise).toBe(24_000);
  });

  it("keeps legacy groups without an opening event on their previous accounting path", () => {
    const result = calculateLedger(group, members, [purchase()], [ride()], []);
    expect(result.suggestedTransfers).toEqual([{ fromMemberId: "bob", toMemberId: "alice", amountPaise: 10_000 }]);
  });
});
