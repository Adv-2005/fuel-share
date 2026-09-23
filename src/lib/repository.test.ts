import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addFuel,
  addRide,
  createGroup,
  createRidePreset,
  dashboardRidePresets,
  deleteRidePreset,
  loadCurrentGroup,
  logRideFromPreset,
  saveOpeningBalance,
  selectAccessibleGroupId,
  updateRidePreset,
  validateOpeningBalanceInput,
  voidRide,
} from "@/lib/repository";
import type { FuelPurchase, GroupData, Member, RidePreset } from "@/lib/types";

const now = "2026-01-01T00:00:00.000Z";

function member(id: string, userId: string): Member {
  return { id, groupId: "group", userId, displayName: id, role: id === "alice" ? "admin" : "member", createdAt: now };
}

function preset(overrides: Partial<RidePreset> = {}): RidePreset {
  return {
    id: "preset-1", groupId: "group", memberId: "alice", label: "College", distanceM: 8_000,
    isPinned: true, displayOrder: 0, lastUsedAt: null, usageCount: 0, createdAt: now, updatedAt: now,
    ...overrides,
  };
}

function groupData(overrides: Partial<GroupData> = {}): GroupData {
  return {
    group: { id: "group", name: "Flat", inviteCode: "invite", vehicleName: "Activa", tankCapacityMl: 10_000, mileageMPerLitre: 40_000, adminUserId: "alice-user", setupStatus: "complete", createdAt: now },
    members: [member("alice", "alice-user"), member("bob", "bob-user")], purchases: [], openingBalances: [], rides: [], payments: [], presets: [], revisions: [],
    currentUserId: "alice-user", currentMemberId: "alice", pendingEventIds: [], mode: "local", ...overrides,
  };
}

