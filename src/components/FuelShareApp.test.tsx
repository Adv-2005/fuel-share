import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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
  subscribeToGroup: vi.fn(() => () => undefined),
  updateEvent: vi.fn(),
  updateGroupSettings: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({ isCloudConfigured: vi.fn(() => false) }));

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
});
