import type { LucideIcon } from "lucide-react";
import {
  Bell,
  ClipboardList,
  LayoutDashboard,
  PackageCheck,
  PackageOpen,
  Receipt,
  Settings as SettingsIcon,
  ShoppingBag,
  ShoppingCart,
} from "lucide-react";

export interface PortalNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

export const SUPPLIER_PORTAL_NAV: PortalNavItem[] = [
  { id: "/portal", label: "Overview", icon: LayoutDashboard },
  { id: "/portal/orders", label: "Purchase Orders", icon: ClipboardList },
  { id: "/portal/asns", label: "Shipments", icon: PackageCheck },
  { id: "/portal/receipts", label: "Deliveries", icon: PackageOpen },
  { id: "/portal/notifications", label: "Notifications", icon: Bell },
  { id: "/portal/settings", label: "Settings", icon: SettingsIcon },
];

export const CUSTOMER_PORTAL_NAV: PortalNavItem[] = [
  { id: "/portal", label: "Overview", icon: LayoutDashboard },
  { id: "/portal/catalog", label: "Catalog", icon: ShoppingBag },
  { id: "/portal/cart", label: "Cart", icon: ShoppingCart },
  { id: "/portal/invoices", label: "Invoices", icon: Receipt },
  { id: "/portal/notifications", label: "Notifications", icon: Bell },
  { id: "/portal/settings", label: "Settings", icon: SettingsIcon },
];