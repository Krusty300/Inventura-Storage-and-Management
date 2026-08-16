const STATUS_CLASSES: Record<string, string> = {
  in_stock: "badge-success",
  received: "badge-success",
  shipped: "badge-success",
  ship: "badge-success",
  completed: "badge-success",
  complete: "badge-success",
  create: "badge-success",
  active: "badge-success",
  ok: "badge-success",
  pass: "badge-success",
  pending: "badge-warning",
  planned: "badge-info",
  packed: "badge-info",
  pack: "badge-info",
  reserved: "badge-info",
  in_progress: "badge-info",
  update: "badge-info",
  release: "badge-info",
  move: "badge-info",
  unload: "badge-info",
  sold: "badge-neutral",
  inactive: "badge-neutral",
  consumed: "badge-neutral",
  draft: "badge-neutral",
  cancel: "badge-neutral",
  logout_all: "badge-neutral",
  quarantined: "badge-warning",
  picking: "badge-warning",
  pick: "badge-warning",
  start: "badge-warning",
  load: "badge-warning",
  released: "badge-warning",
  mismatch: "badge-warning",
  reset_password: "badge-danger",
  expired: "badge-danger",
  scrapped: "badge-danger",
  cancelled: "badge-danger",
  delete: "badge-danger",
  failed: "badge-danger",
  refunded: "badge-danger",
  void: "badge-danger",
  reorder: "badge-danger",
};

export function statusBadge(status: string): string {
  return STATUS_CLASSES[status] ?? "badge-info";
}

const INBOUND = ["in", "receive", "transfer_in", "sale_return", "count", "create"];
const OUTBOUND = ["out", "sale", "transfer_out", "issue", "backflush", "return", "ship", "scrap"];

export function movementBadgeClass(type: string): string {
  if (INBOUND.includes(type)) return "badge-success";
  if (OUTBOUND.includes(type)) return "badge-danger";
  return "badge-info";
}
