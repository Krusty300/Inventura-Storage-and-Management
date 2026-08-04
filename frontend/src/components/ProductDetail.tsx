import Modal from "./Modal";
import { PackagePlus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import type { Product, ProductTrace } from "../types";
import { parseLocalDate } from "../utils/date";
import { formatCurrency } from "../utils/currency";
import { useSettings } from "../hooks/useSettings";
import { hasVariants } from "../utils/variants";

interface Props {
  product: Product;
  onClose: () => void;
  onAddVariant?: (product: Product) => void;
}

const MOVEMENT_LABELS: Record<string, string> = {
  receive: "Received",
  issue: "Issued to WIP",
  backflush: "Backflushed",
  sale: "Sold",
  sale_return: "Sale return",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  adjustment: "Adjusted",
  count: "Cycle count",
};

export default function ProductDetail({ product, onClose, onAddVariant }: Props) {
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  const totalQty = hasVariants(product) ? product.total_quantity : product.quantity;
  const qty = hasVariants(product) ? product.total_quantity : product.quantity;

  return (
    <Modal open onClose={onClose} title={product.display_name} wide>
      <div className="space-y-4">
        {product.image_url && (
          <div className="flex justify-center">
            <img src={product.image_url} alt={product.display_name} className="w-48 h-48 rounded-lg object-cover border" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">SKU:</span>
            <p className="font-medium">{product.sku}</p>
          </div>
          <div>
            <span className="text-gray-500">Barcode:</span>
            <p className="font-medium">{product.barcode || "—"}</p>
          </div>
          <div>
            <span className="text-gray-500">Category:</span>
            <p className="font-medium">{product.category_name || "—"}</p>
          </div>
          <div>
            <span className="text-gray-500">Supplier:</span>
            <p className="font-medium">{product.supplier_name || "—"}</p>
          </div>
          <div>
            <span className="text-gray-500">Unit Price:</span>
            <p className="font-medium">{formatCurrency(product.unit_price, currencySymbol)}</p>
          </div>
          <div>
            <span className="text-gray-500">Cost Price:</span>
            <p className="font-medium">{formatCurrency(product.cost_price, currencySymbol)}</p>
          </div>
          <div>
            <span className="text-gray-500">{hasVariants(product) ? "Total Quantity:" : "Quantity:"}</span>
            <p className={`font-medium ${qty <= product.reorder_level ? "text-red-600" : ""}`}>{totalQty}</p>
          </div>
          <div>
            <span className="text-gray-500">Reorder Level:</span>
            <p className="font-medium">{product.reorder_level}</p>
          </div>
          <div>
            <span className="text-gray-500">Location:</span>
            <p className="font-medium">{product.location || "—"}</p>
          </div>
          <div>
            <span className="text-gray-500">Batch Number:</span>
            <p className="font-medium">{product.batch_number || "—"}</p>
          </div>
          <div>
            <span className="text-gray-500">Expiry Date:</span>
            <p className="font-medium">{product.expiry_date ? parseLocalDate(product.expiry_date).toLocaleDateString() : "—"}</p>
          </div>
          <div>
            <span className="text-gray-500">Status:</span>
            <p className="font-medium">{product.is_active ? "Active" : "Inactive"}</p>
          </div>
          {product.is_serialized && (
            <div>
              <span className="text-gray-500">Tracking:</span>
              <p className="font-medium"><span className="badge bg-indigo-50 text-indigo-700 border border-indigo-200">Serialized</span></p>
            </div>
          )}
        </div>

        {!product.is_variant && onAddVariant && (
          <div>
            <button onClick={() => onAddVariant(product)} className="btn-secondary w-full inline-flex items-center justify-center gap-2">
              <PackagePlus size={16} /> Add Variant
            </button>
          </div>
        )}

        {product.is_variant && (
          <div>
            <span className="text-sm text-gray-500">Variant of:</span>
            <p className="text-sm font-medium mt-1">{product.name}</p>
          </div>
        )}

        {product.is_variant && product.attributes && Object.keys(product.attributes).length > 0 && (
          <div>
            <span className="text-sm text-gray-500">Attributes:</span>
            <div className="flex flex-wrap gap-2 mt-1">
              {Object.entries(product.attributes).map(([k, v]) => (
                <span key={k} className="badge bg-gray-100 text-gray-700 border border-gray-200">{k}: {v}</span>
              ))}
            </div>
          </div>
        )}

        {hasVariants(product) && (
          <div>
            <span className="text-sm text-gray-500">Variants ({product.variants.length}):</span>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm border rounded-lg">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-3 py-2 font-medium text-gray-600">SKU</th>
                    <th className="px-3 py-2 font-medium text-gray-600">Attributes</th>
                    <th className="px-3 py-2 font-medium text-gray-600">Price</th>
                    <th className="px-3 py-2 font-medium text-gray-600">Qty</th>
                    <th className="px-3 py-2 font-medium text-gray-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {product.variants.map((v) => (
                    <tr key={v.id}>
                      <td className="px-3 py-2 font-medium">{v.sku}</td>
                      <td className="px-3 py-2 text-gray-600">{v.variant_label || "—"}</td>
                      <td className="px-3 py-2">{formatCurrency(v.unit_price, currencySymbol)}</td>
                      <td className="px-3 py-2"><span className={v.quantity <= v.reorder_level ? "text-red-600 font-medium" : ""}>{v.quantity}</span></td>
                      <td className="px-3 py-2"><span className={`badge ${v.is_active ? "badge-success" : "badge-danger"}`}>{v.is_active ? "Active" : "Inactive"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <TraceSection product={product} />

        {product.description && (
          <div>
            <span className="text-sm text-gray-500">Description:</span>
            <p className="text-sm mt-1">{product.description}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function TraceSection({ product }: { product: Product }) {
  const { data: trace, isLoading } = useQuery({
    queryKey: ["trace", product.id],
    queryFn: async () => {
      const { data } = await api.get(`/products/${product.id}/trace`);
      return data as ProductTrace;
    },
    enabled: !product.is_variant,
  });

  if (product.is_variant) return null;

  const movementRows = (m: ProductTrace["incoming"][number]) => (
    <tr key={m.id}>
      <td className="px-3 py-2">{new Date(m.created_at).toLocaleDateString()}</td>
      <td className="px-3 py-2"><span className="badge badge-info">{MOVEMENT_LABELS[m.movement_type] || m.movement_type}</span></td>
      <td className={`px-3 py-2 font-medium ${m.quantity_change > 0 ? "text-green-600" : "text-red-600"}`}>
        {m.quantity_change > 0 ? "+" : ""}{m.quantity_change}
      </td>
      <td className="px-3 py-2 text-gray-500">{m.lot_number || "—"}</td>
      <td className="px-3 py-2 text-gray-500">{m.reference ? `${m.reference_type || ""} ${m.reference}`.trim() : "—"}</td>
      <td className="px-3 py-2 text-gray-500">{m.from_location_name ? `${m.from_location_name} → ` : ""}{m.to_location_name}</td>
      <td className="px-3 py-2 text-gray-500">{m.username}</td>
    </tr>
  );

  return (
    <div>
      <span className="text-sm text-gray-500">Traceability:</span>
      {isLoading ? (
        <div className="mt-2 text-sm text-gray-400">Loading trace...</div>
      ) : !trace || (trace.incoming.length === 0 && trace.outgoing.length === 0 && trace.work_orders.length === 0) ? (
        <p className="mt-2 text-sm text-gray-500">No movements or work orders recorded for this product yet.</p>
      ) : (
        <div className="mt-2 space-y-4">
          {trace.work_orders.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Work Orders</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border rounded-lg">
                  <thead>
                    <tr className="bg-gray-50 text-left">
                      <th className="px-3 py-2 font-medium text-gray-600">WO #</th>
                      <th className="px-3 py-2 font-medium text-gray-600">Role</th>
                      <th className="px-3 py-2 font-medium text-gray-600">Qty</th>
                      <th className="px-3 py-2 font-medium text-gray-600">Status</th>
                      <th className="px-3 py-2 font-medium text-gray-600">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {trace.work_orders.map((w) => (
                      <tr key={w.wo_number}>
                        <td className="px-3 py-2 font-medium">{w.wo_number}</td>
                        <td className="px-3 py-2">
                          <span className={`badge ${w.role === "produced" ? "badge-success" : "badge-info"}`}>
                            {w.role === "produced" ? "Produced" : "Consumed"}
                          </span>
                        </td>
                        <td className="px-3 py-2">{w.quantity}</td>
                        <td className="px-3 py-2 capitalize">{w.status}</td>
                        <td className="px-3 py-2 text-gray-500">{new Date(w.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {trace.incoming.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Inbound Movements</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border rounded-lg">
                  <thead>
                    <tr className="bg-gray-50 text-left">
                      <th className="px-3 py-2 font-medium text-gray-600">Date</th>
                      <th className="px-3 py-2 font-medium text-gray-600">Type</th>
                      <th className="px-3 py-2 font-medium text-gray-600">Qty</th>
                      <th className="px-3 py-2 font-medium text-gray-600">Lot</th>
                      <th className="px-3 py-2 font-medium text-gray-600">Reference</th>
                      <th className="px-3 py-2 font-medium text-gray-600">Route</th>
                      <th className="px-3 py-2 font-medium text-gray-600">User</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {trace.incoming.map(movementRows)}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {trace.outgoing.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Outbound Movements</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border rounded-lg">
                  <thead>
                    <tr className="bg-gray-50 text-left">
                      <th className="px-3 py-2 font-medium text-gray-600">Date</th>
                      <th className="px-3 py-2 font-medium text-gray-600">Type</th>
                      <th className="px-3 py-2 font-medium text-gray-600">Qty</th>
                      <th className="px-3 py-2 font-medium text-gray-600">Lot</th>
                      <th className="px-3 py-2 font-medium text-gray-600">Reference</th>
                      <th className="px-3 py-2 font-medium text-gray-600">Route</th>
                      <th className="px-3 py-2 font-medium text-gray-600">User</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {trace.outgoing.map(movementRows)}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
