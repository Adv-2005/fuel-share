import { describe, expect, it } from "vitest";
import { selectAccessibleGroupId } from "@/lib/repository";

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
