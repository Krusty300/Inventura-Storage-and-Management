import Modal from "./Modal";
import type { StockMovement } from "../types";

interface Props {
  movement: StockMovement;
  onClose: () => void;
}

export default function StockMovementDetail({ movement, onClose }: Props) {
  return (
    <Modal open onClose={onClose} title={`Movement #${movement.id}`}>
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-gray-500">Product:</span>
            <p className="font-medium">{movement.product_name}</p>
          </div>
          <div>
            <span className="text-gray-500">Type:</span>
            <p className="font-medium">{movement.movement_type}</p>
          </div>
          <div>
            <span className="text-gray-500">Quantity Change:</span>
            <p className={`font-medium ${movement.quantity_change > 0 ? "text-green-600" : "text-red-600"}`}>
              {movement.quantity_change > 0 ? "+" : ""}{movement.quantity_change}
            </p>
          </div>
          <div>
            <span className="text-gray-500">Reference:</span>
            <p className="font-medium">{movement.reference || "—"}</p>
          </div>
          <div>
            <span className="text-gray-500">User:</span>
            <p className="font-medium">{movement.username}</p>
          </div>
          <div>
            <span className="text-gray-500">Date:</span>
            <p className="font-medium">{new Date(movement.created_at).toLocaleString()}</p>
          </div>
        </div>
        {movement.notes && (
          <div>
            <span className="text-gray-500">Notes:</span>
            <p className="mt-1">{movement.notes}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
