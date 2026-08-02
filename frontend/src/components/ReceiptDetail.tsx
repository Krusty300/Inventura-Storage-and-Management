import type { Receipt } from "../types";
import Modal from "./Modal";

interface Props {
  receipt: Receipt;
  onClose: () => void;
}

export default function ReceiptDetail({ receipt, onClose }: Props) {
  return (
    <Modal open onClose={onClose} title={`Receipt ${receipt.receipt_number}`} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Supplier</p>
            <p className="font-medium">{receipt.supplier_name || "—"}</p>
          </div>
          <div>
            <p className="text-gray-500">Date</p>
            <p className="font-medium">{new Date(receipt.created_at).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-gray-500">Reference</p>
            <p className="font-medium">{receipt.reference || "—"}</p>
          </div>
        </div>
        {receipt.notes && <p className="text-sm text-gray-600">{receipt.notes}</p>}
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-2 font-medium text-gray-600">Product</th>
                <th className="px-4 py-2 font-medium text-gray-600">Qty</th>
                <th className="px-4 py-2 font-medium text-gray-600">Unit Cost</th>
                <th className="px-4 py-2 font-medium text-gray-600">Lot</th>
                <th className="px-4 py-2 font-medium text-gray-600">Location</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {receipt.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2 font-medium">{item.product_name}</td>
                  <td className="px-4 py-2">{item.quantity}</td>
                  <td className="px-4 py-2">{item.unit_cost.toFixed(2)}</td>
                  <td className="px-4 py-2 text-gray-500">{item.lot_number || "—"}</td>
                  <td className="px-4 py-2 text-gray-500">{item.location_name || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between text-sm font-medium">
          <span>Total quantity: {receipt.total_quantity}</span>
          <span>Total cost: {receipt.total_cost.toFixed(2)}</span>
        </div>
        <div className="flex justify-end pt-2">
          <button onClick={onClose} className="btn-secondary">Close</button>
        </div>
      </div>
    </Modal>
  );
}
