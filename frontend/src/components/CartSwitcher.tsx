import { useState } from "react";
import { Plus, X } from "lucide-react";

export interface CartSwitcherCart {
  id: string;
  name: string;
  count: number;
}

interface Props {
  carts: CartSwitcherCart[];
  activeId: string;
  disabled?: boolean;
  onCreate: () => void;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * Tab strip for switching between open carts. Each tab shows the cart name and
 * item count, plus an inline-confirmed delete action and a "New cart" button.
 */
export default function CartSwitcher({
  carts,
  activeId,
  disabled = false,
  onCreate,
  onSwitch,
  onDelete,
}: Props) {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <div
      role="tablist"
      aria-label="Carts"
      className="flex items-center gap-1.5 overflow-x-auto"
    >
      {carts.map((cart) => (
        <div key={cart.id} className="relative shrink-0">
          <button
            type="button"
            role="tab"
            aria-selected={cart.id === activeId}
            disabled={disabled}
            onClick={() => {
              if (cart.id !== activeId) onSwitch(cart.id);
            }}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              cart.id === activeId
                ? "border-primary-solid bg-primary-solid text-white"
                : "border-border bg-surface text-muted hover:border-primary hover:text-ink"
            } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
          >
            <span>{cart.name}</span>
            <span
              className={`rounded-full px-1.5 text-[10px] font-semibold ${
                cart.id === activeId ? "bg-white/20" : "bg-subtle"
              }`}
            >
              {cart.count}
            </span>
          </button>
          <button
            type="button"
            aria-label={`Delete ${cart.name}`}
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              setConfirmId(cart.id);
            }}
            className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-app text-faint hover:text-red-600 disabled:opacity-40"
          >
            <X size={10} />
          </button>
          {confirmId === cart.id && (
            <div
              role="dialog"
              aria-label={`Delete ${cart.name}`}
              className="absolute right-0 top-7 z-50 w-44 space-y-2 rounded-lg border border-border-strong bg-surface p-3 shadow-lg"
            >
              <p className="text-xs font-medium">Delete {cart.name}?</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onDelete(cart.id);
                    setConfirmId(null);
                  }}
                  className="btn-primary flex-1 !px-2 !py-1 text-xs"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmId(null)}
                  className="btn-secondary flex-1 !px-2 !py-1 text-xs"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={onCreate}
        disabled={disabled}
        aria-label="New cart"
        className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
      >
        <Plus size={13} /> New
      </button>
    </div>
  );
}