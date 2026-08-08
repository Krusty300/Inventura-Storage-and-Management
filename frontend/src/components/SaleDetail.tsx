import { Printer } from "lucide-react";
import api from "../api/client";
import type { Sale } from "../types";
import { formatCurrency } from "../utils/currency";
import { useSettings } from "../hooks/useSettings";
import Modal from "./Modal";
import { useToast } from "../context/ToastContext";

interface Props {
  sale: Sale;
  onClose: () => void;
}

const statusColors: Record<string, string> = {
  completed: "badge-success",
  refunded: "badge-danger",
  void: "badge-danger",
};

export default function SaleDetail({ sale, onClose }: Props) {
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  const { addToast } = useToast();
  const printInvoice = () => {
    api.get(`/sales/${sale.id}/pdf`, { responseType: "blob" }).then(({ data }) => {
      const url = URL.createObjectURL(data);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }).catch(() => addToast("Failed to generate PDF", "error"));
  };

  return (
    <Modal open onClose={onClose} title={`Invoice ${sale.invoice_number}`} wide>
      <div className="space-y-4 text-sm">
        <div className="flex justify-between">
          <div className="space-y-1">
            <p className="text-muted">Customer: <span className="font-medium text-ink">{sale.customer_name}</span></p>
            <p className="text-muted">Date: <span className="font-medium text-ink">{new Date(sale.created_at).toLocaleString()}</span></p>
            <p className="text-muted">Cashier: <span className="font-medium text-ink">{sale.username}</span></p>
          </div>
          <div className="space-y-1 text-right">
            <span className={`badge ${statusColors[sale.status] || "badge-info"}`}>{sale.status}</span>
            <p className="text-muted">Payment: <span className="font-medium text-ink capitalize">{sale.payment_method}</span></p>
          </div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="bg-app text-left">
              <th className="px-3 py-2 font-medium text-muted">Item</th>
              <th className="px-3 py-2 font-medium text-muted">Location</th>
              <th className="px-3 py-2 font-medium text-muted">Qty</th>
              <th className="px-3 py-2 font-medium text-muted">Price</th>
              <th className="px-3 py-2 font-medium text-muted text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sale.items.map((item) => (
              <tr key={item.id}>
                <td className="px-3 py-2">{item.product_name}</td>
                <td className="px-3 py-2 text-muted">{item.location || (item.locations ?? []).join(", ") || "—"}</td>
                <td className="px-3 py-2">{item.quantity}</td>
                <td className="px-3 py-2">{formatCurrency(item.unit_price, currencySymbol)}</td>
                <td className="px-3 py-2 text-right">{formatCurrency(item.line_total, currencySymbol)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end">
          <div className="w-56 space-y-1">
            <div className="flex justify-between"><span className="text-muted">Subtotal</span><span>{formatCurrency(sale.subtotal, currencySymbol)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Tax</span><span>{formatCurrency(sale.tax_amount, currencySymbol)}</span></div>
            <div className="flex justify-between font-bold text-base"><span>Total</span><span>{formatCurrency(sale.total_amount, currencySymbol)}</span></div>
          </div>
        </div>

        {sale.notes && <p className="text-muted">Notes: {sale.notes}</p>}

        <div className="flex justify-end pt-2">
          <button onClick={printInvoice} className="btn-secondary">
            <Printer size={16} className="inline mr-1" />
            Print / PDF
          </button>
        </div>
      </div>
    </Modal>
  );
}
