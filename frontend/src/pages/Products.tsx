import type { SavedSearchEntry } from "../components/SavedSearches";
import { useDateFormat } from "../hooks/useDateFormat";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Pencil, Trash2, AlertTriangle, History, Eye, ClipboardList, ChevronRight, ChevronDown, Package, PackagePlus, Fingerprint, ExternalLink, PanelRightOpen } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { Category, PaginatedResponse, Product, StockMovement } from "../types";
import ProductForm from "../components/ProductForm";
import ProductDetail from "../components/ProductDetail";
import HoverCard from "../components/HoverCard";
import AdjustStockModal from "../components/AdjustStockModal";
import BulkEditModal from "../components/BulkEditModal";
import DateRangePicker from "../components/DateRangePicker";
import NumericRangeInput from "../components/NumericRangeInput";
import SavedSearches from "../components/SavedSearches";
import { useRecentSearches } from "../hooks/useRecentSearches";
import CsvImportModal from "../components/CsvImportModal";
import ConfirmDialog from "../components/ConfirmDialog";
import SlideOver from "../components/SlideOver";
import Drawer from "../components/Drawer";
import BarcodeScanner from "../components/BarcodeScanner";
import PageHeader from "../components/PageHeader";
import FilterBar from "../components/FilterBar";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import Pagination from "../components/Pagination";
import { useDebounce } from "../hooks/useDebounce";
import { useSettings } from "../hooks/useSettings";
import { useExportCsv } from "../hooks/useExportCsv";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { formatCurrency } from "../utils/currency";
import { getPlaceholder, onImageError } from "../utils/placeholders";
import { productImageUrl } from "../utils/images";
import { daysUntil } from "../utils/date";
import { hasVariants } from "../utils/variants";
import { movementBadgeClass, movementLabel } from "../utils/movementTypes";

import { usePageSize } from "../hooks/usePageSize";

interface DisplayRow {
  kind: "parent" | "variant";
  product: Product;
}

function ProductHoverCard({ product, currencySymbol, onView }: { product: Product; currencySymbol: string; onView: () => void }) {
  return (
    <div className="p-3">
      <div className="-mx-3 -mt-3 mb-3 h-32 bg-subtle flex items-center justify-center overflow-hidden rounded-t-xl">
        <img src={productImageUrl(product)} alt="" className="w-full h-full object-contain p-2" loading="lazy" onError={onImageError} draggable={false} />
      </div>
      <p className="font-semibold text-ink leading-snug break-words">{product.display_name || product.name}</p>
      <p className="mt-1 text-xs text-muted line-clamp-3 break-words">{product.description || "No description available."}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="rounded bg-app px-1.5 py-0.5 font-medium text-faint">{product.sku}</span>
        <span className="font-semibold text-ink">{formatCurrency(product.unit_price, currencySymbol)}</span>
        {product.supplier_name && <span className="truncate">{product.supplier_name}</span>}
      </div>
      <div className="mt-2.5 pt-2.5 border-t border-border flex justify-end">
        <button type="button" onClick={onView} className="btn-primary inline-flex items-center gap-1.5 text-xs px-3 py-1.5">
          View Product
          <ExternalLink size={12} />
        </button>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-3 last:border-0">
      <dt className="text-sm text-muted shrink-0">{label}</dt>
      <dd className="text-sm font-medium text-ink break-words text-right">{value}</dd>
    </div>
  );
}

function ProductQuickView({ product, currencySymbol, onFullView }: { product: Product; currencySymbol: string; onFullView?: () => void }) {
  const formatDate = useDateFormat();
  const stock = product.total_quantity ?? product.quantity ?? 0;
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-4">
        <div className="h-24 w-24 shrink-0 rounded-xl bg-subtle flex items-center justify-center overflow-hidden">
          <img
            src={productImageUrl(product)}
            alt=""
            className="w-full h-full object-contain p-2"
            loading="lazy"
            onError={onImageError}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold leading-snug break-words">{product.display_name || product.name}</p>
          {product.sku && (<p className="mt-0.5 text-sm text-faint font-mono">{product.sku}</p>)}
          <p className="mt-1.5 text-sm text-muted line-clamp-3 break-words">{product.description || "No description available."}</p>
        </div>
      </div>

      <dl className="mt-4">
        <DetailRow label="Stock" value={`${stock} unit${stock === 1 ? "" : "s"}`} />
        <DetailRow label="Unit Price" value={formatCurrency(product.unit_price, currencySymbol)} />
        <DetailRow label="Unit Cost" value={formatCurrency(product.cost_price, currencySymbol)} />
        <DetailRow label="Category" value={product.category_name || "—"} />
        <DetailRow label="Supplier" value={product.supplier_name || "—"} />
        <DetailRow label="Created" value={formatDate(product.created_at)} />
        <DetailRow label="Expiry" value={formatDate(product.effective_expiry_date ?? product.expiry_date)} />
      </dl>

      <div className="flex justify-end">
        <button onClick={onFullView} className="btn-secondary flex items-center gap-1.5 text-sm">
          View full details
          <ExternalLink size={14} />
        </button>
      </div>
    </div>
  );
}

