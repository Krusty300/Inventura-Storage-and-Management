"""Role-based access control: maps roles to a set of permissions.

Roles stay as a single column on users (``users.role``) while fine-grained
permissions are granted by role here. This is intentionally code-driven and
kept in sync with the frontend's ``src/utils/permissions.ts``.
"""

ALL_PERMISSIONS = frozenset({
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
    "customers.view",
    "customers.create",
    "customers.update",
    "customers.delete",
    "customers.import",
    "suppliers.view",
    "suppliers.create",
    "suppliers.update",
    "suppliers.delete",
    "suppliers.import",
    "stock.view",
    "stock.record",
    "stock.adjust",
    "stock.update",
    "stock.delete",
    "receipts.view",
    "receipts.create",
    "lots.view",
    "lots.update",
    "serial_numbers.view",
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
    "orders.view",
    "orders.create",
    "orders.update",
    "orders.delete",
    "sales.view",
    "sales.create",
    "sales.refund",
    "reports.view",
    "settings.view",
    "settings.update",
    "users.view",
    "users.create",
    "users.update",
    "users.delete",
    "activity.view",
    "notifications.view",
})

WORKER_PERMISSIONS = frozenset({
    "dashboard.view",
    "products.view",
    "categories.view",
    "customers.view",
    "suppliers.view",
    "stock.view",
    "receipts.view",
    "lots.view",
    "serial_numbers.view",
    "locations.view",
    "asns.view",
    "lpns.view",
    "cycle_counts.view",
    "orders.view",
    "orders.create",
    "orders.update",
    "sales.view",
    "sales.create",
    "reports.view",
    "settings.view",
    "activity.view",
    "notifications.view",
})

ROLE_PERMISSIONS = {
    "admin": ALL_PERMISSIONS,
    "worker": WORKER_PERMISSIONS,
}


def permissions_for_role(role: str) -> frozenset:
    return ROLE_PERMISSIONS.get(role, frozenset())


def has_permission(role: str, permission: str) -> bool:
    return permission in permissions_for_role(role)
