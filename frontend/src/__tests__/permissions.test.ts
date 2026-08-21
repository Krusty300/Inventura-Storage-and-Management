import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  can,
  canUser,
  effectivePermissions,
  permissionGroups,
} from "../utils/permissions";

describe("effectivePermissions", () => {
  it("grants admins every permission", () => {
    const perms = effectivePermissions({ role: "admin" });
    for (const p of ALL_PERMISSIONS) expect(perms.has(p)).toBe(true);
  });

  it("uses the custom allowlist for workers instead of role defaults", () => {
    const perms = effectivePermissions({ role: "worker", permissions: ["products.view"] });
    expect(perms.has("products.view")).toBe(true);
    expect(perms.has("orders.create")).toBe(false);
    expect(perms.has("reports.view")).toBe(false);
  });

  it("always grants profile access", () => {
    const perms = effectivePermissions({ role: "worker", permissions: ["products.view"] });
    expect(perms.has("profile.view")).toBe(true);
    expect(effectivePermissions({ role: "worker" }).has("profile.view")).toBe(true);
  });

  it("falls back to role defaults when no custom permissions are set", () => {
    const perms = effectivePermissions({ role: "worker" });
    expect(perms.has("orders.create")).toBe(true);
    expect(perms.has("users.view")).toBe(false);
    expect(perms.has("settings.update")).toBe(false);
  });

  it("treats an empty allowlist as role defaults", () => {
    const perms = effectivePermissions({ role: "worker", permissions: [] });
    expect(perms.has("orders.create")).toBe(true);
  });

  it("returns an empty set for a null or undefined user", () => {
    expect(effectivePermissions(null).size).toBe(0);
    expect(effectivePermissions(undefined).size).toBe(0);
  });

  it("grants managers all permissions except admin-only ones", () => {
    const perms = effectivePermissions({ role: "manager" });
    expect(perms.has("users.view")).toBe(true);
    expect(perms.has("settings.update")).toBe(true);
    expect(perms.has("sales.refund")).toBe(true);
    expect(perms.has("users.delete")).toBe(false);
    expect(perms.has("users.assign_admin_role")).toBe(false);
  });
});

describe("canUser", () => {
  it("respects custom overrides", () => {
    const worker = { role: "worker", permissions: ["products.view", "products.create"] };
    expect(canUser(worker, "products.view")).toBe(true);
    expect(canUser(worker, "products.create")).toBe(true);
    expect(canUser(worker, "reports.view")).toBe(false);
  });

  it("denies when the user is unknown", () => {
    expect(canUser(null, "dashboard.view")).toBe(false);
    expect(canUser(undefined, "dashboard.view")).toBe(false);
  });
});

describe("can (role-based)", () => {
  it("keeps admin and worker role defaults", () => {
    expect(can("admin", "users.delete")).toBe(true);
    expect(can("worker", "users.view")).toBe(false);
    expect(can("worker", "orders.create")).toBe(true);
  });

  it("grants managers most permissions but not admin-only ones", () => {
    expect(can("manager", "users.view")).toBe(true);
    expect(can("manager", "users.create")).toBe(true);
    expect(can("manager", "users.update")).toBe(true);
    expect(can("manager", "settings.update")).toBe(true);
    expect(can("manager", "sales.refund")).toBe(true);
    expect(can("manager", "reports.view")).toBe(true);
    expect(can("manager", "users.delete")).toBe(false);
    expect(can("manager", "users.assign_admin_role")).toBe(false);
  });
});

describe("permissionGroups", () => {
  it("groups permissions by resource and covers every permission once", () => {
    const groups = permissionGroups();
    expect(groups.length).toBeGreaterThan(0);
    const flattened = groups.flatMap((g) => g.permissions);
    expect(flattened.length).toBe(ALL_PERMISSIONS.length);
    expect(new Set(flattened).size).toBe(ALL_PERMISSIONS.length);
  });

  it("sorts permissions within each group", () => {
    const products = permissionGroups().find((g) => g.resource === "products");
    expect(products?.permissions[0]).toBe("products.bulk");
    expect(products?.permissions).toContain("products.view");
  });

  it("humanizes resource labels", () => {
    const serial = permissionGroups().find((g) => g.resource === "serial_numbers");
    expect(serial?.label).toBe("Serial Numbers");
  });
});