export default function Products() {
  const formatDate = useDateFormat();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [categoryFilter, setCategoryFilter] = useState(() => searchParams.get("category") ?? "");
  const [expiryFilter, setExpiryFilter] = useState(() => searchParams.get("expiry") ?? "");
  const [lowStock, setLowStock] = useState(searchParams.get("low_stock") === "1");
  const { recent, addRecent, clearRecent } = useRecentSearches("products");
  const [stockMin, setStockMin] = useState(() => searchParams.get("stock_min") ?? "");
  const [stockMax, setStockMax] = useState(() => searchParams.get("stock_max") ?? "");
  const [priceMin, setPriceMin] = useState(() => searchParams.get("price_min") ?? "");
  const [priceMax, setPriceMax] = useState(() => searchParams.get("price_max") ?? "");
  const [costMin, setCostMin] = useState(() => searchParams.get("cost_min") ?? "");
  const [costMax, setCostMax] = useState(() => searchParams.get("cost_max") ?? "");
  const [createdAfter, setCreatedAfter] = useState(() => searchParams.get("created_after") ?? "");
  const [createdBefore, setCreatedBefore] = useState(() => searchParams.get("created_before") ?? "");
  const [expiryAfter, setExpiryAfter] = useState(() => searchParams.get("expiry_after") ?? "");
  const [expiryBefore, setExpiryBefore] = useState(() => searchParams.get("expiry_before") ?? "");
  const [sortKey, setSortKey] = useState<string>("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [variantParent, setVariantParent] = useState<Product | null>(null);
  const [viewing, setViewing] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [movementProduct, setMovementProduct] = useState<Product | null>(null);
  const [quickView, setQuickView] = useState<Product | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [toggling, setToggling] = useState<Product | null>(null);
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { can } = useAuth();
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  const showProductCards = settings?.show_product_hover_cards ?? true;
  const debouncedSearch = useDebounce(search, 300);
  const { exportCsv } = useExportCsv();

  useEffect(() => {
    const s = searchParams.get("search");
    if (s != null) setSearch(s);
    const nextLowStock = searchParams.get("low_stock") === "1";
    setLowStock((prev) => {
      if (prev !== nextLowStock) setPage(1);
      return nextLowStock;
    });
    const nextCategory = searchParams.get("category") ?? "";
    setCategoryFilter((prev) => {
      if (prev !== nextCategory) setPage(1);
      return nextCategory;
    });
    const nextExpiry = searchParams.get("expiry") ?? "";
    setExpiryFilter((prev) => {
      if (prev !== nextExpiry) setPage(1);
      return nextExpiry;
    });
  }, [searchParams]);

  const updateSearchParam = (key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  };

  const onFilterChange = (key: string, value: string) => {
    if (key === "search") { setSearch(value); setPage(1); return; }
    if (key === "category") { setCategoryFilter(value); setPage(1); updateSearchParam("category", value); return; }
    if (key === "expiry") { setExpiryFilter(value); setPage(1); updateSearchParam("expiry", value); return; }
  };

  useEffect(() => {
    setSelectedIds(new Set());
  }, [debouncedSearch, categoryFilter, expiryFilter, lowStock]);

  const { data: categories } = useQuery({
    queryKey: ["categories", 1],
    queryFn: async () => { const { data } = await api.get("/categories"); return (data as PaginatedResponse<Category>).items; },
  });

  const { data: productsRaw, isLoading } = useQuery({
    queryKey: ["products", debouncedSearch, categoryFilter, expiryFilter, lowStock, stockMin, stockMax, priceMin, priceMax, costMin, costMax, createdAfter, createdBefore, expiryAfter, expiryBefore, page, pageSize, sortKey, sortDir],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString(), include_variants: "1" };
      if (debouncedSearch) params.search = debouncedSearch;
      if (categoryFilter) params.category_id = categoryFilter;
      if (expiryFilter) params.expiry = expiryFilter;
      if (lowStock) params.low_stock = "1";
      if (stockMin) params.stock_min = stockMin;
      if (stockMax) params.stock_max = stockMax;
      if (priceMin) params.price_min = priceMin;
      if (priceMax) params.price_max = priceMax;
      if (costMin) params.cost_min = costMin;
      if (costMax) params.cost_max = costMax;
      if (createdAfter) params.created_after = createdAfter;
      if (createdBefore) params.created_before = createdBefore;
      if (expiryAfter) params.expiry_after = expiryAfter;
      if (expiryBefore) params.expiry_before = expiryBefore;
      if (sortKey) {
        params.sort_by = sortKey;
        params.sort_dir = sortDir;
      }
      const { data } = await api.get("/products", { params });
      return data as PaginatedResponse<Product>;
    },
  });

  useEffect(() => {
    const pages = productsRaw?.pages;
    if (pages && page > pages) setPage(pages);
  }, [productsRaw?.pages, page]);

  const { data: movements, isLoading: movementsLoading, isError: movementsError } = useQuery({
    queryKey: ["product-movements", movementProduct?.id],
    queryFn: async () => {
      const { data } = await api.get(`/products/${movementProduct!.id}/movements`);
      return data as StockMovement[];
    },
    enabled: !!movementProduct,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/products/${id}`),
    onSuccess: (_data, id) => {
      addToast("Product deleted", "success");
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: () => addToast("Failed to delete product", "error"),
  });

  const toggleStatus = useMutation({
    mutationFn: (p: Product) => api.put(`/products/${p.id}`, { is_active: !p.is_active }),
    onSuccess: () => {
      addToast("Product status updated", "success");
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: () => addToast("Failed to update product status", "error"),
  });

  const toggleSort = (key: string) => {
    setPage(1);
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const parents = productsRaw?.items || [];

  const rows: DisplayRow[] = [];
  for (const p of parents) {
    const isGroup = hasVariants(p);
    rows.push({ kind: "parent", product: p });
    if (isGroup && !collapsed.has(p.id)) {
      for (const v of p.variants) rows.push({ kind: "variant", product: v });
    }
  }

  const handleExport = () => {
    const params: Record<string, string> = {};
    if (debouncedSearch) params.search = debouncedSearch;
    if (categoryFilter) params.category_id = categoryFilter;
    if (expiryFilter) params.expiry = expiryFilter;
    if (lowStock) params.low_stock = "1";
    if (stockMin) params.stock_min = stockMin;
    if (stockMax) params.stock_max = stockMax;
    if (priceMin) params.price_min = priceMin;
    if (priceMax) params.price_max = priceMax;
    if (costMin) params.cost_min = costMin;
    if (costMax) params.cost_max = costMax;
    if (createdAfter) params.created_after = createdAfter;
    if (createdBefore) params.created_before = createdBefore;
    if (expiryAfter) params.expiry_after = expiryAfter;
    if (expiryBefore) params.expiry_before = expiryBefore;
    exportCsv("/reports/export/products", "products_report.csv", "Products report", params);
  };

  const handleLabels = async () => {
    try {
      const ids = [...selectedIds];
      const { data } = await api.get("/products/barcode-labels", {
        params: ids.length > 0 ? { ids: ids.join(",") } : {},
        responseType: "blob",
      });
      const url = URL.createObjectURL(data);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      addToast("Failed to generate labels", "error");
    }
  };

  const sortIndicator = (key: string) => sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const expiryWindow = settings?.expiry_warning_days ?? 30;

  const expiryBadge = (p: Product, sellable: number) => {
    const days = typeof p.expiry_days_left === "number" ? p.expiry_days_left : (p.expiry_date ? daysUntil(p.expiry_date) : null);
    const displayDate = p.effective_expiry_date || p.expiry_date;
    if (days === null) return <span className="text-faint">—</span>;
    if (days < 0) return <span className="badge badge-danger">Expired</span>;
    if (days <= expiryWindow && sellable > 0 && displayDate) return <span className="badge badge-warning">Expires {formatDate(displayDate)}</span>;
    if (displayDate) return <span className="text-muted text-xs">{formatDate(displayDate)}</span>;
    return <span className="text-muted text-xs">—</span>;
  };

  const allSelected = parents.length > 0 && parents.every((p) => selectedIds.has(p.id));
  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (allSelected) { setSelectedIds(new Set()); }
    else { setSelectedIds(new Set(parents.map((p) => p.id))); }
  };

  const qtyOf = (r: DisplayRow) => (r.kind === "parent" && hasVariants(r.product) ? r.product.total_quantity : r.product.quantity);
  const quarantinedQtyOf = (r: DisplayRow) => {
    if (r.kind === "parent" && hasVariants(r.product)) {
      return (r.product.quarantined_qty || 0) + r.product.variants.filter((v) => v.is_active).reduce((sum, v) => sum + (v.quarantined_qty || 0), 0);
    }
    return r.product.quarantined_qty || 0;
  };
  const expiredLotQtyOf = (r: DisplayRow) => {
    if (r.kind === "parent" && hasVariants(r.product)) {
      return (r.product.expired_lot_qty || 0) + r.product.variants.filter((v) => v.is_active).reduce((sum, v) => sum + (v.expired_lot_qty || 0), 0);
    }
    return r.product.expired_lot_qty || 0;
  };
  const sellableQtyOf = (r: DisplayRow) => {
    if (r.kind === "parent" && hasVariants(r.product)) {
      return (r.product.sellable_qty || 0) + r.product.variants.filter((v) => v.is_active).reduce((sum, v) => sum + (v.sellable_qty || 0), 0);
    }
    return r.product.sellable_qty || 0;
  };
  const reservedQtyOf = (r: DisplayRow) => {
    if (r.kind === "parent" && hasVariants(r.product)) {
      return (r.product.reserved_qty || 0) + r.product.variants.filter((v) => v.is_active).reduce((sum, v) => sum + (v.reserved_qty || 0), 0);
    }
    return r.product.reserved_qty || 0;
  };

  const applySavedParams = (params: SavedSearchEntry["params"]) => {
    setSearch(params.search ?? "");
    setCategoryFilter(params.category ?? "");
    setExpiryFilter(params.expiry ?? "");
    setLowStock(params.low_stock === "1");
    setStockMin(params.stock_min ?? ""); setStockMax(params.stock_max ?? "");
    setPriceMin(params.price_min ?? ""); setPriceMax(params.price_max ?? "");
    setCostMin(params.cost_min ?? ""); setCostMax(params.cost_max ?? "");
    setCreatedAfter(params.created_after ?? ""); setCreatedBefore(params.created_before ?? "");
    setExpiryAfter(params.expiry_after ?? ""); setExpiryBefore(params.expiry_before ?? "");
    setPage(1);
    for (const [k, v] of Object.entries(params)) updateSearchParam(k, v);
  };
  const hasActiveFilters = !!(search || categoryFilter || expiryFilter || lowStock || stockMin || stockMax || priceMin || priceMax || costMin || costMax || createdAfter || createdBefore || expiryAfter || expiryBefore);
  const savedSearchParams = (): Record<string, string> => Object.fromEntries([...searchParams.entries()]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Package}
        title="Products"
        subtitle="Manage the items you stock, sell, and manufacture."
        actions={
          <>
            <button onClick={() => setShowImport(true)} className="btn-secondary" aria-label="Import products from CSV">
              Import
            </button>
            <button onClick={handleExport} className="btn-secondary" aria-label="Export products to CSV">
              Export
            </button>
            <button onClick={handleLabels} className="btn-secondary" aria-label="Print barcode labels">
              Labels
            </button>
            <button onClick={() => { setEditing(null); setVariantParent(null); setShowForm(true); }} className="btn-primary">
              Add Product
            </button>
          </>
        }
      />

      <FilterBar
        columns={4}
        values={{ search, category: categoryFilter, expiry: expiryFilter }}
        setFilter={onFilterChange}
        items={[
          {
            type: "search",
            ariaLabel: "Search products",
            placeholder: "Search by Product Name and SKU ...",
            className: "sm:col-span-2 lg:col-span-1",
            onKeyDown: (e) => { if (e.key === "Enter" && search.trim()) addRecent(search.trim()); },
          },
          { type: "custom", render: () => <BarcodeScanner onProductFound={(p) => { setSearch(p.sku); setPage(1); }} /> },
          {
            type: "select",
            key: "category",
            ariaLabel: "Filter by category",
            placeholder: "All Categories",
            maxWidth: 220,
            options: (categories || []).map((c) => ({ value: String(c.id), label: c.name })),
          },
          {
            type: "select",
            key: "expiry",
            ariaLabel: "Filter by expiry",
            placeholder: "All Expiry",
            maxWidth: 220,
            options: [
              { value: "expiring", label: `Expiring Soon (${expiryWindow} days)` },
              { value: "expired", label: "Expired" },
            ],
          },
        ]}
      />

      {(expiryFilter || lowStock) && (
        <div className="flex items-center gap-2 flex-wrap">
          {expiryFilter && (
            <button
              onClick={() => { setExpiryFilter(""); setPage(1); updateSearchParam("expiry", ""); }}
              className="badge badge-warning cursor-pointer border border-amber-300"
              aria-label="Clear expiry filter"
            >
              {expiryFilter === "expired" ? "Expired ✕" : `Expiring Soon (${expiryWindow} days) ✕`}
            </button>
          )}
          {lowStock && (
            <button
              onClick={() => { setLowStock(false); setPage(1); updateSearchParam("low_stock", ""); }}
              className="badge badge-warning cursor-pointer border border-amber-300"
              aria-label="Clear low stock filter"
            >
              Low Stock ✕
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-center">
        <NumericRangeInput
          label="Stock"
          ariaLabel="Stock quantity range"
          min={stockMin}
          max={stockMax}
          placeholder="Qty"
          onChange={(min, max) => { setStockMin(min); setStockMax(max); setPage(1); }}
        />
        <NumericRangeInput
          label="Unit Price"
          ariaLabel="Unit price range"
          min={priceMin}
          max={priceMax}
          placeholder="Price"
          onChange={(min, max) => { setPriceMin(min); setPriceMax(max); setPage(1); }}
        />
        <NumericRangeInput
          label="Unit Cost"
          ariaLabel="Unit cost range"
          min={costMin}
          max={costMax}
          placeholder="Cost"
          onChange={(min, max) => { setCostMin(min); setCostMax(max); setPage(1); }}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">
        <DateRangePicker
          label="Created"
          ariaLabel="Created date range"
          from={createdAfter}
          to={createdBefore}
          fromPlaceholder="From"
          toPlaceholder="To"
          onChange={(from, to) => { setCreatedAfter(from); setCreatedBefore(to); setPage(1); }}
        />
        <DateRangePicker
          label="Expiry"
          ariaLabel="Expiry date range"
          from={expiryAfter}
          to={expiryBefore}
          fromPlaceholder="From"
          toPlaceholder="To"
          onChange={(from, to) => { setExpiryAfter(from); setExpiryBefore(to); setPage(1); }}
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <SavedSearches
          scope="products"
          entityLabel="Products"
          currentParams={savedSearchParams()}
          active={hasActiveFilters}
          onApply={applySavedParams}
          className=""
        />
        {recent.length > 0 && (
          <span className="text-sm font-medium text-muted">Recent:</span>
        )}
        {recent.map((term) => (
          <button
            key={term}
            onClick={() => { setSearch(term); setPage(1); }}
            className="badge badge-ghost cursor-pointer"
            aria-label={`Use recent search ${term}`}
          >
            {term}
          </button>
        ))}
        {recent.length > 0 && (
          <button
            onClick={clearRecent}
            className="text-sm text-muted hover:text-danger"
            aria-label="Clear recent searches"
          >
            Clear
          </button>
        )}
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-primary-soft dark:bg-primary/10 rounded-lg border border-primary-soft dark:border-primary/30">
          <span className="text-sm font-medium text-primary-strong dark:text-primary">{selectedIds.size} selected</span>
          <button onClick={() => setShowBulkEdit(true)} className="btn-primary text-sm px-3 py-1.5">
            Bulk Edit
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="text-sm text-primary dark:text-primary hover:text-primary-strong dark:text-primary underline">Clear</button>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" role="grid" aria-label="Products table">
            <thead>
              <tr className="bg-app text-left">
                <th scope="col" className="px-4 py-3">
                  <input type="checkbox" className="rounded border-border-strong" checked={allSelected} onChange={toggleSelectAll} aria-label="Select all products" />
                </th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Image</th>
                <th className="px-4 py-3 font-medium text-muted cursor-pointer select-none" onClick={() => toggleSort("sku")} aria-label="Sort by SKU">SKU{sortIndicator("sku")}</th>
                <th className="px-4 py-3 font-medium text-muted cursor-pointer select-none" onClick={() => toggleSort("name")} aria-label="Sort by name">Name{sortIndicator("name")}</th>
                <th className="hidden md:table-cell px-4 py-3 font-medium text-muted cursor-pointer select-none" onClick={() => toggleSort("category_name")} aria-label="Sort by category">Category{sortIndicator("category_name")}</th>
                <th className="hidden md:table-cell px-4 py-3 font-medium text-muted cursor-pointer select-none" onClick={() => toggleSort("supplier_name")} aria-label="Sort by supplier">Supplier{sortIndicator("supplier_name")}</th>
                <th className="hidden sm:table-cell px-4 py-3 font-medium text-muted cursor-pointer select-none" onClick={() => toggleSort("unit_price")} aria-label="Sort by price">Price{sortIndicator("unit_price")}</th>
                <th className="hidden md:table-cell px-4 py-3 font-medium text-muted cursor-pointer select-none" onClick={() => toggleSort("cost_price")} aria-label="Sort by cost">Cost{sortIndicator("cost_price")}</th>
                <th className="px-4 py-3 font-medium text-muted cursor-pointer select-none" onClick={() => toggleSort("quantity")} aria-label="Sort by quantity">Qty{sortIndicator("quantity")}</th>
                <th scope="col" className="hidden sm:table-cell px-4 py-3 font-medium text-muted">Location</th>
                <th scope="col" className="hidden sm:table-cell px-4 py-3 font-medium text-muted">Batch</th>
                <th scope="col" className="hidden sm:table-cell px-4 py-3 font-medium text-muted">Expiry</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Status</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <Skeleton rows={5} cols={14} />
              ) : rows.length === 0 ? (
                <EmptyState title={search || categoryFilter || expiryFilter || lowStock ? "No matching products" : "No products found"} message={search || categoryFilter || expiryFilter || lowStock ? "Nothing matched your search or filters. Try adjusting them." : "Add your first product to start building inventory."} actionLabel={search || categoryFilter || expiryFilter || lowStock ? undefined : "Add Product"} onAction={search || categoryFilter || expiryFilter || lowStock ? undefined : () => { setEditing(null); setVariantParent(null); setShowForm(true); }} />
              ) : rows.map((r) => {
                const p = r.product;
                const isGroup = r.kind === "parent" && hasVariants(p);
                const qty = qtyOf(r);
                const quarantined = quarantinedQtyOf(r);
                const expired = expiredLotQtyOf(r);
                const sellable = sellableQtyOf(r);
                const reserved = reservedQtyOf(r);
                const isLowStock = sellable <= p.reorder_level && !isGroup;
                const isCollapsed = isGroup && collapsed.has(p.id);
                const nameNode = r.kind === "variant" ? <span className="text-muted">{p.display_name}</span> : <span className="font-medium">{p.name}</span>;
                return (
                  <tr key={`${r.kind}-${p.id}`} className={`${r.kind === "variant" ? "bg-app/60 hover:bg-subtle" : "hover:bg-app"} cursor-pointer`} onClick={(e) => { const t = e.target as HTMLElement; if (t instanceof HTMLInputElement || t instanceof HTMLButtonElement || t.closest("button") || t.closest("input")) return; setViewing(p); }}>
                    <td className="px-4 py-3">
                      <input type="checkbox" className="rounded border-border-strong" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} aria-label={`Select ${p.display_name}`} />
                    </td>
                    <td className="px-4 py-3">
                      <img
                        src={p.images?.length > 0 ? p.images[0].url : p.image_url || getPlaceholder()}
                        alt=""
                        className="w-10 h-10 rounded object-cover"
                        loading="lazy"
                        onError={onImageError}
                      />
                    </td>
                    <td className="px-4 py-3 font-medium">{p.sku}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {isGroup && (
                          <button
                            onClick={() => setCollapsed((prev) => { const next = new Set(prev); if (next.has(p.id)) next.delete(p.id); else next.add(p.id); return next; })}
                            className="p-0.5 text-faint hover:text-primary dark:text-primary"
                            aria-label={isCollapsed ? "Expand variants" : "Collapse variants"}
                          >
                            {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                          </button>
                        )}
                        {showProductCards ? (
                          <HoverCard
                            width={340}
                            render={(close) => (
                              <ProductHoverCard
                                product={p}
                                currencySymbol={currencySymbol}
                                onView={() => { close(); setViewing(p); }}
                              />
                            )}
                          >
                            {nameNode}
                          </HoverCard>
                        ) : nameNode}
                        {isGroup && (
                          <span className="badge bg-primary-soft dark:bg-primary/10 text-primary-strong dark:text-primary border border-primary-soft dark:border-primary/30">{p.variants.filter((v) => v.is_active).length} variants</span>
                        )}
                        {p.is_serialized && (
                          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-cyan-50 text-cyan-700 border border-cyan-200 dark:bg-cyan-500/10 dark:text-cyan-400 dark:border-cyan-500/30">
                            <Fingerprint size={12} />
                            serialized
                          </span>
                        )}
                        {isLowStock && (
                          <AlertTriangle size={14} className="text-red-500" aria-label="Low stock" />
                        )}
                      </div>
                    </td>
                    <td className="hidden md:table-cell px-4 py-3 text-muted">{p.category_name}</td>
                    <td className="hidden md:table-cell px-4 py-3 text-muted">{p.supplier_name || "—"}</td>
                    <td className="hidden sm:table-cell px-4 py-3">{formatCurrency(p.unit_price, currencySymbol)}</td>
                    <td className="hidden md:table-cell px-4 py-3">{formatCurrency(p.cost_price, currencySymbol)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={isLowStock ? "text-red-600 dark:text-red-400 font-medium" : ""}>
                          {qty}
                        </span>
                        {sellable < qty && (
                          <span className="badge badge-success" title={`${sellable} of ${qty} unit(s) available to allocate`}>
                            S{sellable}
                          </span>
                        )}
                        {quarantined > 0 && (
                          <span className="badge badge-warning" title={`${quarantined} unit(s) in quarantined lots`}>
                            Q{quarantined}
                          </span>
                        )}
                        {expired > 0 && (
                          <span className="badge badge-danger" title={`${expired} unit(s) in expired lots`}>
                            E{expired}
                          </span>
                        )}
                        {reserved > 0 && (
                          <span className="badge badge-info" title={`${reserved} unit(s) reserved for work orders`}>
                            R{reserved}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3 text-muted">{p.location}</td>
                    <td className="hidden sm:table-cell px-4 py-3 text-muted">{p.batch_number || "—"}</td>
                    <td className="hidden sm:table-cell px-4 py-3">{expiryBadge(p, sellable)}</td>
                    <td className="px-4 py-3">
                      {can("products.update") ? (
                        <button
                          onClick={() => setToggling(p)}
                          className={`badge cursor-pointer border ${p.is_active ? "badge-success" : "badge-danger"}`}
                          title={p.is_active ? "Click to deactivate" : "Click to activate"}
                          aria-label={`Toggle status for ${p.display_name}`}
                        >
                          {p.is_active ? "Active" : "Inactive"}
                        </button>
                      ) : (
                        <span className={`badge ${p.is_active ? "badge-success" : "badge-danger"}`}>{p.is_active ? "Active" : "Inactive"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 items-center">
                        {!p.is_variant && !p.is_serialized && (
                          <button onClick={() => { setVariantParent(p); setEditing(null); setShowForm(true); }} className="p-1 text-faint hover:text-primary dark:text-primary" title={`Add variant to ${p.name}`} aria-label={`Add variant to ${p.name}`}>
                            <PackagePlus size={16} />
                          </button>
                        )}
                        <button onClick={() => setQuickView(p)} className="p-1 text-faint hover:text-primary dark:text-primary" aria-label={`Quick view ${p.display_name}`}>
                          <PanelRightOpen size={16} />
                        </button>

                        <button onClick={() => setViewing(p)} className="p-1 text-faint hover:text-primary dark:text-primary" aria-label={`View ${p.display_name}`}>
                          <Eye size={16} />
                        </button>
                        {!isGroup && !p.is_serialized && (
                          <button onClick={() => setAdjusting(p)} className="p-1 text-faint hover:text-primary dark:text-primary" aria-label={`Adjust stock for ${p.display_name}`}>
                            <ClipboardList size={16} />
                          </button>
                        )}
                        {!isGroup && (
                          <button onClick={() => setMovementProduct(p)} className="p-1 text-faint hover:text-primary dark:text-primary" aria-label={`View movement history for ${p.display_name}`}>
                            <History size={16} />
                          </button>
                        )}
                        <button onClick={() => { setEditing(p); setVariantParent(null); setShowForm(true); }} className="p-1 text-faint hover:text-primary dark:text-primary" aria-label={`Edit ${p.display_name}`}>
                          <Pencil size={16} />
                        </button>
                        <button onClick={() => setDeleting(p)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Delete ${p.display_name}`}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination page={page} totalPages={productsRaw?.pages || 1} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />

      {showForm && (
        <ProductForm
          product={editing}
          parent={variantParent}
          onClose={() => { setShowForm(false); setEditing(null); setVariantParent(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); setVariantParent(null); queryClient.invalidateQueries({ queryKey: ["products"] }); }}
        />
      )}

      {viewing && <ProductDetail product={viewing} onClose={() => setViewing(null)} onAddVariant={(p) => { setViewing(null); setVariantParent(p); setEditing(null); setShowForm(true); }} onEdit={() => { setEditing(viewing); setViewing(null); setShowForm(true); }} />}

      {adjusting && (
        <AdjustStockModal
          product={adjusting}
          onClose={() => setAdjusting(null)}
          onAdjusted={() => { setAdjusting(null); queryClient.invalidateQueries({ queryKey: ["products"] }); addToast("Stock adjusted", "success"); }}
        />
      )}

      {showBulkEdit && (
        <BulkEditModal
          ids={[...selectedIds]}
          onClose={() => setShowBulkEdit(false)}
          onSaved={() => { setShowBulkEdit(false); setSelectedIds(new Set()); queryClient.invalidateQueries({ queryKey: ["products"] }); addToast("Products updated", "success"); }}
        />
      )}

      {showImport && (
        <CsvImportModal
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); queryClient.invalidateQueries({ queryKey: ["products"] }); }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete Product"
        message={`Are you sure you want to delete "${deleting?.display_name}"?${deleting && hasVariants(deleting) ? " This will also delete all of its variants. " : " "}This action cannot be undone.`}
        onConfirm={() => { deleteMutation.mutate(deleting!.id); setDeleting(null); }}
        onCancel={() => setDeleting(null)}
      />

      <ConfirmDialog
        open={!!toggling}
        title={toggling?.is_active ? "Deactivate Product" : "Activate Product"}
        message={toggling?.is_active
          ? `Deactivate "${toggling.display_name}"? Inactive products can no longer be sold.`
          : `Reactivate "${toggling?.display_name}"? It will become available for sale again.`}
        confirmLabel={toggling?.is_active ? "Deactivate" : "Activate"}
        confirmClass={toggling?.is_active ? "btn-danger" : "btn-primary"}
        onConfirm={() => { toggleStatus.mutate(toggling!); setToggling(null); }}
        onCancel={() => setToggling(null)}
      />

      <Drawer
        open={!!quickView}
        onClose={() => setQuickView(null)}
        title={quickView ? `Quick view: ${quickView.display_name}` : "Quick view"}
        breadcrumb={quickView ? `${quickView.display_name} (quick view)` : undefined}
        ariaLabel="Quick view product"
        actions={
          <button onClick={() => { if (quickView) { setViewing(quickView); setQuickView(null); } }} className="text-faint hover:text-primary" aria-label="Open full view">
            <ExternalLink size={16} />
          </button>
        }
      >
        {quickView && <ProductQuickView product={quickView} currencySymbol={currencySymbol} />}
      </Drawer>

      <SlideOver open={!!movementProduct} onClose={() => setMovementProduct(null)} title={`Movements: ${movementProduct?.display_name || ""}`} wide ariaLabel={`Movements for ${movementProduct?.display_name || ""}`}>
        {movementsLoading && <Skeleton variant="rows" rows={3} cols={5} />}
        {movementsError && <p className="text-red-600 dark:text-red-400 text-sm">Failed to load movements.</p>}
        {!movementsLoading && !movementsError && movements && movements.length === 0 && <EmptyState compact title="No movements recorded for this product" message="Receipts, transfers, and adjustments will appear here." />}
        {!movementsLoading && !movementsError && movements && movements.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app text-left">
                <th scope="col" className="px-3 py-2 font-medium text-muted">Date</th>
                <th scope="col" className="px-3 py-2 font-medium text-muted">Type</th>
                <th scope="col" className="px-3 py-2 font-medium text-muted">Qty</th>
                <th scope="col" className="px-3 py-2 font-medium text-muted">Ref</th>
                <th scope="col" className="px-3 py-2 font-medium text-muted">User</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {movements.map((m) => (
                <tr key={m.id}>
                  <td className="px-3 py-2 text-muted">{formatDate(m.created_at)}</td>
                  <td className="px-3 py-2"><span className={`badge ${movementBadgeClass(m.movement_type)}`}>{movementLabel(m.movement_type)}</span></td>
                  <td className="px-3 py-2"><span className={m.quantity_change > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>{m.quantity_change > 0 ? "+" : ""}{m.quantity_change}</span></td>
                  <td className="px-3 py-2 text-muted">{m.reference}</td>
                  <td className="px-3 py-2 text-muted">{m.username}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SlideOver>
    </div>
  );
}
