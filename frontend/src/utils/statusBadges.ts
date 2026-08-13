const STATUS_CLASSES: Record<string, string> = {
  in_stock: "badge-success",
  received: "badge-success",
  shipped: "badge-success",
  completed: "badge-success",
  active: "badge-success",
  ok: "badge-success",
  pending: "badge-info",
  packed: "badge-info",
  reserved: "badge-info",
  in_progress: "badge-info",
  planned: "badge-info",
  sold: "badge-neutral",
  inactive: "badge-neutral",
  draft: "badge-neutral",
  quarantined: "badge-warning",
  picking: "badge-warning",
  released: "badge-warning",
  mismatch: "badge-warning",
  expired: "badge-danger",
  scrapped: "badge-danger",
  cancelled: "badge-danger",
  failed: "badge-danger",
  refunded: "badge-danger",
  void: "badge-danger",
  reorder: "badge-danger",
};

export function statusBadge(status: string): string {
  return STATUS_CLASSES[status] ?? "badge-info";
}