function seedLocal(data: GroupData): void {
  const purchase: FuelPurchase = {
    id: "fuel", kind: "fuel_purchase", groupId: "group", payerMemberId: "alice", createdByUserId: "alice-user",
    amountPaise: 50_000, unitPricePaisePerLitre: 10_000, volumeMl: 5_000, isFullTank: false,
    occurredAt: now, createdAt: now, updatedAt: now, deletedAt: null, note: "",
  };
  localStorage.setItem("fuelshare_user_id", data.currentUserId);
  localStorage.setItem("fuelshare_active_group", data.group.id);
  localStorage.setItem("fuelshare_database_v1", JSON.stringify({
    groups: [data.group], members: data.members, purchases: [purchase], openingBalances: data.openingBalances, rides: data.rides,
    payments: data.payments, presets: data.presets, revisions: data.revisions,
  }));
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

vi.mock("@/lib/supabase", () => ({ isCloudConfigured: () => false, getSupabase: vi.fn() }));

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

describe("ride presets", () => {
  it("creates a personal preset in metres", async () => {
    const data = groupData();
    seedLocal(data);

    const created = await createRidePreset(data, { label: " College ", distanceKm: 8, isPinned: true });
    const loaded = await loadCurrentGroup("group");

    expect(created).toMatchObject({ label: "College", distanceM: 8_000, memberId: "alice", isPinned: true });
    expect(loaded?.presets).toEqual([created]);
  });

  it("rejects case-insensitive duplicate labels for one member", async () => {
    const data = groupData();
    seedLocal(data);
    await createRidePreset(data, { label: "College", distanceKm: 8, isPinned: true });

    await expect(createRidePreset(data, { label: " college ", distanceKm: 9, isPinned: false }))
      .rejects.toThrow("already have");
  });

  it("permits the same label for different members", async () => {
    const aliceData = groupData();
    seedLocal(aliceData);
    await createRidePreset(aliceData, { label: "Gym", distanceKm: 2, isPinned: true });
    const bobData = groupData({ currentUserId: "bob-user", currentMemberId: "bob" });

    await expect(createRidePreset(bobData, { label: "gym", distanceKm: 3, isPinned: true })).resolves.toMatchObject({ memberId: "bob" });
  });

  it("logs through addRide with the preset distance, mileage, id, and label snapshot", async () => {
    const college = preset();
    const data = groupData({ presets: [college] });
    seedLocal(data);

    const { ride } = await logRideFromPreset(data, college);

    expect(ride).toMatchObject({ distanceM: 8_000, efficiencyMPerLitre: 40_000, consumedMl: 200, presetId: college.id, presetLabel: "College" });
    const loaded = await loadCurrentGroup("group");
    expect(loaded?.presets[0]).toMatchObject({ usageCount: 1, lastUsedAt: expect.any(String) });
  });

  it("soft deletes an undone ride and retains its prior state as a revision", async () => {
    const college = preset();
    const data = groupData({ presets: [college] });
    seedLocal(data);
    const { ride } = await logRideFromPreset(data, college);

    await voidRide(data, ride);
    const loaded = await loadCurrentGroup("group");

    expect(loaded?.rides[0].deletedAt).toEqual(expect.any(String));
    expect(loaded?.revisions[0]).toMatchObject({ entityType: "ride", entityId: ride.id, previousData: expect.objectContaining({ deletedAt: null }) });
  });

  it("deletes a preset without changing the earlier ride label snapshot", async () => {
    const college = preset();
    const data = groupData({ presets: [college] });
    seedLocal(data);
    await logRideFromPreset(data, college);

    await deleteRidePreset(data, college);
    const loaded = await loadCurrentGroup("group");

    expect(loaded?.presets).toEqual([]);
    expect(loaded?.rides[0]).toMatchObject({ presetId: null, presetLabel: "College", distanceM: 8_000 });
  });

  it("edits a preset without changing earlier ride snapshots", async () => {
    const college = preset();
    const data = groupData({ presets: [college] });
    seedLocal(data);
    await logRideFromPreset(data, college);

    await updateRidePreset(data, college, { label: "Campus", distanceKm: 9, isPinned: false });
    const loaded = await loadCurrentGroup("group");

    expect(loaded?.presets[0]).toMatchObject({ label: "Campus", distanceM: 9_000, isPinned: false });
    expect(loaded?.rides[0]).toMatchObject({ presetLabel: "College", distanceM: 8_000 });
  });

  it("returns only the first four pinned presets in member order", () => {
    const presets = [
      preset({ id: "5", label: "Five", displayOrder: 5 }), preset({ id: "2", label: "Two", displayOrder: 2 }),
      preset({ id: "1", label: "One", displayOrder: 1 }), preset({ id: "4", label: "Four", displayOrder: 4 }),
      preset({ id: "3", label: "Three", displayOrder: 3 }), preset({ id: "hidden", label: "Hidden", displayOrder: 0, isPinned: false }),
    ];
    expect(dashboardRidePresets(presets).map((entry) => entry.label)).toEqual(["One", "Two", "Three", "Four"]);
  });

  it("rejects attempts to alter another member's preset", async () => {
    const data = groupData({ presets: [preset({ memberId: "bob" })] });
    seedLocal(data);
    await expect(updateRidePreset(data, data.presets[0], { label: "Mine", distanceKm: 2, isPinned: true }))
      .rejects.toThrow("your own");
  });

  it("queues an offline quick ride in the existing pending-event queue", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    const college = preset();
    const data = groupData({ mode: "cloud", presets: [college] });

    const result = await logRideFromPreset(data, college);
    const pending = JSON.parse(localStorage.getItem("fuelshare_pending_actions_v1") ?? "[]") as Array<{ operation: string; event: { id: string; presetLabel: string } }>;

    expect(result.pendingSync).toBe(true);
    expect(pending).toEqual([expect.objectContaining({ operation: "insert", event: expect.objectContaining({ id: result.ride.id, presetLabel: "College" }) })]);

    await voidRide(data, result.ride);
    const afterUndo = JSON.parse(localStorage.getItem("fuelshare_pending_actions_v1") ?? "[]") as Array<{ operation: string; event: { deletedAt: string | null } }>;
    expect(afterUndo).toHaveLength(2);
    expect(afterUndo[1]).toMatchObject({ operation: "update", event: { deletedAt: expect.any(String) } });
  });

  it("defines member-private CRUD policies in the additive migration", () => {
    const migration = readFileSync("supabase/migrations/004_ride_presets.sql", "utf8");
    expect(migration).toContain("ride_presets_select_own");
    expect(migration).toContain("ride_presets_insert_own");
    expect(migration).toContain("ride_presets_update_own");
    expect(migration).toContain("ride_presets_delete_own");
    expect(migration.match(/public\.is_own_member\(member_id, group_id\)/g)).toHaveLength(5);
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
