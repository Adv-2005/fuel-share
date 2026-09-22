import { beforeEach, describe, expect, it, vi } from "vitest";
import { addFuel, addRide, createGroup, loadCurrentGroup, saveOpeningBalance, selectAccessibleGroupId, validateOpeningBalanceInput } from "@/lib/repository";

vi.mock("@/lib/supabase", () => ({ isCloudConfigured: () => false, getSupabase: vi.fn() }));

beforeEach(() => window.localStorage.clear());

describe("selectAccessibleGroupId", () => {
  it("keeps the preferred group when the cloud user is a member", () => {
    expect(selectAccessibleGroupId("group-b", ["group-a", "group-b"])).toBe("group-b");
  });

  it("falls back to a cloud membership when the cached local group is stale", () => {
    expect(selectAccessibleGroupId("old-local-group", ["cloud-group"])).toBe("cloud-group");
  });

  it("returns no group when the cloud user has no memberships", () => {
    expect(selectAccessibleGroupId("old-local-group", [])).toBeNull();
  });
});

describe("opening balance validation", () => {
  it("rejects opening fuel above tank capacity", () => {
    expect(() => validateOpeningBalanceInput({
      volumeLitres: 6, pricePerLitre: 100, ownershipMode: "single", ownerMemberIds: ["alice"],
    }, 5_000, ["alice"])).toThrow("between zero and the tank capacity");
  });

  it("requires at least two joined members for equal ownership", () => {
    expect(() => validateOpeningBalanceInput({
      volumeLitres: 2, pricePerLitre: 100, ownershipMode: "equal", ownerMemberIds: ["alice"],
    }, 5_000, ["alice"])).toThrow("at least two");
  });

  it("rejects a correction that would overflow the historical tank", async () => {
    const data = await createGroup({
      groupName: "Flat", vehicleName: "Activa", displayName: "Alice",
      tankCapacityLitres: 10, mileageKmPerLitre: 45, opening: { state: "empty" },
    });
    await addFuel(data, { amountRupees: 900, pricePerLitre: 100, isFullTank: false, occurredAt: "2099-01-01T00:00:00.000Z" });
    const fresh = await loadCurrentGroup(data.group.id);
    await expect(saveOpeningBalance(fresh!, {
      volumeLitres: 2, pricePerLitre: 100, ownershipMode: "single", ownerMemberIds: [data.currentMemberId],
    })).rejects.toThrow("above its configured capacity");
  });

  it("rejects a correction that would underflow the historical tank", async () => {
    const data = await createGroup({
      groupName: "Flat", vehicleName: "Activa", displayName: "Alice", tankCapacityLitres: 10, mileageKmPerLitre: 45,
      opening: { state: "existing", volumeLitres: 2, pricePerLitre: 100, ownershipMode: "single" },
    });
    await addRide(data, { distanceKm: 67.5, occurredAt: "2099-01-01T00:00:00.000Z" });
    const fresh = await loadCurrentGroup(data.group.id);
    await expect(saveOpeningBalance(fresh!, {
      volumeLitres: 1, pricePerLitre: 100, ownershipMode: "single", ownerMemberIds: [data.currentMemberId],
    })).rejects.toThrow("more fuel than the ledger says was available");
  });

  it("preserves the previous opening values in revision history", async () => {
    const data = await createGroup({
      groupName: "Flat", vehicleName: "Activa", displayName: "Alice", tankCapacityLitres: 10, mileageKmPerLitre: 45,
      opening: { state: "existing", volumeLitres: 2, pricePerLitre: 100, ownershipMode: "single" },
    });
    await saveOpeningBalance(data, {
      volumeLitres: 1.5, pricePerLitre: 101, ownershipMode: "single", ownerMemberIds: [data.currentMemberId],
    });
    const fresh = await loadCurrentGroup(data.group.id);
    expect(fresh?.revisions[0]).toMatchObject({ entityType: "opening_balance", previousData: { volumeMl: 2_000, amountPaise: 20_000 } });
  });
});
