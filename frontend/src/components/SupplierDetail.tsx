import { useDateFormat } from "../hooks/useDateFormat";
import { useQuery } from "@tanstack/react-query";
import { Pencil, ClipboardList, Award, TrendingUp } from "lucide-react";
import SlideOver from "./SlideOver";
import Skeleton from "./Skeleton";
import EmptyState from "./EmptyState";
import AttachmentSection from "./AttachmentSection";
import api from "../api/client";
import type { Order, PaginatedResponse, Product, Supplier, SupplierPerformanceDetail, SupplierStats } from "../types";
import { formatCurrency } from "../utils/currency";
import { useSettings } from "../hooks/useSettings";
import { useAuth } from "../context/AuthContext";
import { entityImageUrl } from "../utils/images";
import { onImageError } from "../utils/placeholders";

interface Props {
  supplier: Supplier;
  onClose: () => void;
  onEdit?: () => void;
}

export default function SupplierDetail({ supplier, onClose, onEdit }: Props) {
  const formatDate = useDateFormat();
  const { can } = useAuth();
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";

  const { data: stats } = useQuery({
    queryKey: ["supplier-stats", supplier.id],
    queryFn: async () => (await api.get(`/suppliers/${supplier.id}/stats`)).data as SupplierStats,
  });

  const { data: orders, isLoading } = useQuery({
    queryKey: ["supplier-orders", supplier.id],
    queryFn: async () => {
      const { data } = await api.get("/orders", { params: { supplier_id: supplier.id, limit: 20 } });
      return data as PaginatedResponse<Order>;
    },
  });

  const { data: products, isLoading: productsLoading } = useQuery({
    queryKey: ["supplier-products", supplier.id],
    queryFn: async () => {
      const { data } = await api.get(`/suppliers/${supplier.id}/products`, { params: { limit: 20 } });
      return data as PaginatedResponse<Product>;
    },
  });

  const { data: performance } = useQuery({
    queryKey: ["supplier-performance", supplier.id],
    queryFn: async () =>
      (await api.get(`/suppliers/${supplier.id}/performance`)).data as SupplierPerformanceDetail,
  });

  const s = stats;
  const history = orders?.items || [];

  const productRows: { kind: "parent" | "variant"; product: Product }[] = [];
  for (const p of products?.items || []) {
    productRows.push({ kind: "parent", product: p });
    if (p.variants && p.variants.length > 0) {
      for (const v of p.variants) productRows.push({ kind: "variant", product: v });
    }
  }

  return (
    <SlideOver
      open
      onClose={onClose}
      title={supplier.name}
      wide
      ariaLabel={supplier.name}
      actions={onEdit && can("suppliers.update") ? (
        <button onClick={onEdit} className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1.5" aria-label="Edit supplier">
          <Pencil size={14} />Edit Supplier
        </button>
      ) : undefined}
    >
      <div className="space-y-5 text-sm">
        <div className="border border-border rounded-lg overflow-hidden bg-white dark:bg-app">
          <div className="border-b border-border px-5 py-4 flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              {supplier.image_url && (
                <img
                  src={entityImageUrl(supplier.image_url)}
                  alt=""
                  className="h-16 w-16 rounded-full object-cover border border-border bg-subtle shrink-0"
                  loading="lazy"
                  onError={onImageError}
                />
              )}
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-widest text-faint">Supplier</p>
                <h3 className="text-xl font-bold text-ink mt-1">{supplier.name}</h3>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4 px-5 py-4">
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Contact Person</p>
              <p className="font-medium text-ink break-words">{supplier.contact_person || "—"}</p>
            </div>
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Phone</p>
              <p className="font-medium text-ink break-words">{supplier.phone || "—"}</p>
            </div>
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Email</p>
              <p className="font-medium text-ink break-words">{supplier.email || "—"}</p>
            </div>
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Address</p>
              <p className="font-medium text-ink break-words">{supplier.address || "—"}</p>
            </div>
          </div>

          {supplier.notes && (
            <div className="px-5 pb-4">
              <p className="text-faint text-xs uppercase tracking-wide mb-1">Notes</p>
              <p className="text-muted">{supplier.notes}</p>
            </div>
          )}
        </div>

        <div>
          <h3 className="font-semibold text-ink mb-2">Statistics</h3>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
            <div className="bg-app rounded-lg p-4 min-w-0">
              <p className="text-muted text-xs">Orders</p>
              <p className="font-semibold text-xl mt-1 truncate" title={String(s?.total_orders ?? supplier.total_orders ?? 0)}>{s?.total_orders ?? supplier.total_orders ?? 0}</p>
            </div>
            <div className="bg-app rounded-lg p-4 min-w-0">
              <p className="text-muted text-xs">Total Spent</p>
              <p className="font-semibold text-xl mt-1 truncate" title={formatCurrency(s?.total_spent ?? supplier.total_spent ?? 0, currencySymbol)}>{formatCurrency(s?.total_spent ?? supplier.total_spent ?? 0, currencySymbol)}</p>
            </div>
            <div className="bg-app rounded-lg p-4 min-w-0">
              <p className="text-muted text-xs">Avg Order</p>
              <p className="font-semibold text-xl mt-1 truncate" title={formatCurrency(s?.avg_order_value ?? supplier.avg_order_value ?? 0, currencySymbol)}>{formatCurrency(s?.avg_order_value ?? supplier.avg_order_value ?? 0, currencySymbol)}</p>
            </div>
            <div className="bg-app rounded-lg p-4 min-w-0">
              <p className="text-muted text-xs">Products</p>
              <p className="font-semibold text-xl mt-1 truncate" title={String(s?.product_count ?? supplier.product_count ?? 0)}>{s?.product_count ?? supplier.product_count ?? 0}</p>
            </div>
          </div>
        </div>

        {performance && (performance.score !== null || performance.volume.total_orders > 0) && (
          <div>
            <h3 className="font-semibold text-ink mb-2 flex items-center gap-1.5"><Award size={15} />Performance</h3>
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
              <div className="bg-app rounded-lg p-4 min-w-0">
                <p className="text-muted text-xs">Score</p>
                <div className="mt-1 flex items-center gap-2">
                  <p className="font-semibold text-xl truncate">{performance.score ?? "—"}</p>
                  {performance.rating && <span className={`badge ${performance.rating === "excellent" ? "badge-success" : performance.rating === "good" ? "badge-info" : performance.rating === "fair" ? "badge-warning" : "badge-danger"}`}>{performance.rating}</span>}
                </div>
                <div className="h-1.5 w-full rounded-full bg-subtle overflow-hidden mt-2">
                  <div className={`h-full rounded-full ${performance.score === null ? "bg-faint" : performance.score >= 85 ? "bg-emerald-500" : performance.score >= 70 ? "bg-primary" : performance.score >= 50 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${performance.score ?? 0}%` }} aria-hidden />
                </div>
              </div>
              <div className="bg-app rounded-lg p-4 min-w-0">
                <p className="text-muted text-xs flex items-center gap-1"><TrendingUp size={12} />On-time</p>
                <p className="font-semibold text-xl mt-1 truncate">{performance.on_time.rate !== null ? `${performance.on_time.rate}%` : "—"}</p>
              </div>
              <div className="bg-app rounded-lg p-4 min-w-0">
                <p className="text-muted text-xs">Quality</p>
                <p className="font-semibold text-xl mt-1 truncate">{performance.quality.pass_rate !== null ? `${performance.quality.pass_rate}%` : "—"}</p>
              </div>
              <div className="bg-app rounded-lg p-4 min-w-0">
                <p className="text-muted text-xs">Lead adherence</p>
                <p className="font-semibold text-xl mt-1 truncate">{performance.lead_time.adherence !== null ? `${performance.lead_time.adherence}%` : "—"}</p>
              </div>
            </div>
          </div>
        )}

        <div>
          <h3 className="font-semibold text-ink mb-2">Purchase Order History</h3>
          {isLoading ? (
            <Skeleton variant="rows" rows={3} cols={4} />
          ) : history.length === 0 ? (
            <EmptyState
              compact
              icon={<ClipboardList size={20} />}
              title="No purchase orders yet"
              message="Purchase orders will appear here once this supplier receives orders."
            />
          ) : (
            <div className="overflow-x-auto border border-border rounded-lg">
              <table className="w-full text-sm min-w-max">
                <thead>
                  <tr className="bg-app text-left text-muted text-xs uppercase tracking-wide">
                    <th className="px-3 py-2.5 font-medium">Order #</th>
                    <th className="px-3 py-2.5 font-medium">Date</th>
                    <th className="px-3 py-2.5 text-right font-medium">Total</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {history.map((o) => (
                    <tr key={o.id}>
                      <td className="px-3 py-2.5 font-medium text-ink whitespace-nowrap">{o.order_number}</td>
                      <td className="px-3 py-2.5 text-muted whitespace-nowrap">{formatDate(o.created_at)}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">{formatCurrency(o.total_amount, currencySymbol)}</td>
                      <td className="px-3 py-2.5">
                        <span className={`badge ${o.status === "received" ? "badge-success" : o.status === "cancelled" ? "badge-warning" : "badge-info"}`}>
                          {o.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <h3 className="font-semibold text-ink mb-2">Products by Supplier</h3>
          {productsLoading ? (
            <Skeleton variant="rows" rows={3} cols={6} />
          ) : productRows.length === 0 ? (
            <EmptyState variant="block" title="No products assigned to this supplier" message="Products you source from this supplier will appear here." />
          ) : (
            <div className="overflow-x-auto border border-border rounded-lg">
              <table className="w-full text-sm min-w-max">
                <thead>
                  <tr className="bg-app text-left text-muted text-xs uppercase tracking-wide">
                    <th className="px-3 py-2.5 font-medium">Product</th>
                    <th className="px-3 py-2.5 font-medium">SKU</th>
                    <th className="px-3 py-2.5 font-medium">Category</th>
                    <th className="px-3 py-2.5 text-right font-medium">Qty</th>
                    <th className="px-3 py-2.5 text-right font-medium">Price</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {productRows.map((r) => {
                    const p = r.product;
                    const qty = r.kind === "parent" && p.variants.length > 0 ? p.total_quantity : p.quantity;
                    return (
                      <tr key={`${r.kind}-${p.id}`} className={r.kind === "variant" ? "bg-app/60" : ""}>
                        <td className="px-3 py-2.5 font-medium">
                          {r.kind === "variant" ? (
                            <span className="text-muted font-normal">— {p.display_name}</span>
                          ) : (
                            <span className="text-ink">{p.name}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-muted whitespace-nowrap">{p.sku}</td>
                        <td className="px-3 py-2.5 text-muted">{p.category_name || "—"}</td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">{qty}</td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">{formatCurrency(p.unit_price, currencySymbol)}</td>
                        <td className="px-3 py-2.5">
                          <span className={`badge ${p.is_active ? "badge-success" : "badge-danger"}`}>{p.is_active ? "Active" : "Inactive"}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <AttachmentSection entityType="supplier" entityId={supplier.id} canEdit={can("suppliers.update")} />
      </div>
    </SlideOver>
  );
}
