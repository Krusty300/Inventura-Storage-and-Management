import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import type { Settings } from "../types";

export function useSettings() {
  const authed = Boolean(localStorage.getItem("token"));
  return useQuery<Settings>({
    queryKey: ["settings", authed ? "auth" : "public"],
    queryFn: async () => {
      if (authed) return (await api.get("/settings")).data;
      return (await api.get("/settings/public")).data;
    },
    staleTime: 0,
  });
}
