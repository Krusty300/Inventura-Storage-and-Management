import { useRef, useState } from "react";
import { Barcode, Loader2 } from "lucide-react";
import api from "../api/client";
import type { Product } from "../types";
import { useToast } from "../context/ToastContext";

interface Props {
  onProductFound: (product: Product) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export default function BarcodeScanner({ onProductFound, placeholder = "Scan barcode...", autoFocus = false }: Props) {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useToast();

  const handleSubmit = () => {
    const barcode = value.trim();
    if (!barcode) return;
    setLoading(true);
    void (async () => {
      try {
        const { data } = await api.get(`/products/barcode/${encodeURIComponent(barcode)}`);
        onProductFound(data as Product);
        setValue("");
        addToast(`Found: ${(data as Product).display_name}`, "success");
      } catch {
        addToast("Product not found", "error");
      }
      setLoading(false);
      inputRef.current?.focus();
    })();
  };

  return (
    <div className="flex items-center gap-1">
      <div className="relative">
        <Barcode size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
        <input
          ref={inputRef}
          className="input pl-8 py-1.5 text-sm w-48"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSubmit(); } }}
          autoFocus={autoFocus}
          aria-label="Barcode scanner"
        />
      </div>
      {loading && <Loader2 size={16} className="animate-spin text-faint" />}
    </div>
  );
}
