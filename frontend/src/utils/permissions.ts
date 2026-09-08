export const ALL_PERMISSIONS = [
  "dashboard.view",
  "products.view",
  "products.create",
  "products.update",
  "products.delete",
  "products.bulk",
  "products.import",
  "products.upload",
  "categories.view",
  "categories.create",
  "categories.update",
  "categories.delete",
  "categories.bulk",
  "customers.view",
  "customers.create",
  "customers.update",
  "customers.delete",
  "customers.import",
  "customers.bulk",
  "suppliers.view",
  "suppliers.create",
  "suppliers.update",
  "suppliers.delete",
  "suppliers.import",
  "suppliers.bulk",
  "stock.view",
  "stock.record",
  "stock.adjust",
  "stock.update",
  "stock.delete",
  "orders.view",
  "orders.create",
  "orders.update",
  "orders.delete",
  "orders.bulk",
  "sales.view",
  "sales.create",
  "sales.refund",
  "sales.bulk",
  "reports.view",
  "settings.view",
  "settings.update",
  "users.view",
  "users.create",
  "users.update",
  "users.delete",
  "users.assign_admin_role",
  "activity.view",
  "notifications.view",
  "receipts.view",
  "receipts.create",
  "lots.view",
  "lots.update",
  "serial_numbers.view",
  "serial_numbers.update",
  "locations.view",
  "locations.create",
  "locations.update",
  "locations.delete",
  "asns.view",
  "asns.create",
  "asns.update",
  "asns.receive",
  "lpns.view",
  "lpns.create",
  "lpns.update",
  "lpns.delete",
  "cycle_counts.view",
  "cycle_counts.create",
  "cycle_counts.update",
  "cycle_counts.count",
  "bom.view",
  "bom.create",
  "bom.update",
  "bom.delete",
  "kit.view",
  "kit.create",
  "kit.update",
  "kit.delete",
  "work_orders.view",
  "work_orders.create",
  "work_orders.update",
  "work_orders.release",
  "work_orders.complete",
  "quality_checks.view",
  "quality_checks.create",
  "quality_checks.update",
  "quality_checks.delete",
  "planning.view",
  "forecasting.view",
  "shipments.view",
  "shipments.create",
  "shipments.update",
  "shipments.pick",
  "shipments.ship",
  "shipments.cancel",
  "shipments.delete",
  "notes.view",
  "notes.create",
  "notes.update",
  "notes.delete",
  "price_lists.view",
  "price_lists.create",
  "price_lists.update",
  "price_lists.delete",
  "promotions.view",
  "promotions.create",
  "promotions.update",
  "promotions.delete",
  "customer_groups.view",
  "customer_groups.create",
  "customer_groups.update",
  "customer_groups.delete",
  "trash.view",
  "trash.restore",
  "trash.delete",
  "profile.view",
];

const WORKER_PERMISSIONS = [
  "dashboard.view",
  "products.view",
  "categories.view",
  "customers.view",
  "suppliers.view",
  "stock.view",
  "stock.record",
  "orders.view",
  "orders.create",
  "orders.update",
  "sales.view",
  "sales.create",
  "reports.view",
  "settings.view",
  "activity.view",
  "notifications.view",
  "receipts.view",
  "receipts.create",
  "lots.view",
  "serial_numbers.view",
  "locations.view",
  "asns.view",
  "asns.receive",
  "lpns.view",
  "cycle_counts.view",
  "cycle_counts.create",
  "cycle_counts.count",
  "bom.view",
  "work_orders.view",
  "work_orders.release",
  "work_orders.complete",
  "kit.view",
  "quality_checks.view",
  "quality_checks.create",
  "planning.view",
  "forecasting.view",
  "shipments.view",
  "shipments.create",
  "shipments.pick",
  "shipments.ship",
  "notes.view",
  "notes.create",
  "notes.update",
  "price_lists.view",
  "promotions.view",
  "customer_groups.view",
  "profile.view",
];

const MANAGER_PERMISSIONS = ALL_PERMISSIONS.filter(
  (p) => p !== "users.delete" && p !== "users.assign_admin_role"
);

const ROLE_PERMISSIONS: Record<string, ReadonlySet<string>> = {
  admin: new Set(ALL_PERMISSIONS),
  manager: new Set(MANAGER_PERMISSIONS),
  worker: new Set(WORKER_PERMISSIONS),
};

export function can(role: string | undefined, permission: string): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

type PermissionUser = { role?: string; permissions?: string[] | null } | null | undefined;

export function effectivePermissions(user: PermissionUser): Set<string> {
  if (!user) return new Set();
  if (user.role === "admin") return new Set(ALL_PERMISSIONS);
  if (user.role === "manager") return new Set(MANAGER_PERMISSIONS);
  const custom = user.permissions;
  if (custom && custom.length > 0) {
    return new Set([...custom, "profile.view"]);
  }
  return new Set([...(ROLE_PERMISSIONS[user.role ?? "worker"] ?? []), "profile.view"]);
}

export function canUser(user: PermissionUser, permission: string): boolean {
  return effectivePermissions(user).has(permission);
}

export interface PermissionGroup {
  resource: string;
  label: string;
  permissions: string[];
}

function humanize(resource: string): string {
  return resource
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function permissionGroups(): PermissionGroup[] {
  const groups = new Map<string, string[]>();
  for (const perm of ALL_PERMISSIONS) {
    const resource = perm.split(".")[0];
    const list = groups.get(resource) ?? [];
    list.push(perm);
    groups.set(resource, list);
  }
  return [...groups.entries()].map(([resource, permissions]) => ({
    resource,
    label: humanize(resource),
    permissions: [...permissions].sort(),
  }));
}
