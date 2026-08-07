import { useDateFormat } from "../hooks/useDateFormat";
import Modal from "./Modal";
import { PackagePlus, PackageOpen, MapPin } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { Product, ProductTrace } from "../types";
import { formatCurrency } from "../utils/currency";
import { useSettings } from "../hooks/useSettings";
import { useProductStockLocations } from "../hooks/useProductStockLocations";
import { hasVariants } from "../utils/variants";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import ConfirmDialog from "./ConfirmDialog";
import MoveUnallocatedModal from "./MoveUnallocatedModal";

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
  deactivate: "Deactivated",
  activate: "Activated",
  in: "Stock in",
  out: "Stock out",
  return: "Returned",
  ship: "Shipped",
  scrap: "Scrapped",
};

export default function ProductDetail({ product, onClose, onAddVariant }: Props) {
  const formatDate = useDateFormat();
  const { data: settings } = useSettings();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { addToast } = useToast();
  const [showMoveUnallocated, setShowMoveUnallocated] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState(false);
  const [isActive, setIsActive] = useState(product.is_active);
  const currencySymbol = settings?.currency_symbol || "$";
  const totalQty = hasVariants(product) ? product.total_quantity : product.quantity;
  const qty = hasVariants(product) ? product.total_quantity : product.quantity;
  const { locations, unallocated } = useProductStockLocations(product.id, product.is_serialized);

  const toggleStatus = useMutation({
    mutationFn: () => api.put(`/products/${product.id}`, { is_active: !isActive }),
    onSuccess: () => {
      setIsActive((prev) => !prev);
      addToast("Product status updated", "success");
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["product-stock-locations", product.id, product.is_serialized] });
      queryClient.invalidateQueries({ queryKey: ["trace", product.id] });
    },
    onError: () => addToast("Failed to update product status", "error"),
  });

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
            <span className="text-muted">SKU:</span>
            <p className="font-medium">{product.sku}</p>
          </div>
          <div>
            <span className="text-muted">Barcode:</span>
            <p className="font-medium">{product.barcode || "—"}</p>
          </div>
          <div>
            <span className="text-muted">Category:</span>
            <p className="font-medium">{product.category_name || "—"}</p>
          </div>
          <div>
            <span className="text-muted">Supplier:</span>
            <p className="font-medium">{product.supplier_name || "—"}</p>
          </div>
          <div>
            <span className="text-muted">Unit Price:</span>
            <p className="font-medium">{formatCurrency(product.unit_price, currencySymbol)}</p>
          </div>
          <div>
            <span className="text-muted">Cost Price:</span>
            <p className="font-medium">{formatCurrency(product.cost_price, currencySymbol)}</p>
          </div>
          <div>
            <span className="text-muted">{hasVariants(product) ? "Total Quantity:" : "Quantity:"}</span>
            <p className={`font-medium ${qty <= product.reorder_level ? "text-red-600 dark:text-red-400" : ""}`}>{totalQty}</p>
          </div>
          <div>
            <span className="text-muted">Reorder Level:</span>
            <p className="font-medium">{product.reorder_level}</p>
          </div>
          <div>
            <span className="text-muted">Location:</span>
            <p className="font-medium">{product.location || "—"}</p>
          </div>
          <div>
            <span className="text-muted">Batch Number:</span>
            <p className="font-medium">{product.batch_number || "—"}</p>
          </div>
          <div>
            <span className="text-muted">Expiry Date:</span>
            <p className="font-medium">{product.expiry_date ? formatDate(product.expiry_date) : "—"}</p>
          </div>
          <div>
            <span className="text-muted">Status:</span>
            {can("products.update") ? (
              <button
                onClick={() => setConfirmStatus(true)}
                className={`badge cursor-pointer border ${isActive ? "badge-success" : "badge-danger"}`}
                title={isActive ? "Click to deactivate" : "Click to activate"}
                aria-label={`Toggle status for ${product.display_name}`}
              >
                {isActive ? "Active" : "Inactive"}
              </button>
            ) : (
              <span className={`badge ${isActive ? "badge-success" : "badge-danger"}`}>{isActive ? "Active" : "Inactive"}</span>
            )}
          </div>
          {product.is_serialized && (
            <div>
              <span className="text-muted">Tracking:</span>
              <p className="font-medium"><span className="badge bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30">Serialized</span></p>
            </div>
          )}
        </div>

        {(locations.length > 0 || unallocated > 0) && (
          <div>
            <span className="text-sm text-muted">
              {product.is_serialized ? "In-stock Serial Locations:" : "Stock Locations:"}
            </span>
            <div className="flex flex-wrap gap-2 mt-1">
              {locations.map((l) => (
                <button
                  key={l.location_id}
                  onClick={() => navigate(`/locations?location=${l.location_id}`)}
                  className="badge bg-subtle text-ink border border-border cursor-pointer hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 inline-flex items-center gap-1"
                  aria-label={`View location ${l.path}`}
                >
                  <MapPin size={12} />
                  {l.path} ({l.count})
                </button>
              ))}
              {unallocated > 0 && (
                <button
                  type="button"
                  onClick={() => setShowMoveUnallocated(true)}
                  className="badge bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30 inline-flex items-center gap-1 cursor-pointer hover:border-amber-400"
                  aria-label="Move unallocated stock"
                >
                  <PackageOpen size={12} />
                  Unallocated ({unallocated})
                </button>
              )}
            </div>
          </div>
        )}

        {!product.is_variant && onAddVariant && (
          <div>
            <button onClick={() => onAddVariant(product)} className="btn-secondary w-full inline-flex items-center justify-center gap-2">
              <PackagePlus size={16} /> Add Variant
            </button>
          </div>
        )}

        {product.is_variant && (
          <div>
            <span className="text-sm text-muted">Variant of:</span>
            <p className="text-sm font-medium mt-1">{product.variant_of_name || product.name}</p>
          </div>
        )}

        {product.is_variant && product.attributes && Object.keys(product.attributes).length > 0 && (
          <div>
            <span className="text-sm text-muted">Attributes:</span>
            <div className="flex flex-wrap gap-2 mt-1">
              {Object.entries(product.attributes).map(([k, v]) => (
                <span key={k} className="badge bg-subtle text-ink border border-border">{k}: {v}</span>
              ))}
            </div>
          </div>
        )}

        {hasVariants(product) && (
          <div>
            <span className="text-sm text-muted">Variants ({product.variants.length}):</span>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm border rounded-lg">
                <thead>
                  <tr className="bg-app text-left">
                    <th className="px-3 py-2 font-medium text-muted">SKU</th>
                    <th className="px-3 py-2 font-medium text-muted">Attributes</th>
                    <th className="px-3 py-2 font-medium text-muted">Price</th>
                    <th className="px-3 py-2 font-medium text-muted">Qty</th>
                    <th className="px-3 py-2 font-medium text-muted">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {product.variants.map((v) => (
                    <tr key={v.id}>
                      <td className="px-3 py-2 font-medium">{v.sku}</td>
                      <td className="px-3 py-2 text-muted">{v.variant_label || "—"}</td>
                      <td className="px-3 py-2">{formatCurrency(v.unit_price, currencySymbol)}</td>
                      <td className="px-3 py-2"><span className={v.quantity <= v.reorder_level ? "text-red-600 dark:text-red-400 font-medium" : ""}>{v.quantity}</span></td>
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
            <span className="text-sm text-muted">Description:</span>
            <p className="text-sm mt-1">{product.description}</p>
          </div>
        )}
      </div>

      {showMoveUnallocated && (
        <MoveUnallocatedModal
          productId={product.id}
          productName={product.display_name}
          available={unallocated}
          onClose={() => setShowMoveUnallocated(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["product-stock-locations", product.id, product.is_serialized] });
            queryClient.invalidateQueries({ queryKey: ["trace", product.id] });
          }}
        />
      )}

      <ConfirmDialog
        open={confirmStatus}
        title={isActive ? "Deactivate Product" : "Activate Product"}
        message={isActive
          ? `Deactivate "${product.display_name}"? Inactive products can no longer be sold.`
          : `Reactivate "${product.display_name}"? It will become available for sale again.`}
        confirmLabel={isActive ? "Deactivate" : "Activate"}
        confirmClass={isActive ? "btn-danger" : "btn-primary"}
        onConfirm={() => { toggleStatus.mutate(); setConfirmStatus(false); }}
        onCancel={() => setConfirmStatus(false)}
      />
    </Modal>
  );
}

