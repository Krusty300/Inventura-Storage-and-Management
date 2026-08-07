import { useDateFormat } from "../hooks/useDateFormat";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Modal from "./Modal";
import ProductDetail from "./ProductDetail";
import SupplierDetail from "./SupplierDetail";
import api from "../api/client";
import type { Category, PaginatedResponse, Product, Supplier } from "../types";
import { formatCurrency } from "../utils/currency";

interface Props {
  category: Category;
  onClose: () => void;
}

export default function CategoryDetail({ category, onClose }: Props) {
  const formatDate = useDateFormat();
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
    <Modal open onClose={onClose} title={category.name} wide>
      <div className="space-y-5 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-muted">Description:</span>
            <p className="font-medium mt-1">{category.description || "—"}</p>
          </div>
          <div>
            <span className="text-muted">Created:</span>
            <p className="font-medium mt-1">{formatDate(category.created_at)}</p>
          </div>
        </div>

        <div>
          <h3 className="font-semibold text-ink mb-2">Products</h3>
          {productsLoading ? (
            <p className="text-faint">Loading...</p>
          ) : productRows.length === 0 ? (
            <p className="text-faint">No products in this category.</p>
          ) : (
            <div className="overflow-x-auto border border-border rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-app text-left text-muted">
                    <th className="px-3 py-2 font-medium">Product</th>
                    <th className="px-3 py-2 font-medium">SKU</th>
                    <th className="px-3 py-2 font-medium">Price</th>
                    <th className="px-3 py-2 font-medium">Qty</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {productRows.map((r) => {
                    const p = r.product;
                    const qty = r.kind === "parent" && p.variants.length > 0 ? p.total_quantity : p.quantity;
                    return (
                      <tr key={`${r.kind}-${p.id}`} className={r.kind === "variant" ? "bg-app/60" : ""}>
                        <td className="px-3 py-2 font-medium">
                          {r.kind === "variant" ? (
                            <span className="text-muted font-normal">— {p.display_name}</span>
                          ) : (
                            <span>{p.name}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted">{p.sku}</td>
                        <td className="px-3 py-2">{formatCurrency(p.unit_price)}</td>
                        <td className="px-3 py-2">{qty}</td>
                        <td className="px-3 py-2">
                          <span className={`badge ${p.is_active ? "badge-success" : "badge-danger"}`}>{p.is_active ? "Active" : "Inactive"}</span>
                        </td>
                        <td className="px-3 py-2">
                          <button onClick={() => setViewingProduct(p)} className="text-indigo-600 dark:text-indigo-400 hover:underline" aria-label={`View product ${p.display_name}`}>
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
            <p className="text-faint">Loading...</p>
          ) : supplierItems.length === 0 ? (
            <p className="text-faint">No suppliers supply products in this category.</p>
          ) : (
            <div className="overflow-x-auto border border-border rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-app text-left text-muted">
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Contact</th>
                    <th className="px-3 py-2 font-medium">Email</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {supplierItems.map((s) => (
                    <tr key={s.id}>
                      <td className="px-3 py-2 font-medium">{s.name}</td>
                      <td className="px-3 py-2 text-muted">{s.contact_person || "—"}</td>
                      <td className="px-3 py-2 text-muted">{s.email || "—"}</td>
                      <td className="px-3 py-2">
                        <span className={`badge ${s.is_active === false ? "badge-warning" : "badge-success"}`}>{s.is_active === false ? "Deactivated" : "Active"}</span>
                      </td>
                      <td className="px-3 py-2">
                        <button onClick={() => setViewingSupplier(s)} className="text-indigo-600 dark:text-indigo-400 hover:underline" aria-label={`View supplier ${s.name}`}>
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
    </Modal>
  );
}
