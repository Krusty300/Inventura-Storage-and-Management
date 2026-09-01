import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Package,
  Tags,
  Truck,
  ArrowLeftRight,
  ShoppingCart,
  Receipt,
  Users as UsersIcon,
  History,
  BarChart3,
  Contact,
  Settings as SettingsIcon,
  MapPin,
  ClipboardList,
  Boxes,
  Layers,
  Fingerprint,
  PackageCheck,
  AlertTriangle,
  Factory,
  Workflow,
  FlaskConical,
  Sparkles,
  PackageOpen,
  TrendingUp,
  CircleUser,
  StickyNote,
  BadgePercent,
  Tag,
  UsersRound,
  Store,
  Bell,
} from "lucide-react";

export interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  perm: string;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
  /** Restrict the whole group to these roles (default: visible to any role). */
  roles?: string[];
}

export const navGroups: NavGroup[] = [
  {
    id: "overview",
    label: "Overview",
    items: [
      { to: "/", icon: LayoutDashboard, label: "Dashboard", perm: "dashboard.view" },
    ],
  },
  {
    id: "inventory",
    label: "Inventory",
    items: [
      { to: "/products", icon: Package, label: "Products", perm: "products.view" },
      { to: "/categories", icon: Tags, label: "Categories", perm: "categories.view" },
      { to: "/suppliers", icon: Truck, label: "Suppliers", perm: "suppliers.view" },
      { to: "/locations", icon: MapPin, label: "Locations", perm: "locations.view" },
    ],
  },
  {
    id: "sales",
    label: "Sales",
    items: [
      { to: "/customers", icon: Contact, label: "Customers", perm: "customers.view" },
      { to: "/orders", icon: ShoppingCart, label: "Orders", perm: "orders.view" },
      { to: "/sales", icon: Receipt, label: "Sales", perm: "sales.view" },
      { to: "/price-lists", icon: Tag, label: "Price Lists", perm: "price_lists.view" },
      { to: "/promotions", icon: BadgePercent, label: "Promotions", perm: "promotions.view" },
      { to: "/customer-groups", icon: UsersRound, label: "Customer Groups", perm: "customer_groups.view" },
      { to: "/sales-channels", icon: Store, label: "Sales Channels", perm: "sales.view" },
    ],
  },
  {
    id: "warehouse",
    label: "Warehouse",
    items: [
      { to: "/receiving", icon: PackageCheck, label: "Receiving", perm: "receipts.view" },
      { to: "/asns", icon: Truck, label: "ASNs", perm: "asns.view" },
      { to: "/lpns", icon: Boxes, label: "LPNs", perm: "lpns.view" },
      { to: "/lots", icon: Layers, label: "Lots", perm: "lots.view" },
      { to: "/serial-numbers", icon: Fingerprint, label: "Serial Numbers", perm: "serial_numbers.view" },
      { to: "/cycle-counts", icon: ClipboardList, label: "Cycle Counts", perm: "cycle_counts.view" },
    ],
  },
  {
    id: "manufacturing",
    label: "Manufacturing",
    items: [
      { to: "/boms", icon: Factory, label: "BOMs", perm: "bom.view" },
      { to: "/work-orders", icon: Workflow, label: "Work Orders", perm: "work_orders.view" },
    ],
  },
  {
    id: "planning",
    label: "Planning",
    items: [
      { to: "/planning", icon: Sparkles, label: "Planning", perm: "planning.view" },
      { to: "/forecasting", icon: TrendingUp, label: "Forecasting", perm: "forecasting.view" },
      { to: "/shipments", icon: PackageOpen, label: "Shipments", perm: "shipments.view" },
      { to: "/quality-checks", icon: FlaskConical, label: "Quality", perm: "quality_checks.view" },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    items: [
      { to: "/stock-movements", icon: ArrowLeftRight, label: "Movements", perm: "stock.view" },
      { to: "/exceptions", icon: AlertTriangle, label: "Exceptions", perm: "reports.view" },
      { to: "/notes", icon: StickyNote, label: "Notes", perm: "notes.view" },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    roles: ["admin"],
    items: [
      { to: "/users", icon: UsersIcon, label: "Users", perm: "users.view" },
      { to: "/reports", icon: BarChart3, label: "Reports", perm: "reports.view" },
      { to: "/activity-log", icon: History, label: "Activity", perm: "activity.view" },
      { to: "/notifications", icon: Bell, label: "Notifications", perm: "notifications.view" },
      { to: "/settings", icon: SettingsIcon, label: "Settings", perm: "settings.view" },
      { to: "/profile", icon: CircleUser, label: "Profile", perm: "profile.view" },
    ],
  },
];

export const navItems: NavItem[] = navGroups.flatMap((g) => g.items);
