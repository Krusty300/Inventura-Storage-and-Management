import { Printer } from "lucide-react";
import api from "../api/client";
import type { Sale } from "../types";
import { formatCurrency } from "../utils/currency";
import { useSettings } from "../hooks/useSettings";
import Modal from "./Modal";

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
  const printInvoice = () => {
    api.get(`/sales/${sale.id}/pdf`, { responseType: "blob" }).then(({ data }) => {
      const url = URL.createObjectURL(data);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
  };

  return (
    <Modal open onClose={onClose} title={`Invoice ${sale.invoice_number}`} wide>
      <div className="space-y-4 text-sm">
        <div className="flex justify-between">
          <div className="space-y-1">
            <p className="text-gray-500">Customer: <span className="font-medium text-gray-900">{sale.customer_name}</span></p>
            <p className="text-gray-500">Date: <span className="font-medium text-gray-900">{new Date(sale.created_at).toLocaleString()}</span></p>
            <p className="text-gray-500">Cashier: <span className="font-medium text-gray-900">{sale.username}</span></p>
          </div>
          <div className="space-y-1 text-right">
            <span className={`badge ${statusColors[sale.status] || "badge-info"}`}>{sale.status}</span>
            <p className="text-gray-500">Payment: <span className="font-medium text-gray-900 capitalize">{sale.payment_method}</span></p>
          </div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="px-3 py-2 font-medium text-gray-600">Item</th>
              <th className="px-3 py-2 font-medium text-gray-600">Qty</th>
              <th className="px-3 py-2 font-medium text-gray-600">Price</th>
              <th className="px-3 py-2 font-medium text-gray-600 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sale.items.map((item) => (
              <tr key={item.id}>
                <td className="px-3 py-2">{item.product_name}</td>
                <td className="px-3 py-2">{item.quantity}</td>
                <td className="px-3 py-2">{formatCurrency(item.unit_price, currencySymbol)}</td>
                <td className="px-3 py-2 text-right">{formatCurrency(item.line_total, currencySymbol)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end">
          <div className="w-56 space-y-1">
            <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{formatCurrency(sale.subtotal, currencySymbol)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Tax</span><span>{formatCurrency(sale.tax_amount, currencySymbol)}</span></div>
            <div className="flex justify-between font-bold text-base"><span>Total</span><span>{formatCurrency(sale.total_amount, currencySymbol)}</span></div>
          </div>
        </div>

        {sale.notes && <p className="text-gray-500">Notes: {sale.notes}</p>}

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
