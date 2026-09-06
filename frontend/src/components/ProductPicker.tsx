import { Package } from "lucide-react";
import { useSelectableProducts } from "../hooks/useSelectableProducts";
import FittedSelect from "./FittedSelect";

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
      <Package size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none z-10" />
      <FittedSelect
        value={value ? String(value) : ""}
        onChange={(v) => { const id = Number(v); if (id) onChange(id); }}
        ariaLabel="Select product"
        maxWidth={400}
        placeholder={placeholder ?? "Select product..."}
        options={[{ value: "", label: placeholder ?? "Select product..." }, ...products
          .filter((p) => !excludeIds.includes(p.id))
          .map((p) => ({ value: String(p.id), label: `${p.display_name} — SKU: ${p.sku}` }))]}
      />
      {selected && (
        <p className="text-xs text-muted mt-1 truncate">
          {selected.sku}{selected.category_name ? ` · ${selected.category_name}` : ""}
        </p>
      )}
    </div>
  );
}