function TraceSection({ product }: { product: Product }) {
  const formatDate = useDateFormat();
  const { data: trace, isLoading } = useQuery({
    queryKey: ["trace", product.id],
    queryFn: async () => {
      const { data } = await api.get(`/products/${product.id}/trace`);
      return data as ProductTrace;
    },
  });

  const movementRows = (m: ProductTrace["incoming"][number]) => (
    <tr key={m.id}>
      <td className="px-3 py-2">{formatDate(m.created_at)}</td>
      <td className="px-3 py-2"><span className="badge badge-info">{MOVEMENT_LABELS[m.movement_type] || m.movement_type}</span></td>
      <td className={`px-3 py-2 font-medium ${m.quantity_change > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
        {m.quantity_change > 0 ? "+" : ""}{m.quantity_change}
      </td>
      <td className="px-3 py-2 text-muted">{m.lot_number || "—"}</td>
      <td className="px-3 py-2 text-muted">{m.reference ? `${m.reference_type || ""} ${m.reference}`.trim() : "—"}</td>
      <td className="px-3 py-2 text-muted">{m.from_location_name ? `${m.from_location_name} → ` : ""}{m.to_location_name}</td>
      <td className="px-3 py-2 text-muted">{m.username}</td>
    </tr>
  );

  return (
    <div>
      <span className="text-sm text-muted">Traceability:</span>
      {isLoading ? (
        <div className="mt-2 text-sm text-faint">Loading trace...</div>
      ) : !trace || (trace.incoming.length === 0 && trace.outgoing.length === 0 && trace.work_orders.length === 0) ? (
        <p className="mt-2 text-sm text-muted">No movements or work orders recorded for this product yet.</p>
      ) : (
        <div className="mt-2 space-y-4">
          {trace.work_orders.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted mb-1">Work Orders</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border rounded-lg">
                  <thead>
                    <tr className="bg-app text-left">
                      <th className="px-3 py-2 font-medium text-muted">WO #</th>
                      <th className="px-3 py-2 font-medium text-muted">Role</th>
                      <th className="px-3 py-2 font-medium text-muted">Qty</th>
                      <th className="px-3 py-2 font-medium text-muted">Status</th>
                      <th className="px-3 py-2 font-medium text-muted">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
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
                        <td className="px-3 py-2 text-muted">{formatDate(w.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {trace.incoming.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted mb-1">Inbound Movements</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border rounded-lg">
                  <thead>
                    <tr className="bg-app text-left">
                      <th className="px-3 py-2 font-medium text-muted">Date</th>
                      <th className="px-3 py-2 font-medium text-muted">Type</th>
                      <th className="px-3 py-2 font-medium text-muted">Qty</th>
                      <th className="px-3 py-2 font-medium text-muted">Lot</th>
                      <th className="px-3 py-2 font-medium text-muted">Reference</th>
                      <th className="px-3 py-2 font-medium text-muted">Route</th>
                      <th className="px-3 py-2 font-medium text-muted">User</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {trace.incoming.map(movementRows)}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {trace.outgoing.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted mb-1">Outbound Movements</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border rounded-lg">
                  <thead>
                    <tr className="bg-app text-left">
                      <th className="px-3 py-2 font-medium text-muted">Date</th>
                      <th className="px-3 py-2 font-medium text-muted">Type</th>
                      <th className="px-3 py-2 font-medium text-muted">Qty</th>
                      <th className="px-3 py-2 font-medium text-muted">Lot</th>
                      <th className="px-3 py-2 font-medium text-muted">Reference</th>
                      <th className="px-3 py-2 font-medium text-muted">Route</th>
                      <th className="px-3 py-2 font-medium text-muted">User</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
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
