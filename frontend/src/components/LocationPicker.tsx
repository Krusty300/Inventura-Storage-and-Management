import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import { PAGE_SIZE_LOOKUP } from "../utils/constants";
import type { Location } from "../types";

interface Props {
  value: string | number | null;
  onChange: (value: string) => void;
  placeholder?: string;
  includeInactive?: boolean;
}

export default function LocationPicker({ value, onChange, placeholder = "Select location...", includeInactive = false }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["locations", "picker", includeInactive],
    queryFn: async () => {
      const { data } = await api.get("/locations", { params: { limit: PAGE_SIZE_LOOKUP } });
      return data.items as Location[];
    },
  });

  const locations = useMemo(() => {
    let list = data || [];
    if (!includeInactive) list = list.filter((l) => l.is_active);
    return list.sort((a, b) => a.path.localeCompare(b.path));
  }, [data, includeInactive]);

  return (
    <div>
      <input
        type="text"
        className="input"
        list="location-options"
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Location"
      />
      <datalist id="location-options">
        {locations.map((l) => (
          <option key={l.id} value={l.path}>
            {l.name}
          </option>
        ))}
      </datalist>
      {isLoading && <p className="text-xs text-faint mt-1">Loading locations...</p>}
    </div>
  );
}
