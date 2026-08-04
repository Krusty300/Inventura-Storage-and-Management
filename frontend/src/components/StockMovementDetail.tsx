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
            <span className="text-muted">Product:</span>
            <p className="font-medium">{movement.product_name}</p>
          </div>
          <div>
            <span className="text-muted">Type:</span>
            <p className="font-medium">{movement.movement_type}</p>
          </div>
          <div>
            <span className="text-muted">Quantity Change:</span>
            <p className={`font-medium ${movement.quantity_change > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
              {movement.quantity_change > 0 ? "+" : ""}{movement.quantity_change}
            </p>
          </div>
          <div>
            <span className="text-muted">Reference:</span>
            <p className="font-medium">{movement.reference || "—"}</p>
          </div>
          <div>
            <span className="text-muted">User:</span>
            <p className="font-medium">{movement.username}</p>
          </div>
          <div>
            <span className="text-muted">Date:</span>
            <p className="font-medium">{new Date(movement.created_at).toLocaleString()}</p>
          </div>
        </div>
        {movement.notes && (
          <div>
            <span className="text-muted">Notes:</span>
            <p className="mt-1">{movement.notes}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
