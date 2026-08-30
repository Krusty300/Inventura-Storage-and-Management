export const MOVEMENT_TYPES = [
  "receive",
  "in",
  "out",
  "sale",
  "sale_return",
  "return",
  "transfer_in",
  "transfer_out",
  "issue",
  "backflush",
  "ship",
  "scrap",
  "adjustment",
  "count",
  "deactivate",
  "activate",
  "release",
  "consume",
] as const;

export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_LABELS: Record<string, string> = {
  receive: "Received",
  in: "Stock in",
  out: "Stock out",
  sale: "Sold",
  sale_return: "Sale return",
  return: "Returned",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  issue: "Issued to WIP",
  backflush: "Backflushed",
  ship: "Shipped",
  scrap: "Scrapped",
  adjustment: "Adjusted",
  count: "Cycle count",
  deactivate: "Deactivated",
  activate: "Activated",
  release: "Released",
  consume: "Consumed",
};

export const MOVEMENT_BADGE_CLASSES: Record<string, string> = {
  in: "badge-success",
  receive: "badge-success",
  transfer_in: "badge-success",
  sale_return: "badge-success",
  activate: "badge-success",
  release: "badge-success",
  count: "badge-info",
  adjustment: "badge-info",
  out: "badge-danger",
  sale: "badge-danger",
  transfer_out: "badge-danger",
  issue: "badge-danger",
  backflush: "badge-danger",
  ship: "badge-danger",
  scrap: "badge-danger",
  consume: "badge-danger",
  deactivate: "badge-danger",
  return: "badge-danger",
};

export function movementLabel(type: string): string {
  return MOVEMENT_LABELS[type] ?? type;
}

export function movementBadgeClass(type: string): string {
  return MOVEMENT_BADGE_CLASSES[type] ?? "badge-info";
}
