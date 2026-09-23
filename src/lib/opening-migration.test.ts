import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/003_opening_tank_balance.sql"), "utf8");

describe("opening tank balance migration", () => {
  it("limits groups to one active opening event and validates the timeline", () => {
    expect(migration).toContain("opening_balances_one_active_per_group");
    expect(migration).toContain("where deleted_at is null");
    expect(migration).toContain("The opening balance must occur before rides and refills.");
    expect(migration).toContain("This change would put the estimated tank above its configured capacity.");
    expect(migration).toContain("This change would make the estimated tank go below zero.");
  });

  it("applies member reads while routing writes through an admin-only RPC", () => {
    expect(migration).toContain("opening_select_group");
    expect(migration).toContain("opening_owners_select_group");
    expect(migration).toContain("if not public.is_group_admin(p_group_id)");
    expect(migration).toContain("revoke all on function public.save_opening_balance");
  });

  it("records prior values and ownership during a correction", () => {
    expect(migration).toContain("insert into public.event_revisions");
    expect(migration).toContain("'opening_balance'");
    expect(migration).toContain("'ownerShares'");
    expect(migration).toContain("shareBasisPoints");
  });

  it("keeps existing groups complete while blocking new deferred groups", () => {
    expect(migration).toContain("setup_status text not null default 'complete'");
    expect(migration).toContain("Finish the opening tank setup before logging rides or refills.");
    expect(migration).toContain("An opening balance is required before setup can be completed.");
  });
});
