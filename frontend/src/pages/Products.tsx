import { useDateFormat } from "../hooks/useDateFormat";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Pencil, Trash2, AlertTriangle, History, Eye, ClipboardList, ChevronRight, ChevronDown, PackagePlus } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { Category, PaginatedResponse, Product, StockMovement } from "../types";
import ProductForm from "../components/ProductForm";
import ProductDetail from "../components/ProductDetail";
import AdjustStockModal from "../components/AdjustStockModal";
import BulkEditModal from "../components/BulkEditModal";
import CsvImportModal from "../components/CsvImportModal";
import ConfirmDialog from "../components/ConfirmDialog";
import Modal from "../components/Modal";
import BarcodeScanner from "../components/BarcodeScanner";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import Pagination from "../components/Pagination";
import { useDebounce } from "../hooks/useDebounce";
import { useSettings } from "../hooks/useSettings";
import { useExportCsv } from "../hooks/useExportCsv";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { formatCurrency } from "../utils/currency";
import { parseLocalDate } from "../utils/date";
import { hasVariants } from "../utils/variants";

import { usePageSize } from "../hooks/usePageSize";

interface DisplayRow {
  kind: "parent" | "variant";
  product: Product;
}

export default function Products() {
  const formatDate = useDateFormat();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [expiryFilter, setExpiryFilter] = useState("");
  const [lowStock, setLowStock] = useState(searchParams.get("low_stock") === "1");
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
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [toggling, setToggling] = useState<Product | null>(null);
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { can } = useAuth();
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
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
  }, [searchParams]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [debouncedSearch, categoryFilter, expiryFilter, lowStock]);

  const { data: categories } = useQuery({
    queryKey: ["categories", 1],
    queryFn: async () => { const { data } = await api.get("/categories"); return (data as PaginatedResponse<Category>).items; },
  });

  const { data: productsRaw, isLoading } = useQuery({
    queryKey: ["products", debouncedSearch, categoryFilter, expiryFilter, lowStock, page, pageSize, sortKey, sortDir],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString(), include_variants: "1" };
      if (debouncedSearch) params.search = debouncedSearch;
      if (categoryFilter) params.category_id = categoryFilter;
      if (expiryFilter) params.expiry = expiryFilter;
      if (lowStock) params.low_stock = "1";
      if (sortKey) {
        params.sort_by = sortKey;
        params.sort_dir = sortDir;
      }
      const { data } = await api.get("/products", { params });
      return data as PaginatedResponse<Product>;
    },
  });

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
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      addToast("Failed to generate labels", "error");
    }
  };

  const sortIndicator = (key: string) => sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const expiryBadge = (p: Product) => {
    if (!p.expiry_date) return <span className="text-faint">—</span>;
    const days = Math.ceil((parseLocalDate(p.expiry_date).getTime() - Date.now()) / 86400000);
    if (days < 0) return <span className="badge badge-danger">Expired</span>;
    if (days <= 30) return <span className="badge badge-warning">Expires {formatDate(p.expiry_date)}</span>;
    return <span className="text-muted text-xs">{formatDate(p.expiry_date)}</span>;
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

  const movementBadgeClass = (t: string) => {
    if (["in", "receive", "transfer_in", "sale_return", "count"].includes(t)) return "badge-success";
    if (["out", "sale", "transfer_out", "issue", "backflush", "return"].includes(t)) return "badge-danger";
    if (t === "adjustment") return "badge-info";
    return "badge-neutral";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Products</h1>
        <div className="flex gap-2">
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
        </div>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 max-w-md">
          <input
            className="input pl-10"
            placeholder="Search by Product Name and SKU ..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            aria-label="Search products"
          />
        </div>

        <BarcodeScanner onProductFound={(p) => { setSearch(p.sku); setPage(1); }} />
        <select
          className="select w-48"
          value={categoryFilter}
          onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
          aria-label="Filter by category"
        >
          <option value="">All Categories</option>
          {(categories || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select
          className="select w-48"
          value={expiryFilter}
          onChange={(e) => { setExpiryFilter(e.target.value); setPage(1); }}
          aria-label="Filter by expiry"
        >
          <option value="">All Expiry</option>
          <option value="expiring">Expiring Soon (30 days)</option>
          <option value="expired">Expired</option>
        </select>
        {lowStock && (
          <button
            onClick={() => { setLowStock(false); setSearchParams({}); setPage(1); }}
            className="badge badge-warning cursor-pointer border border-amber-300"
            aria-label="Clear low stock filter"
          >
            Low Stock ✕
          </button>
        )}
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-indigo-50 dark:bg-indigo-500/10 rounded-lg border border-indigo-200 dark:border-indigo-500/30">
          <span className="text-sm font-medium text-indigo-700 dark:text-indigo-400">{selectedIds.size} selected</span>
          <button onClick={() => setShowBulkEdit(true)} className="btn-primary text-sm px-3 py-1.5">
            Bulk Edit
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:text-indigo-400 underline">Clear</button>
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
                <th className="px-4 py-3 font-medium text-muted cursor-pointer select-none" onClick={() => toggleSort("category_name")} aria-label="Sort by category">Category{sortIndicator("category_name")}</th>
                <th className="px-4 py-3 font-medium text-muted cursor-pointer select-none" onClick={() => toggleSort("supplier_name")} aria-label="Sort by supplier">Supplier{sortIndicator("supplier_name")}</th>
                <th className="px-4 py-3 font-medium text-muted cursor-pointer select-none" onClick={() => toggleSort("unit_price")} aria-label="Sort by price">Price{sortIndicator("unit_price")}</th>
                <th className="px-4 py-3 font-medium text-muted cursor-pointer select-none" onClick={() => toggleSort("cost_price")} aria-label="Sort by cost">Cost{sortIndicator("cost_price")}</th>
                <th className="px-4 py-3 font-medium text-muted cursor-pointer select-none" onClick={() => toggleSort("quantity")} aria-label="Sort by quantity">Qty{sortIndicator("quantity")}</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Location</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Batch</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Expiry</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Status</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <Skeleton rows={5} cols={14} />
              ) : rows.length === 0 ? (
                <EmptyState title="No products found" message="Add your first product to start building inventory." actionLabel="Add Product" onAction={() => { setEditing(null); setVariantParent(null); setShowForm(true); }} />
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
                return (
                  <tr key={`${r.kind}-${p.id}`} className={`${r.kind === "variant" ? "bg-app/60 hover:bg-subtle" : "hover:bg-app"} cursor-pointer`} onClick={(e) => { const t = e.target as HTMLElement; if (t instanceof HTMLInputElement || t instanceof HTMLButtonElement || t.closest("button") || t.closest("input")) return; setViewing(p); }}>
                    <td className="px-4 py-3">
                      <input type="checkbox" className="rounded border-border-strong" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} aria-label={`Select ${p.display_name}`} />
                    </td>
                    <td className="px-4 py-3">
                      {p.image_url ? (
                        <img src={p.image_url} alt="" className="w-10 h-10 rounded object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded bg-subtle flex items-center justify-center text-xs text-faint">N/A</div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium">{p.sku}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {isGroup && (
                          <button
                            onClick={() => setCollapsed((prev) => { const next = new Set(prev); if (next.has(p.id)) next.delete(p.id); else next.add(p.id); return next; })}
                            className="p-0.5 text-faint hover:text-indigo-600 dark:text-indigo-400"
                            aria-label={isCollapsed ? "Expand variants" : "Collapse variants"}
                          >
                            {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                          </button>
                        )}
                        {r.kind === "variant" ? (
                          <span className="text-muted">{p.display_name}</span>
                        ) : (
                          <span className="font-medium">{p.name}</span>
                        )}
                        {isGroup && (
                          <span className="badge bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30">{p.variants.filter((v) => v.is_active).length} variants</span>
                        )}
                        {p.is_serialized && (
                          <span className="badge bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30">Serialized</span>
                        )}
                        {isLowStock && (
                          <AlertTriangle size={14} className="text-red-500" aria-label="Low stock" />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">{p.category_name}</td>
                    <td className="px-4 py-3 text-muted">{p.supplier_name || "—"}</td>
                    <td className="px-4 py-3">{formatCurrency(p.unit_price, currencySymbol)}</td>
                    <td className="px-4 py-3">{formatCurrency(p.cost_price, currencySymbol)}</td>
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
                    <td className="px-4 py-3 text-muted">{p.location}</td>
                    <td className="px-4 py-3 text-muted">{p.batch_number || "—"}</td>
                    <td className="px-4 py-3">{expiryBadge(p)}</td>
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
                          <button onClick={() => { setVariantParent(p); setEditing(null); setShowForm(true); }} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" title={`Add variant to ${p.name}`} aria-label={`Add variant to ${p.name}`}>
                            <PackagePlus size={16} />
                          </button>
                        )}
                        <button onClick={() => setViewing(p)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`View ${p.display_name}`}>
                          <Eye size={16} />
                        </button>
                        {!isGroup && !p.is_serialized && (
                          <button onClick={() => setAdjusting(p)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Adjust stock for ${p.display_name}`}>
                            <ClipboardList size={16} />
                          </button>
                        )}
                        {!isGroup && (
                          <button onClick={() => setMovementProduct(p)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`View movement history for ${p.display_name}`}>
                            <History size={16} />
                          </button>
                        )}
                        <button onClick={() => { setEditing(p); setVariantParent(null); setShowForm(true); }} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Edit ${p.display_name}`}>
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

      {viewing && <ProductDetail product={viewing} onClose={() => setViewing(null)} onAddVariant={(p) => { setViewing(null); setVariantParent(p); setEditing(null); setShowForm(true); }} />}

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

      <Modal open={!!movementProduct} onClose={() => setMovementProduct(null)} title={`Movements: ${movementProduct?.display_name || ""}`} wide>
        {movementsLoading && <p className="text-muted text-sm">Loading movements...</p>}
        {movementsError && <p className="text-red-600 dark:text-red-400 text-sm">Failed to load movements.</p>}
        {!movementsLoading && !movementsError && movements && movements.length === 0 && <p className="text-muted text-sm">No movements recorded for this product.</p>}
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
                  <td className="px-3 py-2"><span className={`badge ${movementBadgeClass(m.movement_type)}`}>{m.movement_type}</span></td>
                  <td className="px-3 py-2"><span className={m.quantity_change > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>{m.quantity_change > 0 ? "+" : ""}{m.quantity_change}</span></td>
                  <td className="px-3 py-2 text-muted">{m.reference}</td>
                  <td className="px-3 py-2 text-muted">{m.username}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>
    </div>
  );
}
