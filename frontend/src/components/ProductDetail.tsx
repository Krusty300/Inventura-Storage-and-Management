import { useDateFormat } from "../hooks/useDateFormat";
import SlideOver from "./SlideOver";
import { PackagePlus, PackageOpen, MapPin, ShieldAlert, Pencil, Fingerprint } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { Lot, Product, ProductTrace, SerialNumber } from "../types";
import { formatCurrency } from "../utils/currency";
import { useSettings } from "../hooks/useSettings";
import { useProductStockLocations } from "../hooks/useProductStockLocations";
import { hasVariants } from "../utils/variants";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import ConfirmDialog from "./ConfirmDialog";
import MoveUnallocatedModal from "./MoveUnallocatedModal";
import MoveQuarantinedModal from "./MoveQuarantinedModal";
import ImageCarousel from "./ImageCarousel";
import Skeleton from "./Skeleton";
import AttachmentSection from "./AttachmentSection";
import { errorMessage } from "../utils/errors";
import { movementLabel } from "../utils/movementTypes";

interface Props {
  product: Product;
  onClose: () => void;
  onAddVariant?: (product: Product) => void;
  onEdit?: () => void;
}

const sectionLabel = "text-xs font-semibold uppercase tracking-widest text-faint";

export default function ProductDetail({ product, onClose, onAddVariant, onEdit }: Props) {
  const formatDate = useDateFormat();
  const { data: settings } = useSettings();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { addToast } = useToast();
  const [showMoveUnallocated, setShowMoveUnallocated] = useState(false);
  const [moveQuarantinedLot, setMoveQuarantinedLot] = useState<Lot | null>(null);
  const [moveQuarantinedSerialized, setMoveQuarantinedSerialized] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState(false);
  const [isActive, setIsActive] = useState(product.is_active);
  const currencySymbol = settings?.currency_symbol || "$";
  const { locations, unallocated } = useProductStockLocations(product.id, product.is_serialized);

  const { data: liveProduct } = useQuery({
    queryKey: ["product", product.id],
    queryFn: async () => {
      const { data } = await api.get(`/products/${product.id}`);
      return data as Product;
    },
    initialData: product,
  });
  const active = liveProduct || product;
  const qty = hasVariants(active) ? active.total_quantity : active.quantity;
  const expiredLotQty = active.expired_lot_qty || 0;
  const quarantinedQty = active.quarantined_qty || 0;
  const reservedQty = active.reserved_qty || 0;

  const quarantinedLotsIds = hasVariants(product)
    ? [product.id, ...product.variants.filter((v) => v.is_active).map((v) => v.id)]
    : [product.id];
  const { data: quarantinedLotsData } = useQuery({
    queryKey: ["product-quarantined-lots", product.id],
    queryFn: async () => {
      const results = await Promise.all(
        quarantinedLotsIds.map((pid) =>
          api.get("/lots", { params: { product_id: pid, status: "quarantined", limit: 50 } })
        )
      );
      return results.flatMap((r) => (r.data?.items || []) as Lot[]);
    },
    enabled: !product.is_serialized,
  });
  const quarantinedLots = (quarantinedLotsData || []).filter((l) => l.status === "quarantined");

  const { data: quarantinedSerialsData } = useQuery({
    queryKey: ["product-quarantined-serials", product.id],
    queryFn: async () => {
      const { data } = await api.get("/serial-numbers", { params: { product_id: product.id, status: "quarantined", limit: 100 } });
      return (data?.items || []) as SerialNumber[];
    },
    enabled: product.is_serialized,
  });
  const quarantinedSerials = (quarantinedSerialsData || []).filter((s) => s.status === "quarantined");

  const { data: reservedSerialsData } = useQuery({
    queryKey: ["product-reserved-serials", product.id],
    queryFn: async () => {
      const { data } = await api.get("/serial-numbers", { params: { product_id: product.id, status: "reserved", limit: 100 } });
      return (data?.items || []) as SerialNumber[];
    },
    enabled: product.is_serialized,
  });
  const reservedSerials = (reservedSerialsData || []).filter((s) => s.status === "reserved");

  const statusBadges = (
    <>
      {reservedQty > 0 && (
        <span className="badge badge-info" title={`${reservedQty} unit(s) reserved for work orders`}>
          Reserved {reservedQty}
        </span>
      )}
      {quarantinedQty > 0 && (
        <span className="badge badge-warning" title={`${quarantinedQty} unit(s) in quarantined lots`}>
          Quarantined {quarantinedQty}
        </span>
      )}
      {expiredLotQty > 0 && (
        <span className="badge badge-danger" title={`${expiredLotQty} unit(s) in expired lots`}>
          Expired {expiredLotQty}
        </span>
      )}
    </>
  );

  const releaseLot = useMutation({
    mutationFn: (id: number) => api.put(`/lots/${id}`, { status: "in_stock" }),
    onSuccess: () => {
      addToast("Lot released", "success");
      queryClient.invalidateQueries({ queryKey: ["product", product.id] });
      queryClient.invalidateQueries({ queryKey: ["product-quarantined-lots"] });
      queryClient.invalidateQueries({ queryKey: ["product-stock-locations"] });
      queryClient.invalidateQueries({ queryKey: ["lots"] });
      queryClient.invalidateQueries({ queryKey: ["exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot release lot"), "error"),
  });

  const releaseSerial = useMutation({
    mutationFn: (id: number) => api.put(`/serial-numbers/${id}/status`, { status: "in_stock" }),
    onSuccess: () => {
      addToast("Serial released", "success");
      queryClient.invalidateQueries({ queryKey: ["product", product.id] });
      queryClient.invalidateQueries({ queryKey: ["product-quarantined-serials"] });
      queryClient.invalidateQueries({ queryKey: ["product-quarantined-lots"] });
      queryClient.invalidateQueries({ queryKey: ["product-stock-locations"] });
      queryClient.invalidateQueries({ queryKey: ["lots"] });
      queryClient.invalidateQueries({ queryKey: ["serial-numbers"] });
      queryClient.invalidateQueries({ queryKey: ["exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot release serial"), "error"),
  });

  const releaseReservedSerial = useMutation({
    mutationFn: (id: number) => api.post(`/serial-numbers/${id}/release`),
    onSuccess: () => {
      addToast("Serial released from work order", "success");
      queryClient.invalidateQueries({ queryKey: ["product", product.id] });
      queryClient.invalidateQueries({ queryKey: ["product-reserved-serials"] });
      queryClient.invalidateQueries({ queryKey: ["product-stock-locations"] });
      queryClient.invalidateQueries({ queryKey: ["lots"] });
      queryClient.invalidateQueries({ queryKey: ["serial-numbers"] });
      queryClient.invalidateQueries({ queryKey: ["exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot release serial"), "error"),
  });

  const toggleStatus = useMutation({
    mutationFn: () => api.put(`/products/${product.id}`, { is_active: !isActive }),
    onSuccess: () => {
      setIsActive((prev) => !prev);
      addToast("Product status updated", "success");
      queryClient.invalidateQueries({ queryKey: ["product", product.id] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["product-stock-locations", product.id, product.is_serialized] });
      queryClient.invalidateQueries({ queryKey: ["trace", product.id] });
    },
    onError: () => addToast("Failed to update product status", "error"),
  });

  return (
    <SlideOver
      open
      onClose={onClose}
      wide
      ariaLabel={product.display_name}
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          {product.display_name}
          {statusBadges}
        </span>
      }
      actions={onEdit && can("products.update") ? (
        <button onClick={onEdit} className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1.5" aria-label="Edit product"><Pencil size={14} />Edit Product</button>
      ) : undefined}
    >
      <div className="space-y-4">
        <ImageCarousel images={product.images || []} imageUrl={product.image_url} alt={product.display_name} />

        <div className="border border-border rounded-lg overflow-hidden bg-white dark:bg-app">
          <div className="border-b border-border px-6 py-5">
            <p className={sectionLabel}>Product Details</p>
            <h3 className="text-xl font-bold text-ink mt-1 tracking-tight">{product.display_name}</h3>
            <p className="text-sm text-muted mt-0.5">{product.sku}</p>
          </div>

          <div className="grid sm:grid-cols-3 gap-x-6 gap-y-3 px-6 py-5 border-b border-dashed border-border text-sm">
            <div>
              <p className={sectionLabel}>Barcode</p>
              <p className="font-medium mt-1">{product.barcode || "—"}</p>
            </div>
            <div>
              <p className={sectionLabel}>Category</p>
              <p className="font-medium mt-1">{product.category_name || "—"}</p>
            </div>
            <div>
              <p className={sectionLabel}>Supplier</p>
              <p className="font-medium mt-1">{product.supplier_name || "—"}</p>
            </div>
            <div>
              <p className={sectionLabel}>Unit Price</p>
              <p className="font-medium mt-1">{formatCurrency(product.unit_price, currencySymbol)}</p>
            </div>
            <div>
              <p className={sectionLabel}>Cost Price</p>
              <p className="font-medium mt-1">{formatCurrency(product.cost_price, currencySymbol)}</p>
            </div>
            <div>
              <p className={sectionLabel}>{hasVariants(product) ? "Total Quantity:" : "Quantity:"}</p>
              <p className={`font-medium mt-1 ${qty <= product.reorder_level ? "text-red-600 dark:text-red-400" : ""}`}>{qty}</p>
            </div>
            <div>
              <p className={sectionLabel}>Sellable:</p>
              <p className="font-medium mt-1" title={`Available to allocate from ${qty} total on hand`}>{active.sellable_qty || 0}</p>
            </div>
            <div>
              <p className={sectionLabel}>Reorder Level</p>
              <p className="font-medium mt-1">{product.reorder_level}</p>
            </div>
            <div>
              <p className={sectionLabel}>Location</p>
              <p className="font-medium mt-1">{product.location || "—"}</p>
            </div>
            <div>
              <p className={sectionLabel}>Batch Number</p>
              <p className="font-medium mt-1">{product.batch_number || "—"}</p>
            </div>
            <div>
              <p className={sectionLabel}>Expiry Date</p>
              <p className="font-medium mt-1">{product.expiry_date ? formatDate(product.expiry_date) : "—"}</p>
            </div>
            <div>
              <p className={sectionLabel}>Status</p>
              <div className="mt-1">
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
            </div>
            {product.is_serialized && (
              <div>
                <p className={sectionLabel}>Tracking</p>
                <p className="font-medium mt-1"><span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-cyan-50 text-cyan-700 border border-cyan-200 dark:bg-cyan-500/10 dark:text-cyan-400 dark:border-cyan-500/30"><Fingerprint size={12} /> serialized</span></p>
              </div>
            )}
          </div>

        {(locations.length > 0 || unallocated > 0) && (
          <div className="px-6 py-5 border-b border-dashed border-border">
            <p className={sectionLabel}>
              {product.is_serialized ? "In-stock Serial Locations:" : "Stock Locations:"}
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
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

        {!product.is_serialized && quarantinedLots.length > 0 && (
          <div className="px-6 py-5 border-b border-dashed border-border">
            <p className={sectionLabel}>Quarantined Lots:</p>
            <ul className="mt-3 space-y-1">
              {quarantinedLots.map((lot) => (
                <li key={lot.id} className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3 py-1.5 text-sm">
                  <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400 min-w-0">
                    <ShieldAlert size={14} className="shrink-0" />
                    <span className="font-medium truncate">{lot.lot_number}</span>
                    <span className="text-muted">({lot.on_hand} on hand)</span>
                  </span>
                  <span className="inline-flex flex-wrap items-center justify-end gap-1 shrink-0">
                    {(lot.locations ?? []).map((loc) => (
                      <span key={loc} className="badge bg-subtle text-ink border border-border inline-flex items-center gap-1 px-2 py-0.5 text-xs" title={`${lot.lot_number} at ${loc}`}>
                        <MapPin size={11} /> {loc}
                      </span>
                    ))}
                    {can("lots.update") && (
                      <button onClick={() => releaseLot.mutate(lot.id)} className="btn-secondary px-2 py-1 text-xs shrink-0" aria-label={`Release ${lot.lot_number}`}>
                        Release
                      </button>
                    )}
                    {can("stock.record") && (
                      <button onClick={() => setMoveQuarantinedLot(lot)} className="btn-secondary px-2 py-1 text-xs shrink-0" aria-label={`Move ${lot.lot_number}`}>
                        Move
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {product.is_serialized && quarantinedSerials.length > 0 && (
          <div className="px-6 py-5 border-b border-dashed border-border">
            <div className="flex items-center justify-between gap-2">
              <p className={sectionLabel}>Quarantined Serials:</p>
              {can("stock.record") && (
                <button onClick={() => setMoveQuarantinedSerialized(true)} className="btn-secondary px-2 py-1 text-xs shrink-0" aria-label="Move quarantined serials">
                  Move Serials
                </button>
              )}
            </div>
            <ul className="mt-3 space-y-1">
              {quarantinedSerials.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3 py-1.5 text-sm">
                  <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400 min-w-0">
                    <ShieldAlert size={14} className="shrink-0" />
                    <span className="font-mono font-medium truncate">{s.serial_number}</span>
                    {s.lot_number && <span className="text-muted">(Lot {s.lot_number})</span>}
                    {s.location_name && <span className="text-muted">· {s.location_name}</span>}
                  </span>
                  <span className="inline-flex flex-wrap items-center justify-end gap-1 shrink-0">
                    {can("serial_numbers.update") && (
                      <button onClick={() => releaseSerial.mutate(s.id)} disabled={releaseSerial.isPending} className="btn-secondary px-2 py-1 text-xs shrink-0" aria-label={`Release ${s.serial_number}`}>
                        Release
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {product.is_serialized && reservedSerials.length > 0 && (
          <div className="px-6 py-5 border-b border-dashed border-border">
            <p className={sectionLabel}>Reserved Serials:</p>
            <ul className="mt-3 space-y-1">
              {reservedSerials.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-sky-200 dark:border-sky-500/30 bg-sky-50 dark:bg-sky-500/10 px-3 py-1.5 text-sm">
                  <span className="inline-flex items-center gap-1.5 text-sky-700 dark:text-sky-400 min-w-0">
                    <PackageOpen size={14} className="shrink-0" />
                    <span className="font-mono font-medium truncate">{s.serial_number}</span>
                    {s.lot_number && <span className="text-muted">(Lot {s.lot_number})</span>}
                    {s.location_name && <span className="text-muted">· {s.location_name}</span>}
                  </span>
                  <span className="inline-flex flex-wrap items-center justify-end gap-1 shrink-0">
                    {can("serial_numbers.update") && (
                      <button onClick={() => releaseReservedSerial.mutate(s.id)} disabled={releaseReservedSerial.isPending} className="btn-secondary px-2 py-1 text-xs shrink-0" aria-label={`Release ${s.serial_number}`}>
                        Release
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!product.is_variant && !product.is_serialized && onAddVariant && (
          <div className="px-6 py-5 border-b border-dashed border-border">
            <button onClick={() => onAddVariant(product)} className="btn-secondary w-full inline-flex items-center justify-center gap-2">
              <PackagePlus size={16} /> Add Variant
            </button>
          </div>
        )}

        {product.is_variant && (
          <div className="px-6 py-5 border-b border-dashed border-border">
            <p className={sectionLabel}>Variant of:</p>
            <p className="text-sm font-medium mt-1">{product.variant_of_name || product.name}</p>
          </div>
        )}

        {product.is_variant && product.attributes && Object.keys(product.attributes).length > 0 && (
          <div className="px-6 py-5 border-b border-dashed border-border">
            <p className={sectionLabel}>Attributes:</p>
            <div className="flex flex-wrap gap-2 mt-3">
              {Object.entries(product.attributes).map(([k, v]) => (
                <span key={k} className="badge bg-subtle text-ink border border-border">{k}: {v}</span>
              ))}
            </div>
          </div>
        )}

        {hasVariants(product) && (
          <div className="px-6 py-5 border-b border-dashed border-border">
            <p className={sectionLabel}>Variants ({product.variants.length}):</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm min-w-max">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th scope="col" className="px-3 py-2 font-semibold text-faint uppercase tracking-wide text-xs whitespace-nowrap">SKU</th>
                    <th scope="col" className="px-3 py-2 font-semibold text-faint uppercase tracking-wide text-xs whitespace-nowrap">Attributes</th>
                    <th scope="col" className="px-3 py-2 font-semibold text-faint uppercase tracking-wide text-xs whitespace-nowrap">Price</th>
                    <th scope="col" className="px-3 py-2 font-semibold text-faint uppercase tracking-wide text-xs whitespace-nowrap">Qty</th>
                    <th scope="col" className="px-3 py-2 font-semibold text-faint uppercase tracking-wide text-xs whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {product.variants.map((v) => (
                    <tr key={v.id}>
                      <td className="px-3 py-2 font-medium whitespace-nowrap">{v.sku}</td>
                      <td className="px-3 py-2 text-muted">{v.variant_label || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatCurrency(v.unit_price, currencySymbol)}</td>
                      <td className="px-3 py-2 whitespace-nowrap"><span className={v.quantity <= v.reorder_level ? "text-red-600 dark:text-red-400 font-medium" : ""}>{v.quantity}</span></td>
                      <td className="px-3 py-2 whitespace-nowrap"><span className={`badge ${v.is_active ? "badge-success" : "badge-danger"}`}>{v.is_active ? "Active" : "Inactive"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4">
        <TraceSection product={product} />
      </div>

      <AttachmentSection entityType="product" entityId={product.id} canEdit={can("products.update")} />

      {product.description && (
        <div className="mt-4">
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
          isSerialized={product.is_serialized}
          onClose={() => setShowMoveUnallocated(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["product", product.id] });
            queryClient.invalidateQueries({ queryKey: ["product-stock-locations", product.id, product.is_serialized] });
            queryClient.invalidateQueries({ queryKey: ["trace", product.id] });
          }}
        />
      )}

      {moveQuarantinedLot && (
        <MoveQuarantinedModal
          productId={moveQuarantinedLot.product_id}
          productName={moveQuarantinedLot.product_name || product.display_name}
          lotId={moveQuarantinedLot.id}
          lotNumber={moveQuarantinedLot.lot_number}
          isSerialized={product.is_serialized}
          onClose={() => setMoveQuarantinedLot(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["product", product.id] });
            queryClient.invalidateQueries({ queryKey: ["product-quarantined-lots"] });
            queryClient.invalidateQueries({ queryKey: ["product-stock-locations", product.id, product.is_serialized] });
            queryClient.invalidateQueries({ queryKey: ["lots"] });
            queryClient.invalidateQueries({ queryKey: ["exceptions"] });
            queryClient.invalidateQueries({ queryKey: ["products"] });
            queryClient.invalidateQueries({ queryKey: ["trace", product.id] });
          }}
        />
      )}

      {moveQuarantinedSerialized && (
        <MoveQuarantinedModal
          productId={product.id}
          productName={product.display_name}
          isSerialized
          onClose={() => setMoveQuarantinedSerialized(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["product", product.id] });
            queryClient.invalidateQueries({ queryKey: ["product-quarantined-serials"] });
            queryClient.invalidateQueries({ queryKey: ["product-quarantined-lots"] });
            queryClient.invalidateQueries({ queryKey: ["product-stock-locations", product.id, product.is_serialized] });
            queryClient.invalidateQueries({ queryKey: ["lots"] });
            queryClient.invalidateQueries({ queryKey: ["serial-numbers"] });
            queryClient.invalidateQueries({ queryKey: ["exceptions"] });
            queryClient.invalidateQueries({ queryKey: ["products"] });
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
    </SlideOver>
  );
}

function TraceSection({ product }: { product: Product }) {
  const formatDate = useDateFormat();
  const { data: trace, isLoading, isError } = useQuery({
    queryKey: ["trace", product.id],
    queryFn: async () => {
      const { data } = await api.get(`/products/${product.id}/trace`);
      return data as ProductTrace;
    },
  });

  const movementRows = (m: ProductTrace["incoming"][number]) => (
    <tr key={m.id}>
      <td className="px-3 py-2">{formatDate(m.created_at)}</td>
      <td className="px-3 py-2"><span className="badge badge-info">{movementLabel(m.movement_type)}</span></td>
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
        <Skeleton variant="rows" rows={3} cols={7} />
      ) : isError ? (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">Failed to load trace.</p>
      ) : !trace || (trace.incoming.length === 0 && trace.outgoing.length === 0 && trace.work_orders.length === 0) ? (
        <p className="mt-2 text-sm text-muted">No movements or work orders recorded for this product yet.</p>
      ) : (
        <div className="mt-2 space-y-4">
          {trace.work_orders.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted mb-1">Work Orders</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs rounded-lg">
                  <thead>
                    <tr className="bg-app text-left">
                      <th scope="col" className="px-3 py-2 font-medium text-muted">WO #</th>
                      <th scope="col" className="px-3 py-2 font-medium text-muted">Role</th>
                      <th scope="col" className="px-3 py-2 font-medium text-muted">Qty</th>
                      <th scope="col" className="px-3 py-2 font-medium text-muted">Status</th>
                      <th scope="col" className="px-3 py-2 font-medium text-muted">Date</th>
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
                <table className="w-full text-xs rounded-lg">
                  <thead>
                    <tr className="bg-app text-left">
                      <th scope="col" className="px-3 py-2 font-medium text-muted">Date</th>
                      <th scope="col" className="px-3 py-2 font-medium text-muted">Type</th>
                      <th scope="col" className="px-3 py-2 font-medium text-muted">Qty</th>
                      <th scope="col" className="px-3 py-2 font-medium text-muted">Lot</th>
                      <th scope="col" className="px-3 py-2 font-medium text-muted">Reference</th>
                      <th scope="col" className="px-3 py-2 font-medium text-muted">Route</th>
                      <th scope="col" className="px-3 py-2 font-medium text-muted">User</th>
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
                <table className="w-full text-xs rounded-lg">
                  <thead>
                    <tr className="bg-app text-left">
                      <th scope="col" className="px-3 py-2 font-medium text-muted">Date</th>
                      <th scope="col" className="px-3 py-2 font-medium text-muted">Type</th>
                      <th scope="col" className="px-3 py-2 font-medium text-muted">Qty</th>
                      <th scope="col" className="px-3 py-2 font-medium text-muted">Lot</th>
                      <th scope="col" className="px-3 py-2 font-medium text-muted">Reference</th>
                      <th scope="col" className="px-3 py-2 font-medium text-muted">Route</th>
                      <th scope="col" className="px-3 py-2 font-medium text-muted">User</th>
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
