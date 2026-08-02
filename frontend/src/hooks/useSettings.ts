import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import type { Settings } from "../types";

export function useSettings() {
  return useQuery<Settings>({
    queryKey: ["settings"],
    queryFn: async () => (await api.get("/settings")).data,
  });
}
