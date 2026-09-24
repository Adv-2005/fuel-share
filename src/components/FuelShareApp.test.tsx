import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FuelShareApp } from "@/components/FuelShareApp";
import { addFuel, addRide, createRidePreset, loadCurrentGroup, logRideFromPreset, updateEvent, updateRidePreset, voidRide } from "@/lib/repository";
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
  saveOpeningBalance: vi.fn(),
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
    group: { id: "group", name: "Flat", inviteCode: "invite", vehicleName: "Activa", tankCapacityMl: 10_000, mileageMPerLitre: 45_000, adminUserId: "user", setupStatus: "complete", createdAt: timestamp },
    members: [{ id: "member", groupId: "group", userId: "user", displayName: "Aditya", role: "admin", createdAt: timestamp }],
    purchases: [{ id: "fuel", kind: "fuel_purchase", groupId: "group", payerMemberId: "member", createdByUserId: "user", amountPaise: 50_000, unitPricePaisePerLitre: 10_000, volumeMl: 5_000, isFullTank: false, occurredAt: timestamp, createdAt: timestamp, updatedAt: timestamp, deletedAt: null, note: "" }],
    openingBalances: [], rides: [], payments: [], presets, revisions: [], currentUserId: "user", currentMemberId: "member", pendingEventIds: [], mode: "local",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadCurrentGroup).mockResolvedValue(null);
});

