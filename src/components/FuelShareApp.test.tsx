import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FuelShareApp } from "@/components/FuelShareApp";

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
});
