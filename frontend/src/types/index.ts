export interface Product {
  id: number;
  sku: string;
  name: string;
  description: string;
  category_id: number | null;
  supplier_id: number | null;
  parent_id: number | null;
  attributes: Record<string, string> | null;
  unit_price: number;
  cost_price: number;
  quantity: number;
  reorder_level: number;
  location_id: number | null;
  location: string;
  barcode: string;
  batch_number: string;
  expiry_date: string | null;
  image_url: string;
  is_active: boolean;
  is_serialized: boolean;
  created_at: string;
  updated_at: string;
  category_name: string;
  supplier_name: string;
  is_variant: boolean;
  variant_label: string;
  display_name: string;
  total_quantity: number;
  variants: Product[];
}

export interface Category {
  id: number;
  name: string;
  description: string;
  parent_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface CategoryTree extends Category {
  subcategories: CategoryTree[];
}

export interface Supplier {
  id: number;
  name: string;
  contact_person: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  total_orders?: number;
  total_spent?: number;
  avg_order_value?: number;
  last_order_at?: string | null;
  product_count?: number;
}

export interface SupplierStats {
  total_orders: number;
  total_spent: number;
  avg_order_value: number;
  last_order_at: string | null;
  product_count: number;
}

export interface TopSupplier {
  supplier_id: number;
  name: string;
  contact_person: string;
  email: string;
  total_orders: number;
  total_spent: number;
  last_order_at: string | null;
}

export interface TopSuppliersReport {
  items: TopSupplier[];
  total: number;
  days: number | null;
}

export interface StockMovement {
  id: number;
  product_id: number;
  user_id: number;
  quantity_change: number;
  movement_type: string;
  reference: string;
  notes: string;
  created_at: string;
  product_name: string;
  username: string;
  lot_id: number | null;
  serial_id: number | null;
  reference_type: string | null;
  transfer_id: number | null;
  from_location_id: number | null;
  to_location_id: number | null;
  from_location_name: string | null;
  to_location_name: string | null;
}

export interface Order {
  id: number;
  order_number: string;
  supplier_id: number | null;
  user_id: number;
  status: string;
  total_amount: number;
  notes: string;
  created_at: string;
  updated_at: string;
  supplier_name: string;
  username: string;
  items: OrderItem[];
}

export interface OrderItem {
  id: number;
  product_id: number;
  quantity: number;
  unit_price: number;
  product_name: string;
}

export interface DashboardStats {
  total_products: number;
  total_categories: number;
  total_suppliers: number;
  total_orders: number;
  low_stock_count: number;
  expiring_soon_count: number;
  total_inventory_value: number;
  total_stock_movements_today: number;
  recent_movements: {
    id: number;
    product_name: string;
    quantity_change: number;
    movement_type: string;
    created_at: string;
  }[];
  low_stock_products: {
    id: number;
    name: string;
    sku: string;
    quantity: number;
    reorder_level: number;
  }[];
  expiring_products: {
    id: number;
    name: string;
    sku: string;
    expiry_date: string;
    batch_number: string;
  }[];
}

export interface InventoryValuation {
  total_inventory_value: number;
  total_retail_value: number;
  potential_profit: number;
  by_category: { category: string; product_count: number; total_stock: number; total_value: number }[];
  by_supplier: { supplier: string; product_count: number; total_stock: number; total_value: number }[];
}

export interface StockMovementTrends {
  total_in: number;
  total_out: number;
  net_movement: number;
  daily_trends: { date: string; in: number; out: number }[];
}

export interface CategoryBreakdownItem {
  id: number;
  name: string;
  product_count: number;
  total_stock: number;
  total_cost_value: number;
  total_retail_value: number;
}

export interface ProfitAnalysis {
  total_cost_value: number;
  total_potential_revenue: number;
  total_potential_profit: number;
  product_count: number;
  products: {
    id: number;
    name: string;
    sku: string;
    category: string;
    supplier: string;
    quantity: number;
    unit_cost: number;
    unit_price: number;
    unit_margin: number;
    margin_percentage: number;
    total_cost: number;
    total_revenue: number;
    total_profit: number;
  }[];
}

export interface OrderSummary {
  total_orders: number;
  total_order_value: number;
  by_status: { status: string; count: number; total_value: number }[];
  top_suppliers: { supplier: string; order_count: number; total_value: number }[];
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
}

export interface SerialNumber {
  id: number;
  product_id: number;
  serial_number: string;
  lot_id: number | null;
  location_id: number | null;
  status: string;
  sold_at: string | null;
  location_name: string;
  lot_number: string;
  product_name: string;
  created_at: string;
}

export interface Lot {
  id: number;
  product_id: number;
  lot_number: string;
  supplier_id: number | null;
  expiry_date: string | null;
  received_date: string;
  status: string;
  on_hand: number;
  serial_count: number;
  supplier_name: string;
  product_name: string;
  created_at: string;
}

export interface ReceiptItem {
  id: number;
  receipt_id: number;
  product_id: number;
  quantity: number;
  unit_cost: number;
  lot_id: number | null;
  location_id: number | null;
  product_name: string;
  lot_number: string;
  location_name: string;
}

export interface Receipt {
  id: number;
  receipt_number: string;
  supplier_id: number | null;
  user_id: number;
  reference: string;
  notes: string;
  total_quantity: number;
  total_cost: number;
  created_at: string;
  supplier_name: string;
  username: string;
  items: ReceiptItem[];
}

export interface Customer {
  id: number;
  name: string;
  phone: string;
  email: string;
  address: string;
  customer_type: string;
  notes: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  total_sales?: number;
  total_spent?: number;
  avg_order_value?: number;
  last_purchase_at?: string | null;
}

export interface CustomerStats {
  total_sales: number;
  total_spent: number;
  avg_order_value: number;
  last_purchase_at: string | null;
}

export interface TopCustomer {
  customer_id: number;
  name: string;
  phone: string;
  email: string;
  total_sales: number;
  total_spent: number;
  last_purchase_at: string | null;
}

export interface TopCustomersReport {
  items: TopCustomer[];
  total: number;
  days: number | null;
}

export interface Settings {
  id: number;
  store_name: string;
  address: string;
  phone: string;
  email: string;
  currency_symbol: string;
  tax_rate: number;
  default_reorder_level: number;
}

export interface SaleItem {
  id: number;
  product_id: number;
  quantity: number;
  unit_price: number;
  product_name: string;
  line_total: number;
}

export interface Sale {
  id: number;
  invoice_number: string;
  customer_id: number | null;
  user_id: number;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  status: string;
  payment_method: string;
  notes: string;
  created_at: string;
  updated_at: string;
  customer_name: string;
  username: string;
  items: SaleItem[];
}

export interface SalesStats {
  total_sales: number;
  total_revenue: number;
  recent_sales: {
    id: number;
    invoice_number: string;
    customer_name: string;
    total_amount: number;
    created_at: string;
  }[];
}

export interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  link: string;
  is_read: boolean;
  created_at: string;
}

