import { useDateFormat } from "../hooks/useDateFormat";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Users, Tag, Pencil, Camera, Trash2, PackageSearch } from "lucide-react";
import SlideOver from "./SlideOver";
import Skeleton from "./Skeleton";
import AttachmentSection from "./AttachmentSection";
import EmptyState from "./EmptyState";
import FileUploadButton from "./FileUploadButton";
import api from "../api/client";
import type { Customer, CustomerStats, FrequentProduct, PaginatedResponse, Sale } from "../types";
import { formatCurrency } from "../utils/currency";
import { useSettings } from "../hooks/useSettings";
import { paymentLabel } from "../utils/payments";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { errorMessage } from "../utils/errors";
import { entityImageUrl } from "../utils/images";
import { onImageError } from "../utils/placeholders";

interface Props {
  customer: Customer;
  onClose: () => void;
  onEdit?: () => void;
}

export default function CustomerDetail({ customer, onClose, onEdit }: Props) {
  const formatDate = useDateFormat();
  const { can } = useAuth();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  const [imageUrl, setImageUrl] = useState(customer.image_url);
  const [imageBusy, setImageBusy] = useState(false);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    setImageBusy(true);
    try {
      const { data } = await api.post(`/customers/${customer.id}/upload-image`, fd);
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = data.image_url;
      });
      setImageUrl(data.image_url);
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      addToast("Profile image updated", "success");
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to upload profile image"), "error");
    }
    setImageBusy(false);
  };

  const handleImageRemove = async () => {
    try {
      await api.delete(`/customers/${customer.id}/upload-image`);
      setImageUrl("");
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      addToast("Profile image removed", "success");
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to remove profile image"), "error");
    }
  };

  const { data: stats } = useQuery({
    queryKey: ["customer-stats", customer.id],
    queryFn: async () => (await api.get(`/customers/${customer.id}/stats`)).data as CustomerStats,
  });

  const { data: frequent, isLoading: frequentLoading } = useQuery({
    queryKey: ["customer-frequent-products", customer.id],
    queryFn: async () => {
      const { data } = await api.get(`/customers/${customer.id}/frequent-products`);
      return data as FrequentProduct[];
    },
  });

  const { data: sales, isLoading } = useQuery({
    queryKey: ["customer-sales", customer.id],
    queryFn: async () => {
      const { data } = await api.get("/sales", { params: { customer_id: customer.id, limit: 20 } });
      return data as PaginatedResponse<Sale>;
    },
  });

  const s = stats;
  const history = sales?.items || [];
  const frequentProducts = frequent || [];

  return (
    <SlideOver
      open
      onClose={onClose}
      title={customer.name}
      wide
      ariaLabel={customer.name}
      actions={onEdit && can("customers.update") ? (
        <button onClick={onEdit} className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1.5" aria-label="Edit customer">
          <Pencil size={14} />Edit Customer
        </button>
      ) : undefined}
    >
      <div className="space-y-5 text-sm">
        <div className="border border-border rounded-lg overflow-hidden bg-white dark:bg-app">
          <div className="border-b border-border px-5 py-4 flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <img
                src={entityImageUrl(imageUrl)}
                alt=""
                className="h-16 w-16 rounded-full object-cover border border-border bg-subtle shrink-0"
                loading="lazy"
                onError={onImageError}
              />
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-widest text-faint">Customer</p>
                <h3 className="text-xl font-bold text-ink mt-1">{customer.name}</h3>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {can("customers.update") && (
                <div className="flex items-center gap-2">
                  <FileUploadButton
                    onFileChange={handleImageUpload}
                    accept=".png,.jpg,.jpeg,.gif,.webp"
                    disabled={imageBusy}
                    className="btn-secondary text-xs px-2.5 py-1.5 inline-flex items-center gap-1"
                    ariaLabel="Upload profile image"
                  >
                    <Camera size={13} />{imageBusy ? "Uploading..." : "Upload"}
                  </FileUploadButton>
                  {imageUrl && (
                    <button type="button" onClick={handleImageRemove} className="btn-secondary text-xs px-2.5 py-1.5 inline-flex items-center gap-1" aria-label="Remove profile image">
                      <Trash2 size={13} />Remove
                    </button>
                  )}
                </div>
              )}
              <span className="badge badge-info">{customer.customer_type}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4 px-5 py-4">
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Phone</p>
              <p className="font-medium text-ink break-words">{customer.phone || "—"}</p>
            </div>
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Email</p>
              <p className="font-medium text-ink break-words">{customer.email || "—"}</p>
            </div>
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Created</p>
              <p className="font-medium text-ink">{formatDate(customer.created_at)}</p>
            </div>
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Tags</p>
              <div className="flex flex-wrap items-center gap-2 mt-0.5">
                {customer.group_name && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-primary-soft text-primary-strong dark:bg-primary/15 dark:text-primary">
                    <Users size={12} />
                    {customer.group_name}
                  </span>
                )}
                {customer.price_list_id && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                    <Tag size={12} />
                    Price Tier
                  </span>
                )}
                {!customer.group_name && !customer.price_list_id && <span className="text-muted">—</span>}
              </div>
            </div>
            {customer.address && (
              <div className="sm:col-span-2">
                <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Address</p>
                <p className="font-medium text-ink break-words">{customer.address}</p>
              </div>
            )}
          </div>

          {customer.notes && (
            <div className="px-5 pb-4">
              <p className="text-faint text-xs uppercase tracking-wide mb-1">Notes</p>
              <p className="text-muted">{customer.notes}</p>
            </div>
          )}
        </div>

        <div>
          <h3 className="font-semibold text-ink mb-2">Statistics</h3>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
            <div className="bg-app rounded-lg p-4 min-w-0">
              <p className="text-muted text-xs">Orders</p>
              <p className="font-semibold text-xl mt-1 truncate" title={String(s?.total_sales ?? customer.total_sales ?? 0)}>{s?.total_sales ?? customer.total_sales ?? 0}</p>
            </div>
            <div className="bg-app rounded-lg p-4 min-w-0">
              <p className="text-muted text-xs">Total Spent</p>
              <p className="font-semibold text-xl mt-1 truncate" title={formatCurrency(s?.total_spent ?? customer.total_spent ?? 0, currencySymbol)}>{formatCurrency(s?.total_spent ?? customer.total_spent ?? 0, currencySymbol)}</p>
            </div>
            <div className="bg-app rounded-lg p-4 min-w-0">
              <p className="text-muted text-xs">Avg Order</p>
              <p className="font-semibold text-xl mt-1 truncate" title={formatCurrency(s?.avg_order_value ?? customer.avg_order_value ?? 0, currencySymbol)}>{formatCurrency(s?.avg_order_value ?? customer.avg_order_value ?? 0, currencySymbol)}</p>
            </div>
            <div className="bg-app rounded-lg p-4 min-w-0">
              <p className="text-muted text-xs">Last Purchase</p>
              <p className="font-semibold text-xl mt-1 truncate" title={s?.last_purchase_at ? formatDate(s.last_purchase_at) : (customer.last_purchase_at ? formatDate(customer.last_purchase_at) : "Never")}>{s?.last_purchase_at ? formatDate(s.last_purchase_at) : (customer.last_purchase_at ? formatDate(customer.last_purchase_at) : "Never")}</p>
            </div>
          </div>
        </div>

        <div>
          <h3 className="font-semibold text-ink mb-2">Frequently Purchased</h3>
          {frequentLoading ? (
            <Skeleton variant="rows" rows={3} cols={4} />
          ) : frequentProducts.length === 0 ? (
            <EmptyState
              compact
              icon={<PackageSearch size={20} />}
              title="No purchase history yet"
              message="Frequently purchased products will appear here once this customer places orders."
            />
          ) : (
            <div className="overflow-x-auto border border-border rounded-lg">
              <table className="w-full text-sm min-w-max">
                <thead>
                  <tr className="bg-app text-left text-muted text-xs uppercase tracking-wide">
                    <th className="px-3 py-2.5 font-medium">Product</th>
                    <th className="px-3 py-2.5 font-medium">SKU</th>
                    <th className="px-3 py-2.5 text-right font-medium">Times Ordered</th>
                    <th className="px-3 py-2.5 text-right font-medium">Total Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {frequentProducts.map((p) => (
                    <tr key={p.product_id}>
                      <td className="px-3 py-2.5 font-medium text-ink">{p.product_name}</td>
                      <td className="px-3 py-2.5 text-muted whitespace-nowrap">{p.sku || "—"}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">{p.order_count}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">{p.total_quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <h3 className="font-semibold text-ink mb-2">Purchase History</h3>
          {isLoading ? (
            <Skeleton variant="rows" rows={3} cols={5} />
          ) : history.length === 0 ? (
            <EmptyState
              compact
              icon={<PackageSearch size={20} />}
              title="No purchases recorded yet"
              message="Purchases will appear here once this customer places orders."
            />
          ) : (
            <div className="overflow-x-auto border border-border rounded-lg">
              <table className="w-full text-sm min-w-max">
                <thead>
                  <tr className="bg-app text-left text-muted text-xs uppercase tracking-wide">
                    <th className="px-3 py-2.5 font-medium">Invoice</th>
                    <th className="px-3 py-2.5 font-medium">Date</th>
                    <th className="px-3 py-2.5 font-medium">Payment</th>
                    <th className="px-3 py-2.5 text-right font-medium">Total</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {history.map((sale) => (
                    <tr key={sale.id}>
                      <td className="px-3 py-2.5 font-medium text-ink whitespace-nowrap">{sale.invoice_number}</td>
                      <td className="px-3 py-2.5 text-muted whitespace-nowrap">{formatDate(sale.created_at)}</td>
                      <td className="px-3 py-2.5 text-muted">{paymentLabel(sale.payment_method, sale.payment_provider)}</td>
                      <td className="px-3 py-2.5 text-right font-medium whitespace-nowrap">{formatCurrency(sale.total_amount, currencySymbol)}</td>
                      <td className="px-3 py-2.5">
                        <span className={`badge ${sale.status === "completed" ? "badge-success" : sale.status === "refunded" ? "badge-warning" : "badge-info"}`}>
                          {sale.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <AttachmentSection entityType="customer" entityId={customer.id} canEdit={can("customers.update")} />
      </div>
    </SlideOver>
  );
}
