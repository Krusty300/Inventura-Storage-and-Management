import { useQuery } from "@tanstack/react-query";
import Modal from "./Modal";
import api from "../api/client";
import type { Customer, CustomerStats, PaginatedResponse, Sale } from "../types";
import { formatCurrency } from "../utils/currency";

interface Props {
  customer: Customer;
  onClose: () => void;
}

export default function CustomerDetail({ customer, onClose }: Props) {
  const { data: stats } = useQuery({
    queryKey: ["customer-stats", customer.id],
    queryFn: async () => (await api.get(`/customers/${customer.id}/stats`)).data as CustomerStats,
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

  return (
    <Modal open onClose={onClose} title={customer.name} wide>
      <div className="space-y-5 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-gray-500">Phone:</span>
            <p className="font-medium">{customer.phone || "—"}</p>
          </div>
          <div>
            <span className="text-gray-500">Email:</span>
            <p className="font-medium">{customer.email || "—"}</p>
          </div>
          <div>
            <span className="text-gray-500">Type:</span>
            <p className="font-medium">{customer.customer_type}</p>
          </div>
          <div>
            <span className="text-gray-500">Created:</span>
            <p className="font-medium">{new Date(customer.created_at).toLocaleDateString()}</p>
          </div>
        </div>

        {customer.address && (
          <div>
            <span className="text-gray-500">Address:</span>
            <p className="font-medium mt-1">{customer.address}</p>
          </div>
        )}
        {customer.notes && (
          <div>
            <span className="text-gray-500">Notes:</span>
            <p className="mt-1">{customer.notes}</p>
          </div>
        )}

        <div>
          <h3 className="font-semibold text-gray-700 mb-2">Statistics</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-gray-500 text-xs">Orders</p>
              <p className="font-semibold text-lg">{s?.total_sales ?? customer.total_sales ?? 0}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-gray-500 text-xs">Total Spent</p>
              <p className="font-semibold text-lg">{formatCurrency(s?.total_spent ?? customer.total_spent ?? 0)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-gray-500 text-xs">Avg Order</p>
              <p className="font-semibold text-lg">{formatCurrency(s?.avg_order_value ?? customer.avg_order_value ?? 0)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-gray-500 text-xs">Last Purchase</p>
              <p className="font-semibold text-lg">{s?.last_purchase_at ? new Date(s.last_purchase_at).toLocaleDateString() : (customer.last_purchase_at ? new Date(customer.last_purchase_at).toLocaleDateString() : "Never")}</p>
            </div>
          </div>
        </div>

        <div>
          <h3 className="font-semibold text-gray-700 mb-2">Purchase History</h3>
          {isLoading ? (
            <p className="text-gray-400">Loading...</p>
          ) : history.length === 0 ? (
            <p className="text-gray-400">No purchases recorded yet.</p>
          ) : (
            <div className="overflow-x-auto border border-gray-100 rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-gray-500">
                    <th className="px-3 py-2 font-medium">Invoice</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Payment</th>
                    <th className="px-3 py-2 font-medium">Total</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {history.map((sale) => (
                    <tr key={sale.id}>
                      <td className="px-3 py-2 font-medium">{sale.invoice_number}</td>
                      <td className="px-3 py-2 text-gray-500">{new Date(sale.created_at).toLocaleDateString()}</td>
                      <td className="px-3 py-2 text-gray-500">{sale.payment_method}</td>
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
    </Modal>
  );
}
