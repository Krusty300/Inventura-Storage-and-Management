import { useDateFormat } from "../hooks/useDateFormat";
import { useQuery } from "@tanstack/react-query";
import SlideOver from "./SlideOver";
import Skeleton from "./Skeleton";
import AttachmentSection from "./AttachmentSection";
import api from "../api/client";
import type { Order, PaginatedResponse, Product, Supplier, SupplierStats } from "../types";
import { formatCurrency } from "../utils/currency";
import { useSettings } from "../hooks/useSettings";
import { useAuth } from "../context/AuthContext";

interface Props {
  supplier: Supplier;
  onClose: () => void;
}

export default function SupplierDetail({ supplier, onClose }: Props) {
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
    <SlideOver open onClose={onClose} title={supplier.name} wide ariaLabel={supplier.name}>
      <div className="space-y-5 text-sm">
        <div className="border border-border rounded-lg overflow-hidden bg-white dark:bg-app">
          <div className="border-b border-border px-5 py-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-faint">Supplier</p>
              <h3 className="text-xl font-bold text-ink mt-1">{supplier.name}</h3>
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-app rounded-lg p-4">
              <p className="text-muted text-xs">Orders</p>
              <p className="font-semibold text-xl mt-1">{s?.total_orders ?? supplier.total_orders ?? 0}</p>
            </div>
            <div className="bg-app rounded-lg p-4">
              <p className="text-muted text-xs">Total Spent</p>
              <p className="font-semibold text-xl mt-1">{formatCurrency(s?.total_spent ?? supplier.total_spent ?? 0, currencySymbol)}</p>
            </div>
            <div className="bg-app rounded-lg p-4">
              <p className="text-muted text-xs">Avg Order</p>
              <p className="font-semibold text-xl mt-1">{formatCurrency(s?.avg_order_value ?? supplier.avg_order_value ?? 0, currencySymbol)}</p>
            </div>
            <div className="bg-app rounded-lg p-4">
              <p className="text-muted text-xs">Products</p>
              <p className="font-semibold text-xl mt-1">{s?.product_count ?? supplier.product_count ?? 0}</p>
            </div>
          </div>
        </div>

        <div>
          <h3 className="font-semibold text-ink mb-2">Purchase Order History</h3>
          {isLoading ? (
            <Skeleton variant="rows" rows={3} cols={4} />
          ) : history.length === 0 ? (
            <p className="text-faint">No purchase orders yet.</p>
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
            <p className="text-faint">No products assigned to this supplier.</p>
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
