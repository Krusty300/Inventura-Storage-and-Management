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
  variant_of_name: string;
  variant_label: string;
  display_name: string;
  total_quantity: number;
  quarantined_qty: number;
  expired_lot_qty: number;
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
  lead_time_days: number | null;
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
  is_serialized: boolean;
}

export interface DashboardShipmentRow {
  id: number;
  shipment_number: string;
  customer_name: string;
  status: string;
  total_quantity: number;
  total_picked: number;
  total_amount: number;
  created_at: string;
}

export interface DashboardWorkOrderRow {
  id: number;
  wo_number: string;
  product_name: string;
  status: string;
  quantity: number;
  created_at: string;
}

export interface DashboardQualityCheckRow {
  id: number;
  qc_number: string;
  product_name: string;
  result: string;
  created_at: string;
}

export interface DashboardStats {
  total_products: number;
  total_categories: number;
  total_suppliers: number;
  total_orders: number;
  total_lots: number;
  low_stock_count: number;
  expiring_soon_count: number;
  total_inventory_value: number;
  total_stock_movements_today: number;
  open_shipments: number;
  open_work_orders: number;
  pending_quality_checks: number;
  quarantined_units: number;
  serial_numbers_in_stock: number;
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
    sellable?: number;
    reorder_level: number;
  }[];
  expiring_products: {
    id: number;
    name: string;
    sku: string;
    expiry_date: string;
    batch_number: string;
  }[];
  shipments_to_process: DashboardShipmentRow[];
  work_orders_to_process: DashboardWorkOrderRow[];
  quality_checks_to_process: DashboardQualityCheckRow[];
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

export interface GlobalSearchResult {
  type: string;
  id: number;
  label: string;
  subtitle: string;
  route: string;
}

export interface GlobalSearchResponse {
  query: string;
  total: number;
  results: GlobalSearchResult[];
}

