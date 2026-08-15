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
    "activity.view",
    "notifications.view",
    "bom.view",
    "bom.create",
    "bom.update",
    "bom.delete",
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
})

WORKER_PERMISSIONS = frozenset({
    "dashboard.view",
    "products.view",
    "categories.view",
    "customers.view",
    "suppliers.view",
    "stock.view",
    "stock.record",
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
    "orders.view",
    "orders.create",
    "orders.update",
    "sales.view",
    "sales.create",
    "reports.view",
    "settings.view",
    "activity.view",
    "notifications.view",
    "bom.view",
    "work_orders.view",
    "work_orders.release",
    "work_orders.complete",
    "quality_checks.view",
    "quality_checks.create",
    "planning.view",
    "forecasting.view",
    "shipments.view",
    "shipments.create",
    "shipments.pick",
    "shipments.ship",
})

ROLE_PERMISSIONS = {
    "admin": ALL_PERMISSIONS,
    "worker": WORKER_PERMISSIONS,
}


def permissions_for_role(role: str) -> frozenset:
    return ROLE_PERMISSIONS.get(role, frozenset())


def permissions_for_user(user) -> frozenset:
    """Effective permission set for a user.

    Admins always hold every permission. Workers fall back to the role
    defaults unless the account has a custom ``permissions`` allowlist, in
    which case that list (validated against known permissions) is used.
    """
    if getattr(user, "role", None) == "admin":
        return ALL_PERMISSIONS
    custom = getattr(user, "permissions", None)
    if custom:
        return frozenset(p for p in custom if p in ALL_PERMISSIONS)
    return permissions_for_role(getattr(user, "role", "worker"))


def has_permission(role: str, permission: str) -> bool:
    return permission in permissions_for_role(role)
