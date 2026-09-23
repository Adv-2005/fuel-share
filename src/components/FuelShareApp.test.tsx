import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FuelShareApp } from "@/components/FuelShareApp";
import { addFuel, createRidePreset, loadCurrentGroup, logRideFromPreset, updateRidePreset, voidRide } from "@/lib/repository";
import type { GroupData, Ride, RidePreset } from "@/lib/types";

vi.mock("@/lib/repository", () => ({
  addFuel: vi.fn(),
  addPayment: vi.fn(),
  addRide: vi.fn(),
  createRidePreset: vi.fn(),
  createGroup: vi.fn(),
  dashboardRidePresets: vi.fn((presets: RidePreset[]) => presets.filter((preset) => preset.isPinned).sort((a, b) => a.displayOrder - b.displayOrder).slice(0, 4)),
  deleteRidePreset: vi.fn(),
  joinGroup: vi.fn(),
  loadCurrentGroup: vi.fn().mockResolvedValue(null),
  logRideFromPreset: vi.fn(),
  moveRidePreset: vi.fn(),
  subscribeToGroup: vi.fn(() => () => undefined),
  updateEvent: vi.fn(),
  updateGroupSettings: vi.fn(),
  updateRidePreset: vi.fn(),
  voidRide: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({ isCloudConfigured: vi.fn(() => false) }));

const timestamp = "2026-01-01T00:00:00.000Z";

function preset(label = "College", order = 0): RidePreset {
  return { id: `preset-${label}`, groupId: "group", memberId: "member", label, distanceM: 8_000, isPinned: true, displayOrder: order, lastUsedAt: null, usageCount: 0, createdAt: timestamp, updatedAt: timestamp };
}

function dashboardData(presets: RidePreset[] = []): GroupData {
  return {
    group: { id: "group", name: "Flat", inviteCode: "invite", vehicleName: "Activa", tankCapacityMl: 10_000, mileageMPerLitre: 45_000, adminUserId: "user", createdAt: timestamp },
    members: [{ id: "member", groupId: "group", userId: "user", displayName: "Aditya", role: "admin", createdAt: timestamp }],
    purchases: [{ id: "fuel", kind: "fuel_purchase", groupId: "group", payerMemberId: "member", createdByUserId: "user", amountPaise: 50_000, unitPricePaisePerLitre: 10_000, volumeMl: 5_000, isFullTank: false, occurredAt: timestamp, createdAt: timestamp, updatedAt: timestamp, deletedAt: null, note: "" }],
    rides: [], payments: [], presets, revisions: [], currentUserId: "user", currentMemberId: "member", pendingEventIds: [], mode: "local",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadCurrentGroup).mockResolvedValue(null);
});

describe("FuelShareApp", () => {
  it("shows low-friction group setup for a new user", async () => {
    render(<FuelShareApp />);
    expect(await screen.findByRole("heading", { name: "Petrol tracking your group will actually use." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create FuelShare" })).toBeInTheDocument();
    expect(screen.getByText(/Local mode/)).toBeInTheDocument();
  });

  it("shows display-name onboarding from an invite link", () => {
    render(<FuelShareApp inviteCode="private-invite" />);
    expect(screen.getByRole("heading", { name: "Join the scooter group" })).toBeInTheDocument();
    expect(screen.getByLabelText("Your display name")).toBeInTheDocument();
  });

  it("records when a refill filled the tank completely", async () => {
    const data: GroupData = {
      group: {
        id: "group",
        name: "Flat",
        inviteCode: "invite",
        vehicleName: "Activa",
        tankCapacityMl: 10_000,
        mileageMPerLitre: 45_000,
        adminUserId: "user",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      members: [{ id: "member", groupId: "group", userId: "user", displayName: "Alice", role: "admin", createdAt: "2026-01-01T00:00:00.000Z" }],
      purchases: [],
      rides: [],
      payments: [],
      presets: [],
      revisions: [],
      currentUserId: "user",
      currentMemberId: "member",
      pendingEventIds: [],
      mode: "local",
    };
    vi.mocked(loadCurrentGroup).mockResolvedValue(data);
    const user = userEvent.setup();

    render(<FuelShareApp />);
    await user.click(await screen.findByRole("button", { name: /Add petrol/ }));
    await user.type(screen.getByLabelText("Amount paid (₹)"), "500");
    await user.type(screen.getByLabelText("Price (₹/L)"), "100");
    await user.click(screen.getByLabelText(/Filled the tank completely/));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(addFuel).toHaveBeenCalledWith(data, expect.objectContaining({
      amountRupees: 500,
      pricePerLitre: 100,
      isFullTank: true,
    }));
  });

  it("shows full-tank adjustment details and status in activity history", async () => {
    const occurredAt = "2026-01-02T10:00:00.000Z";
    const data: GroupData = {
      group: {
        id: "group", name: "Flat", inviteCode: "invite", vehicleName: "Activa", tankCapacityMl: 10_000,
        mileageMPerLitre: 45_000, adminUserId: "user", createdAt: "2026-01-01T00:00:00.000Z",
      },
      members: [{ id: "member", groupId: "group", userId: "user", displayName: "Alice", role: "admin", createdAt: "2026-01-01T00:00:00.000Z" }],
      purchases: [{
        id: "full-refill", kind: "fuel_purchase", groupId: "group", payerMemberId: "member", createdByUserId: "user",
        amountPaise: 50_000, unitPricePaisePerLitre: 10_000, volumeMl: 5_000, isFullTank: true,
        occurredAt, createdAt: occurredAt, updatedAt: occurredAt, deletedAt: null, note: "",
      }],
      rides: [], payments: [], presets: [],
      revisions: [
        {
          id: "cloud-revision", groupId: "group", entityType: "fuel_purchase", entityId: "full-refill", changedByUserId: "user",
          previousData: { amount_paise: 50_000, unit_price_paise_per_litre: 10_000, is_full_tank: true }, createdAt: "2026-01-03T00:00:00.000Z",
        },
        {
          id: "local-revision", groupId: "group", entityType: "fuel_purchase", entityId: "full-refill", changedByUserId: "user",
          previousData: { amountPaise: 50_000, unitPricePaisePerLitre: 10_000, isFullTank: true }, createdAt: "2026-01-04T00:00:00.000Z",
        },
      ],
      currentUserId: "user", currentMemberId: "member", pendingEventIds: [], mode: "local",
    };
    vi.mocked(loadCurrentGroup).mockResolvedValue(data);
    const user = userEvent.setup();

    render(<FuelShareApp />);
    await user.click(await screen.findByRole("button", { name: "Activity" }));

    expect(screen.getByText(/full-tank calibration: 0\.00 L estimated.*5\.0 L actual \(\+5\.0 L\)/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "2 corrections recorded" }));
    expect(screen.getAllByText(/₹500 refill at ₹100\/L.*full-tank calibration/)).toHaveLength(2);
  });
});

describe("quick rides", () => {
  it("shows only the first four pinned presets on the dashboard", async () => {
    const presets = ["One", "Two", "Three", "Four", "Five"].map((label, index) => preset(label, index));
    vi.mocked(loadCurrentGroup).mockResolvedValue(dashboardData(presets));
    render(<FuelShareApp />);

    expect(await screen.findByRole("button", { name: /One.*8 km/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Four.*8 km/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Five.*8 km/ })).not.toBeInTheDocument();
  });

  it("shows the empty state and opens the add-preset form", async () => {
    vi.mocked(loadCurrentGroup).mockResolvedValue(dashboardData());
    const user = userEvent.setup();
    render(<FuelShareApp />);

    expect(await screen.findByText("Add common routes to log rides in one tap.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add preset" }));
    const dialog = screen.getByRole("dialog", { name: "Manage quick rides" });
    expect(within(dialog).getByLabelText("Label")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Distance (km)")).toBeInTheDocument();
  });

  it("adds and edits a preset from the management sheet", async () => {
    const college = preset();
    const initial = dashboardData();
    const withCollege = dashboardData([college]);
    vi.mocked(loadCurrentGroup).mockResolvedValueOnce(initial).mockResolvedValue(withCollege);
    const user = userEvent.setup();
    render(<FuelShareApp />);

    await user.click(await screen.findByRole("button", { name: "Add preset" }));
    const dialog = screen.getByRole("dialog", { name: "Manage quick rides" });
    await user.type(within(dialog).getByLabelText("Label"), "College");
    await user.type(within(dialog).getByLabelText("Distance (km)"), "8");
    await user.click(within(dialog).getByRole("button", { name: "Add preset" }));
    expect(createRidePreset).toHaveBeenCalledWith(initial, { label: "College", distanceKm: 8, isPinned: true });

    await user.click(await within(dialog).findByRole("button", { name: "Edit College" }));
    const label = within(dialog).getByLabelText("Label");
    await user.clear(label);
    await user.type(label, "Campus");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(updateRidePreset).toHaveBeenCalledWith(expect.objectContaining({ currentMemberId: "member" }), college, { label: "Campus", distanceKm: 8, isPinned: true });
  });

  it("logs with one tap, shows a toast, and undoes only that ride", async () => {
    const college = preset();
    const data = dashboardData([college]);
    const ride: Ride = {
      id: "quick-ride", kind: "ride", groupId: "group", riderMemberId: "member", createdByUserId: "user",
      distanceM: 8_000, efficiencyMPerLitre: 45_000, consumedMl: 178, presetId: college.id, presetLabel: college.label,
      occurredAt: timestamp, createdAt: timestamp, updatedAt: timestamp, deletedAt: null, note: "",
    };
    vi.mocked(loadCurrentGroup).mockResolvedValue(data);
    vi.mocked(logRideFromPreset).mockResolvedValue({ ride, pendingSync: false });
    const user = userEvent.setup();
    render(<FuelShareApp />);

    await user.click(await screen.findByRole("button", { name: /College.*8 km/ }));
    expect(logRideFromPreset).toHaveBeenCalledWith(data, college);
    expect(screen.getByRole("status")).toHaveTextContent("College ride added");
    await user.click(within(screen.getByRole("status")).getByRole("button", { name: "Undo" }));
    expect(voidRide).toHaveBeenCalledWith(data, ride);
  });

  it("offers save-as-quick-ride during manual ride entry", async () => {
    const data = dashboardData();
    vi.mocked(loadCurrentGroup).mockResolvedValue(data);
    const user = userEvent.setup();
    render(<FuelShareApp />);

    await user.click(await screen.findByRole("button", { name: /Log ride/ }));
    await user.type(screen.getByLabelText("Distance travelled (km)"), "3.5");
    await user.click(screen.getByLabelText(/Save as quick ride/));
    await user.type(screen.getByLabelText("Preset label"), "Market");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(createRidePreset).toHaveBeenCalledWith(data, { label: "Market", distanceKm: 3.5, isPinned: true });
  });
});
