import { useDateFormat } from "../hooks/useDateFormat";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import SlideOver from "./SlideOver";
import ProductDetail from "./ProductDetail";
import SupplierDetail from "./SupplierDetail";
import api from "../api/client";
import type { Category, PaginatedResponse, Product, Supplier } from "../types";
import { formatCurrency } from "../utils/currency";
import { useSettings } from "../hooks/useSettings";
import Skeleton from "./Skeleton";

interface Props {
  category: Category;
  onClose: () => void;
}

export default function CategoryDetail({ category, onClose }: Props) {
  const formatDate = useDateFormat();
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  const [viewingProduct, setViewingProduct] = useState<Product | null>(null);
  const [viewingSupplier, setViewingSupplier] = useState<Supplier | null>(null);

  const { data: products, isLoading: productsLoading } = useQuery({
    queryKey: ["category-products", category.id],
    queryFn: async () => {
      const { data } = await api.get("/products", { params: { category_id: category.id, limit: 100, include_variants: 1 } });
      return data as PaginatedResponse<Product>;
    },
  });

  const { data: suppliers, isLoading: suppliersLoading } = useQuery({
    queryKey: ["category-suppliers", category.id],
    queryFn: async () => {
      const { data } = await api.get("/suppliers", { params: { category_id: category.id, limit: 100, include_inactive: true } });
      return data as PaginatedResponse<Supplier>;
    },
  });

  const productRows: { kind: "parent" | "variant"; product: Product }[] = [];
  for (const p of products?.items || []) {
    productRows.push({ kind: "parent", product: p });
    if (p.variants && p.variants.length > 0) {
      for (const v of p.variants) productRows.push({ kind: "variant", product: v });
    }
  }

  const supplierItems = suppliers?.items || [];

  return (
    <SlideOver open onClose={onClose} title={category.name} wide ariaLabel={category.name}>
      <div className="space-y-5 text-sm">
        <div className="border border-border rounded-lg overflow-hidden bg-white dark:bg-app">
          <div className="px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-faint">Category</p>
            <h3 className="text-xl font-bold text-ink mt-1">{category.name}</h3>
          </div>
          <div className="grid grid-cols-1 gap-x-5 gap-y-4 px-5 pb-4 sm:grid-cols-2">
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Description</p>
              <p className="font-medium text-ink break-words">{category.description || "—"}</p>
            </div>
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Created</p>
              <p className="font-medium text-ink">{formatDate(category.created_at)}</p>
            </div>
          </div>
        </div>

        <div>
          <h3 className="font-semibold text-ink mb-2">Products</h3>
          {productsLoading ? (
            <Skeleton variant="rows" rows={3} cols={4} />
          ) : productRows.length === 0 ? (
            <p className="text-faint py-4 text-center">No products in this category.</p>
          ) : (
            <div className="overflow-x-auto border border-border rounded-lg">
              <table className="w-full text-sm min-w-[500px]" aria-label="Products in this category">
                <thead>
                  <tr className="bg-app text-left text-muted text-xs uppercase tracking-wide">
                    <th className="px-3 py-2.5 font-medium">Product</th>
                    <th className="px-3 py-2.5 font-medium">SKU</th>
                    <th className="px-3 py-2.5 text-right font-medium">Price</th>
                    <th className="px-3 py-2.5 text-right font-medium">Qty</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {productRows.map((r) => {
                    const p = r.product;
                    const qty = r.kind === "parent" && (p.variants?.length ?? 0) > 0 ? p.total_quantity : p.quantity;
                    return (
                      <tr key={`${r.kind}-${p.id}`} className={r.kind === "variant" ? "bg-app/60" : ""}>
                        <td className="px-3 py-2.5 font-medium">
                          <div className="truncate max-w-[180px]" title={r.kind === "variant" ? p.display_name : p.name}>
                            {r.kind === "variant" ? (
                              <span className="text-muted font-normal">— {p.display_name}</span>
                            ) : (
                              <span className="text-ink">{p.name}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-muted whitespace-nowrap">
                          <div className="truncate max-w-[120px]" title={p.sku}>{p.sku}</div>
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">{formatCurrency(p.unit_price, currencySymbol)}</td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">{(qty ?? 0).toLocaleString()}</td>
                        <td className="px-3 py-2.5">
                          <span className={`badge ${p.is_active ? "badge-success" : "badge-danger"}`}>{p.is_active ? "Active" : "Inactive"}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <button onClick={() => setViewingProduct(p)} className="p-1 rounded text-primary dark:text-primary hover:underline" aria-label={`View product ${p.display_name}`}>
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <h3 className="font-semibold text-ink mb-2">Suppliers</h3>
          {suppliersLoading ? (
            <Skeleton variant="rows" rows={3} cols={4} />
          ) : supplierItems.length === 0 ? (
            <p className="text-faint py-4 text-center">No suppliers supply products in this category.</p>
          ) : (
            <div className="overflow-x-auto border border-border rounded-lg">
              <table className="w-full text-sm min-w-[400px]" aria-label="Suppliers for this category">
                <thead>
                  <tr className="bg-app text-left text-muted text-xs uppercase tracking-wide">
                    <th className="px-3 py-2.5 font-medium">Name</th>
                    <th className="px-3 py-2.5 font-medium">Contact</th>
                    <th className="px-3 py-2.5 font-medium hidden sm:table-cell">Email</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {supplierItems.map((s) => (
                    <tr key={s.id}>
                      <td className="px-3 py-2.5 font-medium">
                        <div className="truncate max-w-[160px]" title={s.name}>{s.name}</div>
                      </td>
                      <td className="px-3 py-2.5 text-muted whitespace-nowrap">
                        <div className="truncate max-w-[120px]">{s.contact_person || "—"}</div>
                      </td>
                      <td className="px-3 py-2.5 text-muted whitespace-nowrap hidden sm:table-cell">
                        <div className="truncate max-w-[200px]">{s.email || "—"}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`badge ${s.is_active === false ? "badge-warning" : "badge-success"}`}>{s.is_active === false ? "Deactivated" : "Active"}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <button onClick={() => setViewingSupplier(s)} className="p-1 rounded text-primary dark:text-primary hover:underline" aria-label={`View supplier ${s.name}`}>
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {viewingProduct && (
        <ProductDetail product={viewingProduct} onClose={() => setViewingProduct(null)} />
      )}
      {viewingSupplier && (
        <SupplierDetail supplier={viewingSupplier} onClose={() => setViewingSupplier(null)} />
      )}
    </SlideOver>
  );
}
