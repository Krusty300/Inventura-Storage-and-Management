import { useQuery } from "@tanstack/react-query";
import Modal from "./Modal";
import api from "../api/client";
import type { Order, PaginatedResponse, Supplier, SupplierStats } from "../types";
import { formatCurrency } from "../utils/currency";

interface Props {
  supplier: Supplier;
  onClose: () => void;
}

export default function SupplierDetail({ supplier, onClose }: Props) {
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

  const s = stats;
  const history = orders?.items || [];

  return (
    <Modal open onClose={onClose} title={supplier.name} wide>
      <div className="space-y-5 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-muted">Contact Person:</span>
            <p className="font-medium">{supplier.contact_person || "—"}</p>
          </div>
          <div>
            <span className="text-muted">Email:</span>
            <p className="font-medium">{supplier.email || "—"}</p>
          </div>
          <div>
            <span className="text-muted">Phone:</span>
            <p className="font-medium">{supplier.phone || "—"}</p>
          </div>
          <div>
            <span className="text-muted">Address:</span>
            <p className="font-medium">{supplier.address || "—"}</p>
          </div>
        </div>

        {supplier.notes && (
          <div>
            <span className="text-muted">Notes:</span>
            <p className="mt-1">{supplier.notes}</p>
          </div>
        )}

        <div>
          <h3 className="font-semibold text-ink mb-2">Statistics</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-app rounded-lg p-3">
              <p className="text-muted text-xs">Orders</p>
              <p className="font-semibold text-lg">{s?.total_orders ?? supplier.total_orders ?? 0}</p>
            </div>
            <div className="bg-app rounded-lg p-3">
              <p className="text-muted text-xs">Total Spent</p>
              <p className="font-semibold text-lg">{formatCurrency(s?.total_spent ?? supplier.total_spent ?? 0)}</p>
            </div>
            <div className="bg-app rounded-lg p-3">
              <p className="text-muted text-xs">Avg Order</p>
              <p className="font-semibold text-lg">{formatCurrency(s?.avg_order_value ?? supplier.avg_order_value ?? 0)}</p>
            </div>
            <div className="bg-app rounded-lg p-3">
              <p className="text-muted text-xs">Products</p>
              <p className="font-semibold text-lg">{s?.product_count ?? supplier.product_count ?? 0}</p>
            </div>
          </div>
        </div>

        <div>
          <h3 className="font-semibold text-ink mb-2">Purchase Order History</h3>
          {isLoading ? (
            <p className="text-faint">Loading...</p>
          ) : history.length === 0 ? (
            <p className="text-faint">No purchase orders yet.</p>
          ) : (
            <div className="overflow-x-auto border border-border rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-app text-left text-muted">
                    <th className="px-3 py-2 font-medium">Order #</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Total</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {history.map((o) => (
                    <tr key={o.id}>
                      <td className="px-3 py-2 font-medium">{o.order_number}</td>
                      <td className="px-3 py-2 text-muted">{new Date(o.created_at).toLocaleDateString()}</td>
                      <td className="px-3 py-2">{formatCurrency(o.total_amount)}</td>
                      <td className="px-3 py-2">
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
      </div>
    </Modal>
  );
}
