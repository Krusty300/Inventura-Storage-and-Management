import type { Receipt } from "../types";
import Modal from "./Modal";
import { useDateTimeFormat } from "../hooks/useDateTimeFormat";
import { useSettings } from "../hooks/useSettings";
import { formatCurrency } from "../utils/currency";

interface Props {
  receipt: Receipt;
  onClose: () => void;
}

export default function ReceiptDetail({ receipt, onClose }: Props) {
  const formatDateTime = useDateTimeFormat();
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  return (
    <Modal open onClose={onClose} title={`Receipt ${receipt.receipt_number}`} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-muted">Supplier</p>
            <p className="font-medium">{receipt.supplier_name || "—"}</p>
          </div>
          <div>
            <p className="text-muted">Date</p>
            <p className="font-medium">{formatDateTime(receipt.created_at)}</p>
          </div>
          <div>
            <p className="text-muted">Reference</p>
            <p className="font-medium">{receipt.reference || "—"}</p>
          </div>
        </div>
        {receipt.notes && <p className="text-sm text-muted">{receipt.notes}</p>}
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app text-left">
                <th className="px-4 py-2 font-medium text-muted">Product</th>
                <th className="px-4 py-2 font-medium text-muted">Qty</th>
                <th className="px-4 py-2 font-medium text-muted">Unit Cost</th>
                <th className="px-4 py-2 font-medium text-muted text-right">Amount</th>
                <th className="px-4 py-2 font-medium text-muted">Lot</th>
                <th className="px-4 py-2 font-medium text-muted">Location</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {receipt.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2 font-medium">{item.product_name}</td>
                  <td className="px-4 py-2">{item.quantity}</td>
                  <td className="px-4 py-2">{formatCurrency(item.unit_cost, currencySymbol)}</td>
                  <td className="px-4 py-2 text-right">{formatCurrency(item.unit_cost * item.quantity, currencySymbol)}</td>
                  <td className="px-4 py-2 text-muted">{item.lot_number || "\u2014"}</td>
                  <td className="px-4 py-2 text-muted">{item.location_name || "\u2014"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between text-sm font-medium">
          <span>Total quantity: {receipt.total_quantity}</span>
          <span>Total cost: {formatCurrency(receipt.total_cost, currencySymbol)}</span>
        </div>
        <div className="flex justify-end pt-2">
          <button onClick={onClose} className="btn-secondary">Close</button>
        </div>
      </div>
    </Modal>
  );
}
