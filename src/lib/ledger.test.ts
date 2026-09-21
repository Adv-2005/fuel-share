import { describe, expect, it } from "vitest";
import { calculateLedger, fuelForRide, litresFromMoney } from "@/lib/ledger";
import type { FuelPurchase, Group, Member, Ride, SettlementPayment } from "@/lib/types";

const group: Group = {
  id: "group",
  name: "Flat",
  inviteCode: "invite",
  vehicleName: "Activa",
  tankCapacityMl: 10_000,
  mileageMPerLitre: 45_000,
  adminUserId: "alice-user",
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
    amountPaise: 50_000, unitPricePaisePerLitre: 10_000, volumeMl: 5_000,
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