export interface SerialNumber {
  id: number;
  product_id: number;
  serial_number: string;
  lot_id: number | null;
  location_id: number | null;
  lpn_id: number | null;
  status: string;
  sold_at: string | null;
  location_name: string;
  lot_number: string;
  lot_status: string;
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
  locations: string[];
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

export interface FrequentProduct {
  product_id: number;
  product_name: string;
  sku: string;
  order_count: number;
  total_quantity: number;
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
  expiry_warning_days: number;
  low_stock_alerts: boolean;
  expiry_alerts: boolean;
  shipment_prefix: string;
  work_order_prefix: string;
  sale_prefix: string;
  invoice_prefix: string;
  po_prefix: string;
  require_qc_before_ship: boolean;
  auto_allocate_stock: boolean;
  enforce_fefo: boolean;
  default_costing_method: string;
  fiscal_year_start_month: number;
  default_items_per_page: number;
  date_format: string;
}

export interface SaleItem {
  id: number;
  product_id: number;
  quantity: number;
  unit_price: number;
  product_name: string;
  line_total: number;
  location: string;
  locations: string[];
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
  locations: string[];
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
  lot_count: number;
  serial_count: number;
  total_quantity: number;
  stock_value: number;
}

export interface LocationTree extends Location {
  children: LocationTree[];
}

export interface StockLocationLot {
  lot_id: number;
  lot_number: string;
  quantity: number;
}

export interface StockLocation {
  location_id: number;
  path: string;
  is_active: boolean;
  quantity: number;
  lots: StockLocationLot[];
}

export interface QuarantinedLocation {
  location_id: number;
  path: string;
  name: string;
  quantity: number;
  lots: StockLocationLot[];
}

export interface QuarantinedLocationsResponse {
  locations: QuarantinedLocation[];
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
  serials: LPNSerialItem[];
}

export interface LPNContentItem {
  product_id: number;
  product_name: string;
  lot_id: number | null;
  lot_number: string;
  quantity: number;
}

export interface LPNSerialItem {
  serial_id: number;
  product_id: number;
  product_name: string;
  serial_number: string;
  lot_number: string;
  status: string;
  location_name: string;
}

export interface Lot {
  id: number;
  product_id: number;
  lot_number: string;
  supplier_id: number | null;
  expiry_date: string | null;
  received_date: string;
  status: string;
  created_at: string;
  product_name: string;
  supplier_name: string;
  on_hand: number;
  serial_count: number;
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
  current_on_hand?: number | null;
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

export interface ForecastingRow {
  product_id: number;
  product_name: string;
  sku: string;
  supplier: string;
  supplier_id: number | null;
  on_hand: number;
  reorder_level: number;
  lead_time_days: number;
  lead_time_source: "supplier" | "history" | "default" | "override";
  forecast: number;
  baseline: number;
  stddev: number;
  safety_stock: number;
  reorder_point: number;
  open_orders: number;
  suggested_order_qty: number;
  days_of_cover: number | null;
  status: "reorder" | "ok";
}

export interface ForecastingReplenishment {
  items: ForecastingRow[];
  summary: {
    products: number;
    to_reorder: number;
    total_suggested_qty: number;
    avg_lead_time: number;
  };
  service_level: number;
  days: number;
}

export interface ForecastingDailyPoint {
  date: string;
  quantity?: number;
  forecast?: number;
}

export interface ForecastingDetail {
  product_id: number;
  product_name: string;
  sku: string;
  supplier: string;
  supplier_id: number | null;
  service_level: number;
  days: number;
  forecast: number;
  baseline: number;
  factors: Record<string, number>;
  stddev: number;
  lead_time_days: number;
  lead_time_source: string;
  safety_stock: number;
  reorder_point: number;
  on_hand: number;
  open_orders: number;
  suggested_order_qty: number;
  daily: ForecastingDailyPoint[];
  forecast_series: ForecastingDailyPoint[];
}

export interface BOMItem {
  id: number;
  bom_id: number;
  product_id: number;
  quantity: number;
  position: number;
  product_name: string;
  unit_cost: number;
}

export interface BOM {
  id: number;
  product_id: number;
  name: string;
  description: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  product_name: string;
  item_count: number;
  total_cost: number;
  items: BOMItem[];
}

export interface WorkOrderItem {
  id: number;
  work_order_id: number;
  product_id: number;
  quantity_required: number;
  quantity_issued: number;
  product_name: string;
}

export interface WorkOrder {
  id: number;
  wo_number: string;
  product_id: number;
  quantity: number;
  bom_id: number | null;
  wip_location_id: number | null;
  status: string;
  priority: string;
  notes: string;
  created_by: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  product_name: string;
  username: string;
  bom_name: string;
  is_serialized: boolean;
  total_required: number;
  total_issued: number;
  fully_issued: boolean;
  items: WorkOrderItem[];
}

export interface QualityCheck {
  id: number;
  qc_number: string;
  product_id: number;
  lot_id: number | null;
  location_id: number | null;
  work_order_id: number | null;
  batch_number: string;
  result: string;
  notes: string;
  checked_by: number;
  checked_at: string | null;
  created_at: string;
  product_name: string;
  lot_number: string;
  location_name: string;
  wo_number: string;
  checker_username: string;
}

export interface ProductTraceMovement {
  id: number;
  created_at: string;
  movement_type: string;
  quantity_change: number;
  reference_type: string | null;
  reference: string;
  notes: string;
  lot_number: string;
  username: string;
  from_location_name: string;
  to_location_name: string;
}

export interface ProductTraceWorkOrder {
  wo_number: string;
  role: string;
  status: string;
  quantity: number;
  created_at: string;
}

export interface ProductTrace {
  product_id: number;
  product_name: string;
  sku: string;
  incoming: ProductTraceMovement[];
  outgoing: ProductTraceMovement[];
  work_orders: ProductTraceWorkOrder[];
}

export interface LotGenealogyEntry {
  lot_id: number;
  lot_number: string;
  product_id: number;
  product_name: string;
  status: string;
  quantity: number;
  depth?: number;
  work_order_id?: number | null;
  wo_number?: string;
}

export interface LotGenealogy {
  lot_id: number;
  lot_number: string;
  product_id: number;
  product_name: string;
  status: string;
  on_hand: number;
  serial_count: number;
  parents: LotGenealogyEntry[];
  children: LotGenealogyEntry[];
  affected: LotGenealogyEntry[];
}

export interface MRPItem {
  product_id: number;
  product_name: string;
  sku: string;
  level: number;
  component_of: string;
  bom_id: number | null;
  has_bom: boolean;
  gross_requirement: number;
  on_hand: number;
  scheduled_receipts: number;
  available: number;
  net_requirement: number;
  action: "none" | "manufacture" | "purchase";
  suggested_quantity: number;
}

export interface MRPPlan {
  demand_product_id: number;
  demand_product_name: string;
  demand_quantity: number;
  items: MRPItem[];
}

export interface ProductCostItem {
  product_id: number;
  product_name: string;
  sku: string;
  quantity_per_unit: number;
  component_unit_cost: number;
  has_bom: boolean;
  extended_cost: number;
}

export interface ProductCost {
  product_id: number;
  product_name: string;
  sku: string;
  unit_cost: number;
  direct_cost: number;
  has_bom: boolean;
  items: ProductCostItem[];
}

export interface WorkOrderCost {
  wo_number: string;
  product_id: number;
  product_name: string;
  status: string;
  quantity: number;
  material_cost: number;
  standard_unit_cost: number;
  actual_unit_cost: number;
  variance: number;
  rows: {
    product_id: number;
    product_name: string;
    quantity_required: number;
    quantity_issued: number;
    unit_cost: number;
    issued_cost: number;
    required_cost: number;
  }[];
}

export interface ManufacturingCostRow {
  wo_id: number;
  wo_number: string;
  product_name: string;
  quantity: number;
  completed_at: string | null;
  material_cost: number;
  standard_cost: number;
  actual_unit_cost: number;
  standard_unit_cost: number;
  variance: number;
}

export interface ManufacturingCostReport {
  items: ManufacturingCostRow[];
  total_material_cost: number;
  total_standard_cost: number;
  total_variance: number;
  completed_orders: number;
}

export interface ShipmentItem {
  id: number;
  shipment_id: number;
  product_id: number;
  location_id: number | null;
  quantity_ordered: number;
  quantity_picked: number;
  quantity_packed: number;
  quantity_shipped: number;
  product_name: string;
  location_name: string;
  is_serialized: boolean;
}

export interface Shipment {
  id: number;
  shipment_number: string;
  customer_id: number | null;
  status: string;
  carrier: string;
  tracking_number: string;
  staging_location_id: number | null;
  sale_id: number | null;
  notes: string;
  ship_date: string | null;
  shipped_at: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  customer_name: string;
  username: string;
  invoice_number: string;
  payment_method: string;
  total_amount: number;
  total_quantity: number;
  total_picked: number;
  items: ShipmentItem[];
}

export interface ShipmentStats {
  counts: Record<string, number>;
  open: number;
}

export interface WorkOrderGenealogy {
  wo_number: string;
  status: string;
  component_lots: { lot_id: number; lot_number: string; product_id: number; product_name: string; quantity: number }[];
  fg_lots: { lot_id: number; lot_number: string; product_id: number; product_name: string; quantity: number }[];
  links: { parent_lot_id: number; parent_lot_number: string; child_lot_id: number; child_lot_number: string; quantity: number }[];
}
