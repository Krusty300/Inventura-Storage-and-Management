import Modal from "./Modal";
import type { StockMovement } from "../types";
import { useDateTimeFormat } from "../hooks/useDateTimeFormat";
import { movementBadgeClass, movementLabel } from "../utils/movementTypes";

interface Props {
  movement: StockMovement;
  onClose: () => void;
}

export default function StockMovementDetail({ movement, onClose }: Props) {
  const formatDateTime = useDateTimeFormat();
  const isTransfer = movement.movement_type === "transfer_out" || movement.movement_type === "transfer_in";
  const positive = movement.quantity_change > 0;

  return (
    <Modal open onClose={onClose} title={`Stock Movement #${movement.id}`}>
      <div className="space-y-5">
        <div className="border border-border rounded-lg overflow-hidden bg-white dark:bg-app">
          <div className="border-b border-border px-5 py-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-faint">Stock Movement</p>
              <h3 className="text-xl font-bold text-ink mt-1">{movement.product_name}</h3>
            </div>
            <div className="text-right">
              <span className={`badge ${movementBadgeClass(movement.movement_type)}`}>{movementLabel(movement.movement_type)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-5 gap-y-4 px-5 py-4 text-sm">
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Quantity Change</p>
              <p className={`text-xl font-bold ${positive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                {positive ? "+" : ""}{movement.quantity_change}
              </p>
            </div>
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Date / Time</p>
              <p className="font-medium text-ink">{formatDateTime(movement.created_at)}</p>
            </div>
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">User</p>
              <p className="font-medium text-ink">{movement.username || "—"}</p>
            </div>
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Reference</p>
              <p className="font-medium text-ink break-words">{movement.reference || "—"}</p>
            </div>
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Route:</p>
              <p className="font-medium text-ink">
                {[movement.from_location_name, movement.to_location_name].filter(Boolean).join(" → ") || "—"}
              </p>
            </div>
            <div>
              <p className="text-faint text-xs uppercase tracking-wide mb-0.5">Paired Movement</p>
              <p className="font-medium text-ink">{isTransfer ? (movement.transfer_id ? `#${movement.transfer_id}` : "—") : "—"}</p>
            </div>
          </div>

          {movement.notes && (
            <div className="px-5 pb-4 text-sm">
              <p className="text-faint text-xs uppercase tracking-wide mb-1">Notes</p>
              <p className="text-muted">{movement.notes}</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
