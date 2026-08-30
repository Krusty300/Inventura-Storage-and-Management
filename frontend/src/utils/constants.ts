/** Shared pagination sizes, mirrored from backend/app/constants.py. */

export const PAGE_SIZE = 200;
export const PAGE_SIZE_LOOKUP = 5000;
export const PAGE_SIZE_PICKER = 500;
export const PAGE_SIZE_PRODUCTS = 1000;

/** Location types — must match backend LOCATION_TYPES exactly. */
export const LOCATION_TYPES = ["bin", "zone", "aisle", "shelf", "storage", "receiving", "shipping", "wip", "quarantine"] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  bin: "Bin",
  zone: "Zone",
  aisle: "Aisle",
  shelf: "Shelf",
  storage: "Storage",
  receiving: "Receiving",
  shipping: "Shipping",
  wip: "Work In Progress",
  quarantine: "Quarantine",
};
