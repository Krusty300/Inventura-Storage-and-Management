import { useDateFormat } from "../hooks/useDateFormat";
import { useQuery } from "@tanstack/react-query";
import { Users, Tag } from "lucide-react";
import SlideOver from "./SlideOver";
import Skeleton from "./Skeleton";
import api from "../api/client";
import type { Customer, CustomerStats, FrequentProduct, PaginatedResponse, Sale } from "../types";
import { formatCurrency } from "../utils/currency";
import { paymentLabel } from "../utils/payments";

interface Props {
  customer: Customer;
  onClose: () => void;
}

export default function CustomerDetail({ customer, onClose }: Props) {
  const formatDate = useDateFormat();
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
    <SlideOver open onClose={onClose} title={customer.name} wide ariaLabel={customer.name}>
      <div className="space-y-5 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-muted">Phone:</span>
            <p className="font-medium">{customer.phone || "—"}</p>
          </div>
          <div>
            <span className="text-muted">Email:</span>
            <p className="font-medium">{customer.email || "—"}</p>
          </div>
          <div>
            <span className="text-muted">Type:</span>
            <p className="font-medium">{customer.customer_type}</p>
          </div>
          <div>
            <span className="text-muted">Created:</span>
            <p className="font-medium">{formatDate(customer.created_at)}</p>
          </div>
        </div>

        {customer.group_name || customer.price_list_id ? (
          <div className="flex items-center gap-3">
            {customer.group_name && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400">
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
          </div>
        ) : null}

        {customer.address && (
          <div>
            <span className="text-muted">Address:</span>
            <p className="font-medium mt-1">{customer.address}</p>
          </div>
        )}
        {customer.notes && (
          <div>
            <span className="text-muted">Notes:</span>
            <p className="mt-1">{customer.notes}</p>
          </div>
        )}

        <div>
          <h3 className="font-semibold text-ink mb-2">Statistics</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-app rounded-lg p-3">
              <p className="text-muted text-xs">Orders</p>
              <p className="font-semibold text-lg">{s?.total_sales ?? customer.total_sales ?? 0}</p>
            </div>
            <div className="bg-app rounded-lg p-3">
              <p className="text-muted text-xs">Total Spent</p>
              <p className="font-semibold text-lg">{formatCurrency(s?.total_spent ?? customer.total_spent ?? 0)}</p>
            </div>
            <div className="bg-app rounded-lg p-3">
              <p className="text-muted text-xs">Avg Order</p>
              <p className="font-semibold text-lg">{formatCurrency(s?.avg_order_value ?? customer.avg_order_value ?? 0)}</p>
            </div>
            <div className="bg-app rounded-lg p-3">
              <p className="text-muted text-xs">Last Purchase</p>
              <p className="font-semibold text-lg">{s?.last_purchase_at ? formatDate(s.last_purchase_at) : (customer.last_purchase_at ? formatDate(customer.last_purchase_at) : "Never")}</p>
            </div>
          </div>
        </div>

        <div>
          <h3 className="font-semibold text-ink mb-2">Frequently Purchased</h3>
          {frequentLoading ? (
            <Skeleton variant="rows" rows={3} cols={4} />
          ) : frequentProducts.length === 0 ? (
            <p className="text-faint">No purchase history yet.</p>
          ) : (
            <div className="overflow-x-auto border border-border rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-app text-left text-muted">
                    <th className="px-3 py-2 font-medium">Product</th>
                    <th className="px-3 py-2 font-medium">SKU</th>
                    <th className="px-3 py-2 font-medium">Times Ordered</th>
                    <th className="px-3 py-2 font-medium">Total Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {frequentProducts.map((p) => (
                    <tr key={p.product_id}>
                      <td className="px-3 py-2 font-medium">{p.product_name}</td>
                      <td className="px-3 py-2 text-muted">{p.sku || "—"}</td>
                      <td className="px-3 py-2">{p.order_count}</td>
                      <td className="px-3 py-2">{p.total_quantity}</td>
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
            <p className="text-faint">No purchases recorded yet.</p>
          ) : (
            <div className="overflow-x-auto border border-border rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-app text-left text-muted">
                    <th className="px-3 py-2 font-medium">Invoice</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Payment</th>
                    <th className="px-3 py-2 font-medium">Total</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {history.map((sale) => (
                    <tr key={sale.id}>
                      <td className="px-3 py-2 font-medium">{sale.invoice_number}</td>
                      <td className="px-3 py-2 text-muted">{formatDate(sale.created_at)}</td>
                      <td className="px-3 py-2 text-muted">{paymentLabel(sale.payment_method, sale.payment_provider)}</td>
                      <td className="px-3 py-2">{formatCurrency(sale.total_amount)}</td>
                      <td className="px-3 py-2">
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
      </div>
    </SlideOver>
  );
}