describe("FuelShareApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadCurrentGroup).mockResolvedValue(null);
  });

  it("shows the two-step opening tank onboarding", async () => {
    const user = userEvent.setup();
    render(<FuelShareApp />);
    expect(await screen.findByRole("heading", { name: "Petrol tracking your group will actually use." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Scooter details" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Creator's display name"), "Alice");
    await user.click(screen.getByRole("button", { name: "Continue to tank state" }));
    expect(screen.getByRole("heading", { name: "Current tank state" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /The tank is empty/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /There is petrol in the tank/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Set this up after members join/ })).toBeInTheDocument();
    expect(screen.getByText(/Local mode/)).toBeInTheDocument();
  });

  it("shows estimated opening value and ownership choices", async () => {
    const user = userEvent.setup();
    render(<FuelShareApp />);
    await user.type(await screen.findByLabelText("Creator's display name"), "Alice");
    await user.click(screen.getByRole("button", { name: "Continue to tank state" }));
    await user.click(screen.getByRole("radio", { name: /There is petrol in the tank/ }));
    await user.click(screen.getByRole("button", { name: "½" }));
    await user.type(screen.getByLabelText("Estimated petrol price per litre (₹)"), "100");
    expect(screen.getByText("₹265")).toBeInTheDocument();
    expect(screen.getByText("Paid by one member")).toBeInTheDocument();
    expect(screen.getByText("Split equally")).toBeInTheDocument();
    expect(screen.getByText("Shared old petrol — no repayment")).toBeInTheDocument();
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
        setupStatus: "complete",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      members: [{ id: "member", groupId: "group", userId: "user", displayName: "Alice", role: "admin", createdAt: "2026-01-01T00:00:00.000Z" }],
      purchases: [],
      openingBalances: [],
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

  it("shows the opening balance and its previous values in activity", async () => {
    const data: GroupData = {
      group: {
        id: "group", name: "Flat", inviteCode: "invite", vehicleName: "Activa", tankCapacityMl: 10_000,
        mileageMPerLitre: 45_000, adminUserId: "user", setupStatus: "complete", createdAt: "2026-01-01T00:00:00.000Z",
      },
      members: [{ id: "member", groupId: "group", userId: "user", displayName: "Alice", role: "admin", createdAt: "2026-01-01T00:00:00.000Z" }],
      openingBalances: [{
        id: "opening", kind: "opening_balance", groupId: "group", createdByUserId: "user", amountPaise: 20_000,
        unitPricePaisePerLitre: 10_000, volumeMl: 2_000, ownershipMode: "single",
        ownerShares: [{ memberId: "member", shareBasisPoints: 10_000 }], occurredAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", deletedAt: null, note: "",
      }],
      purchases: [], rides: [], payments: [], presets: [],
      revisions: [{ id: "revision", groupId: "group", entityType: "opening_balance", entityId: "opening", changedByUserId: "user", previousData: { volumeMl: 1_500, amountPaise: 15_000, ownershipMode: "shared" }, createdAt: "2026-01-02T00:00:00.000Z" }],
      currentUserId: "user", currentMemberId: "member", pendingEventIds: [], mode: "local",
    };
    vi.mocked(loadCurrentGroup).mockResolvedValue(data);
    const user = userEvent.setup();
    render(<FuelShareApp />);
    await user.click(await screen.findByRole("button", { name: "Activity" }));
    expect(screen.getByText("Opening tank balance")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "1 correction recorded" }));
    expect(screen.getByText(/1.5 L opening fuel worth ₹150/)).toBeInTheDocument();
  });

  it("shows full-tank adjustment details and status in activity history", async () => {
    const occurredAt = "2026-01-02T10:00:00.000Z";
    const data: GroupData = {
      group: {
        id: "group", name: "Flat", inviteCode: "invite", vehicleName: "Activa", tankCapacityMl: 10_000,
        mileageMPerLitre: 45_000, adminUserId: "user", setupStatus: "complete", createdAt: "2026-01-01T00:00:00.000Z",
      },
      members: [{ id: "member", groupId: "group", userId: "user", displayName: "Alice", role: "admin", createdAt: "2026-01-01T00:00:00.000Z" }],
      openingBalances: [],
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

  it("blocks ride and refill actions while showing the finish-setup action", async () => {
    const pending: GroupData = {
      group: {
        id: "group", name: "Flat", inviteCode: "invite", vehicleName: "Activa", tankCapacityMl: 10_000,
        mileageMPerLitre: 45_000, adminUserId: "user", setupStatus: "pending", createdAt: "2026-01-01T00:00:00.000Z",
      },
      members: [{ id: "member", groupId: "group", userId: "user", displayName: "Alice", role: "admin", createdAt: "2026-01-01T00:00:00.000Z" }],
      openingBalances: [], purchases: [], rides: [], payments: [], presets: [], revisions: [], currentUserId: "user", currentMemberId: "member", pendingEventIds: [], mode: "local",
    };
    vi.mocked(loadCurrentGroup).mockResolvedValue(pending);
    render(<FuelShareApp />);
    expect(await screen.findByRole("heading", { name: "Finish tank setup" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish tank setup" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Log ride/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add petrol/ })).not.toBeInTheDocument();
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
      participantMemberIds: ["member"],
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

describe("shared rides", () => {
  function sharedData(): GroupData {
    const data = dashboardData();
    data.members = [
      ...data.members,
      { id: "rahul", groupId: "group", userId: "rahul-user", displayName: "Rahul", role: "member", createdAt: timestamp },
      { id: "aman", groupId: "group", userId: "aman-user", displayName: "Aman", role: "member", createdAt: timestamp },
      { id: "riya", groupId: "group", userId: "riya-user", displayName: "Riya", role: "member", createdAt: timestamp },
    ];
    return data;
  }

  function sharedRide(): Ride {
    return {
      id: "shared-ride", kind: "ride", groupId: "group", riderMemberId: "member",
      participantMemberIds: ["member", "rahul", "aman"], createdByUserId: "user", distanceM: 8_000,
      efficiencyMPerLitre: 40_000, consumedMl: 200, presetId: null, presetLabel: null,
      occurredAt: "2026-01-02T00:00:00.000Z", createdAt: timestamp, updatedAt: timestamp, deletedAt: null, note: "",
    };
  }

  it("selects up to two additional riders and submits the locked driver", async () => {
    const data = sharedData();
    vi.mocked(loadCurrentGroup).mockResolvedValue(data);
    const user = userEvent.setup();
    render(<FuelShareApp />);

    await user.click(await screen.findByRole("button", { name: /Log ride/ }));
    expect(screen.getByLabelText(/You \/ Driver/)).toBeChecked();
    expect(screen.getByLabelText(/You \/ Driver/)).toBeDisabled();
    await user.click(screen.getByLabelText("Rahul"));
    await user.click(screen.getByLabelText("Aman"));
    expect(screen.getByLabelText("Riya")).toBeDisabled();
    expect(screen.getByText("Fuel cost will be split equally among 3 riders.")).toBeInTheDocument();
    expect(screen.getByText(/maximum of three people/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Distance travelled (km)"), "8");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(addRide).toHaveBeenCalledWith(data, expect.objectContaining({
      distanceKm: 8,
      participantMemberIds: ["member", "rahul", "aman"],
    }));
  });

  it("opens a preset in the shared ride form with its distance prefilled", async () => {
    const college = preset();
    const data = sharedData();
    data.presets = [college];
    vi.mocked(loadCurrentGroup).mockResolvedValue(data);
    const user = userEvent.setup();
    render(<FuelShareApp />);

    await user.click(await screen.findByRole("button", { name: "Log with people" }));
    expect(screen.getByRole("dialog", { name: "Log a ride" })).toBeInTheDocument();
    expect(screen.getByLabelText("Distance travelled (km)")).toHaveValue(8);
    expect(screen.getByText("Who rode?")).toBeInTheDocument();
  });

  it("records preset usage when logging a shared preset ride", async () => {
    const college = preset();
    const data = sharedData();
    data.presets = [college];
    vi.mocked(loadCurrentGroup).mockResolvedValue(data);
    vi.mocked(logRideFromPreset).mockResolvedValue({ ride: sharedRide(), pendingSync: false });
    const user = userEvent.setup();
    render(<FuelShareApp />);

    await user.click(await screen.findByRole("button", { name: "Log with people" }));
    await user.click(screen.getByLabelText("Rahul"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(logRideFromPreset).toHaveBeenCalledWith(data, college, expect.objectContaining({
      distanceKm: 8,
      participantMemberIds: ["member", "rahul"],
    }));
    expect(addRide).not.toHaveBeenCalled();
  });

  it("renders shared activity and participant distance without multiplying tank travel", async () => {
    const data = sharedData();
    data.rides = [sharedRide()];
    vi.mocked(loadCurrentGroup).mockResolvedValue(data);
    const user = userEvent.setup();
    render(<FuelShareApp />);

    await user.click(await screen.findByRole("button", { name: "Activity" }));
    expect(screen.getByText("Aditya rode with Rahul and Aman")).toBeInTheDocument();
    expect(screen.getByText("8 km")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "People" }));
    expect(screen.getAllByText(/8 km participated/)).toHaveLength(3);
  });

  it("renders legacy solo rides without a participant list", async () => {
    const data = sharedData();
    const legacyRide = { ...sharedRide() } as unknown as Record<string, unknown>;
    delete legacyRide.participantMemberIds;
    legacyRide.id = "legacy-ride";
    legacyRide.riderMemberId = "member";
    data.rides = [legacyRide as unknown as Ride];
    vi.mocked(loadCurrentGroup).mockResolvedValue(data);
    const user = userEvent.setup();
    render(<FuelShareApp />);

    await user.click(await screen.findByRole("button", { name: "Activity" }));
    expect(screen.getByText("Aditya rode")).toBeInTheDocument();
    expect(screen.getByText("8 km")).toBeInTheDocument();
  });

  it("allows correcting a shared ride back to solo", async () => {
    const data = sharedData();
    const ride = sharedRide();
    data.rides = [ride];
    vi.mocked(loadCurrentGroup).mockResolvedValue(data);
    const user = userEvent.setup();
    render(<FuelShareApp />);

    await user.click(await screen.findByRole("button", { name: "Activity" }));
    await user.click(screen.getByRole("button", { name: /Correct Aditya rode/ }));
    await user.click(screen.getByLabelText("Rahul"));
    await user.click(screen.getByLabelText("Aman"));
    await user.click(screen.getByRole("button", { name: "Save correction" }));
    expect(updateEvent).toHaveBeenCalledWith(data, ride, expect.objectContaining({ participantMemberIds: ["member"] }));
  });
});
