import { Package } from "lucide-react";
import { useSelectableProducts } from "../hooks/useSelectableProducts";

interface Props {
  value: number | null;
  onChange: (productId: number) => void;
  excludeIds?: number[];
  placeholder?: string;
}

export default function ProductPicker({ value, onChange, excludeIds = [], placeholder }: Props) {
  const products = useSelectableProducts();
  const selected = products.find((p) => p.id === value);

  return (
    <div className="relative">
      <Package size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
      <select
        className="input pl-8 text-sm w-full"
        value={value ?? ""}
        onChange={(e) => { const id = Number(e.target.value); if (id) onChange(id); }}
        aria-label="Select product"
      >
        <option value="">{placeholder ?? "Select product..."}</option>
        {products
          .filter((p) => !excludeIds.includes(p.id))
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_name} — SKU: {p.sku}
            </option>
          ))}
      </select>
      {selected && (
        <p className="text-xs text-muted mt-1 truncate">
          {selected.sku}{selected.category_name ? ` · ${selected.category_name}` : ""}
        </p>
      )}
    </div>
  );
}