export interface SalesSummary {
  total_sales: number;
  total_refunds: number;
  total_revenue: number;
  total_tax: number;
  by_payment_method: { method: string; count: number }[];
  top_products: { name: string; quantity_sold: number; revenue: number }[];
}

export interface Location {
  id: number;
  code: string | null;
  name: string;
  path: string;
  parent_id: number | null;
  location_type: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  stock_line_count: number;
  lpn_count: number;
  total_quantity: number;
  stock_value: number;
}

export interface LocationTree extends Location {
  children: LocationTree[];
}

export interface ASNItem {
  id: number;
  asn_id: number;
  product_id: number;
  expected_qty: number;
  received_qty: number;
  unit_cost: number;
  status: string;
  product_name: string;
  location_id: number | null;
  location_name: string;
}

export interface ASN {
  id: number;
  asn_number: string;
  supplier_id: number | null;
  user_id: number;
  status: string;
  expected_arrival: string | null;
  received_at: string | null;
  total_expected: number;
  total_received: number;
  notes: string;
  created_at: string;
  updated_at: string;
  supplier_name: string;
  username: string;
  items: ASNItem[];
}

export interface LPN {
  id: number;
  lpn_number: string;
  lpn_type: string;
  location_id: number | null;
  status: string;
  created_at: string;
  updated_at: string;
  location_name: string;
  content_count: number;
  total_quantity: number;
  contents: LPNContentItem[];
}

export interface LPNContentItem {
  product_id: number;
  product_name: string;
  lot_id: number | null;
  lot_number: string;
  quantity: number;
}

export interface CycleCountItem {
  id: number;
  cycle_count_id: number;
  product_id: number;
  expected_qty: number;
  counted_qty: number | null;
  variance: number;
  status: string;
  product_name: string;
}

export interface CycleCount {
  id: number;
  cc_number: string;
  location_id: number | null;
  created_by: number;
  status: string;
  notes: string;
  created_at: string;
  completed_at: string | null;
  location_name: string;
  username: string;
  has_variance: boolean;
  total_expected: number;
  total_variance: number;
  items: CycleCountItem[];
}

export interface ExceptionsReport {
  summary: {
    low_stock: number;
    zero_stock: number;
    quarantined_lots: number;
    open_cycle_counts: number;
    pending_asns: number;
  };
  low_stock: { id: number; name: string; sku: string; quantity: number; reorder_level: number; category: string; supplier: string }[];
  zero_stock: { id: number; name: string; sku: string }[];
  quarantined_lots: { id: number; lot_number: string; product_name: string; product_id: number; on_hand: number; expiry_date: string | null; received_date: string }[];
  open_cycle_counts: { id: number; cc_number: string; status: string; location: string; has_variance: boolean; total_expected: number; total_variance: number; created_at: string }[];
  pending_asns: { id: number; asn_number: string; supplier: string; expected_arrival: string | null; items_pending: number; created_at: string }[];
}

export interface InventoryAgingItem {
  lot_id: number;
  product_id: number;
  product_name: string;
  lot_number: string;
  status: string;
  expiry_date: string | null;
  received_date: string;
  last_movement_at: string | null;
  age_days: number;
  on_hand: number;
  avg_daily_demand: number;
  days_of_stock: number | null;
}

export interface InventoryAging {
  items: InventoryAgingItem[];
  total: number;
}

export interface StockoutRiskItem {
  product_id: number;
  product_name: string;
  sku: string;
  category: string;
  supplier: string;
  on_hand: number;
  reorder_level: number;
  avg_daily_demand: number;
  lead_time_days: number;
  days_of_supply: number | null;
  suggested_reorder: number;
  risk_score: number;
  risk_level: string;
}

export interface StockoutRisk {
  items: StockoutRiskItem[];
  summary: { high: number; medium: number; low: number };
}
