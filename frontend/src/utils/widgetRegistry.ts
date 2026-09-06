export interface WidgetMeta {
  id: string;
  label: string;
  category: "kpi" | "charts" | "lists" | "shortcuts";
  defaultCols: 1 | 2 | 3 | 4;
  defaultRows: 1 | 2;
}

export const WIDGET_REGISTRY: WidgetMeta[] = [
  { id: "kpi-inventory", label: "Inventory KPIs", category: "kpi", defaultCols: 1, defaultRows: 1 },
  { id: "kpi-fulfillment", label: "Fulfillment KPIs", category: "kpi", defaultCols: 1, defaultRows: 1 },
  { id: "kpi-manufacturing", label: "Manufacturing KPIs", category: "kpi", defaultCols: 1, defaultRows: 1 },
  { id: "kpi-business", label: "Business KPIs", category: "kpi", defaultCols: 1, defaultRows: 1 },
  { id: "chart-trends", label: "Stock Movement Trends", category: "charts", defaultCols: 2, defaultRows: 2 },
  { id: "chart-category-value", label: "Inventory by Category", category: "charts", defaultCols: 2, defaultRows: 2 },
  { id: "list-top-products", label: "Top Products", category: "charts", defaultCols: 2, defaultRows: 2 },
  { id: "chart-profit", label: "Profit Analysis", category: "charts", defaultCols: 2, defaultRows: 2 },
  { id: "list-low-stock", label: "Low Stock Alerts", category: "lists", defaultCols: 2, defaultRows: 2 },
  { id: "list-expiring", label: "Expiring Soon", category: "lists", defaultCols: 2, defaultRows: 2 },
  { id: "list-recent-movements", label: "Recent Movements", category: "lists", defaultCols: 2, defaultRows: 2 },
  { id: "list-recent-sales", label: "Recent Sales", category: "lists", defaultCols: 2, defaultRows: 2 },
  { id: "list-receipts", label: "Recent Receipts", category: "lists", defaultCols: 2, defaultRows: 2 },
  { id: "list-lpns", label: "Recent LPNs", category: "lists", defaultCols: 2, defaultRows: 2 },
  { id: "list-order-status", label: "Order Status", category: "lists", defaultCols: 2, defaultRows: 2 },
  { id: "list-pending-asns", label: "Pending ASNs", category: "lists", defaultCols: 2, defaultRows: 2 },
  { id: "list-open-cycle-counts", label: "Open Cycle Counts", category: "lists", defaultCols: 2, defaultRows: 2 },
  { id: "list-shipments", label: "Shipments to Process", category: "lists", defaultCols: 2, defaultRows: 2 },
  { id: "list-work-orders", label: "Open Work Orders", category: "lists", defaultCols: 2, defaultRows: 2 },
  { id: "list-qc", label: "Quality Checks", category: "lists", defaultCols: 2, defaultRows: 2 },
  { id: "list-cost", label: "Manufacturing Cost", category: "lists", defaultCols: 2, defaultRows: 2 },
  { id: "stockout-risk", label: "Stockout Risk", category: "shortcuts", defaultCols: 3, defaultRows: 1 },
];

export function getWidgetMeta(id: string): WidgetMeta {
  return WIDGET_REGISTRY.find((w) => w.id === id) ?? { id, label: id, category: "lists" as const, defaultCols: 2 as const, defaultRows: 2 as const };
}
