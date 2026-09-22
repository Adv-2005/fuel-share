import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FuelShareApp } from "@/components/FuelShareApp";
import { addFuel, loadCurrentGroup } from "@/lib/repository";
import type { GroupData } from "@/lib/types";

vi.mock("@/lib/repository", () => ({
  addFuel: vi.fn(),
  addPayment: vi.fn(),
  addRide: vi.fn(),
  createGroup: vi.fn(),
  joinGroup: vi.fn(),
  loadCurrentGroup: vi.fn().mockResolvedValue(null),
  saveOpeningBalance: vi.fn(),
  subscribeToGroup: vi.fn(() => () => undefined),
  updateEvent: vi.fn(),
  updateGroupSettings: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({ isCloudConfigured: vi.fn(() => false) }));

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
      purchases: [], rides: [], payments: [],
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

  it("blocks ride and refill actions while showing the finish-setup action", async () => {
    const pending: GroupData = {
      group: {
        id: "group", name: "Flat", inviteCode: "invite", vehicleName: "Activa", tankCapacityMl: 10_000,
        mileageMPerLitre: 45_000, adminUserId: "user", setupStatus: "pending", createdAt: "2026-01-01T00:00:00.000Z",
      },
      members: [{ id: "member", groupId: "group", userId: "user", displayName: "Alice", role: "admin", createdAt: "2026-01-01T00:00:00.000Z" }],
      openingBalances: [], purchases: [], rides: [], payments: [], revisions: [], currentUserId: "user", currentMemberId: "member", pendingEventIds: [], mode: "local",
    };
    vi.mocked(loadCurrentGroup).mockResolvedValue(pending);
    render(<FuelShareApp />);
    expect(await screen.findByRole("heading", { name: "Finish tank setup" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish tank setup" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Log ride/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add petrol/ })).not.toBeInTheDocument();
  });
});
