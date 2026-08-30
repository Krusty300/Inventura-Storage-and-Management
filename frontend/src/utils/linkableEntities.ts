import {
  Package, ShoppingCart, Receipt, Users, MapPin, Ship,
  Wrench, ClipboardList, ClipboardCheck, Boxes, Hash, Tag,
  CheckCircle2, FileText, Radio,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface LinkableEntityType {
  entity_type: string;
  label: string;
  searchType: string;
  icon: LucideIcon;
}

export const LINKABLE_ENTITIES: LinkableEntityType[] = [
  { entity_type: "product",        label: "Product",          searchType: "product",        icon: Package },
  { entity_type: "order",          label: "Order",            searchType: "order",          icon: ShoppingCart },
  { entity_type: "sale",           label: "Sale",             searchType: "sale",           icon: Receipt },
  { entity_type: "supplier",       label: "Supplier",         searchType: "supplier",       icon: Users },
  { entity_type: "customer",       label: "Customer",         searchType: "customer",       icon: Users },
  { entity_type: "location",       label: "Location",         searchType: "location",       icon: MapPin },
  { entity_type: "shipment",       label: "Shipment",         searchType: "shipment",       icon: Ship },
  { entity_type: "work_order",     label: "Work Order",       searchType: "work_order",     icon: Wrench },
  { entity_type: "cycle_count",    label: "Cycle Count",      searchType: "cycle_count",    icon: ClipboardList },
  { entity_type: "receipt",        label: "Receipt",          searchType: "receipt",        icon: ClipboardCheck },
  { entity_type: "bom",            label: "Bill of Materials", searchType: "bom",            icon: Boxes },
  { entity_type: "lot",            label: "Lot",              searchType: "lot",            icon: Hash },
  { entity_type: "lpn",            label: "LPN",              searchType: "lpn",            icon: Tag },
  { entity_type: "serial_number",  label: "Serial Number",    searchType: "serial",         icon: Hash },
  { entity_type: "quality_check",  label: "Quality Check",    searchType: "quality_check",  icon: CheckCircle2 },
  { entity_type: "asn",            label: "ASN",              searchType: "asn",            icon: FileText },
];

export function getLinkableEntity(entityType: string): LinkableEntityType | undefined {
  return LINKABLE_ENTITIES.find((e) => e.entity_type === entityType);
}

export function getEntityTypeLabel(entityType: string): string {
  return getLinkableEntity(entityType)?.label ?? entityType.replace(/_/g, " ");
}

export function getEntityTypeIcon(entityType: string): LucideIcon {
  return getLinkableEntity(entityType)?.icon ?? Radio;
}

export function entityMatchesSearchType(entityType: string, searchType: string): boolean {
  const config = getLinkableEntity(entityType);
  return config?.searchType === searchType;
}
