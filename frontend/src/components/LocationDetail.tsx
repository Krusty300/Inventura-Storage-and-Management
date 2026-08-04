import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Package, MapPin, ClipboardList } from "lucide-react";
import api from "../api/client";
import Modal from "./Modal";
import type { Location, PaginatedResponse } from "../types";
import { formatCurrency } from "../utils/currency";
import { useSettings } from "../hooks/useSettings";

interface LocationDetailData {
  location: Location;
  stock_lines: {
    id: number;
    product_id: number;
    product_name: string;
    sku: string;
    lot_number: string;
    lpn_number: string;
    quantity: number;
    unit_cost: number;
    value: number;
  }[];
  lpns: {
    id: number;
    lpn_number: string;
    lpn_type: string;
    status: string;
    total_quantity: number;
  }[];
}

interface ActivityLogEntry {
  id: number;
  user_id: number;
  username: string;
  action: string;
  entity_type: string;
  entity_id: number | null;
  description: string;
  details: string;
  created_at: string;
}

interface Props {
  location: Location;
  onClose: () => void;
}

const actionColors: Record<string, string> = {
  create: "badge-success",
  update: "badge-info",
  delete: "badge-danger",
};

type Tab = "stock" | "lpns" | "activity";

export default function LocationDetail({ location, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("stock");
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";

  const { data: detail, isLoading } = useQuery({
    queryKey: ["locations", "detail", location.id],
    queryFn: async () => {
      const { data } = await api.get(`/locations/${location.id}/detail`);
      return data as LocationDetailData;
    },
  });

  const { data: activity } = useQuery({
    queryKey: ["activity-logs", "location", location.id],
    queryFn: async () => {
      const { data } = await api.get("/activity-logs", {
        params: { entity_type: "location", entity_id: location.id, limit: 20 },
      });
      return data as PaginatedResponse<ActivityLogEntry>;
    },
  });

  const stockLines = detail?.stock_lines || [];
  const lpns = detail?.lpns || [];
  const logs = activity?.items || [];

  return (
    <Modal open onClose={onClose} title={location.path} wide>
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-muted">Name:</span>
            <p className="font-medium">{location.name}</p>
          </div>
          <div>
            <span className="text-muted">Code:</span>
            <p className="font-medium">{location.code || "—"}</p>
          </div>
          <div>
            <span className="text-muted">Type:</span>
            <p className="font-medium capitalize">{location.location_type}</p>
          </div>
          <div>
            <span className="text-muted">Status:</span>
            <p className="font-medium">
              {location.is_active ? (
                <span className="badge badge-success">Active</span>
              ) : (
                <span className="badge badge-warning">Inactive</span>
              )}
            </p>
          </div>
          <div>
            <span className="text-muted">Created:</span>
            <p className="font-medium">{new Date(location.created_at).toLocaleDateString()}</p>
          </div>
          <div>
            <span className="text-muted">Stock value:</span>
            <p className="font-medium">{formatCurrency(location.stock_value, currencySymbol)}</p>
          </div>
        </div>

        <div className="flex gap-2 border-b border-border pb-3">
          <TabButton active={tab === "stock"} onClick={() => setTab("stock")}>
            <Package size={14} /> Stock ({stockLines.length})
          </TabButton>
          <TabButton active={tab === "lpns"} onClick={() => setTab("lpns")}>
            <MapPin size={14} /> LPNs ({lpns.length})
          </TabButton>
          <TabButton active={tab === "activity"} onClick={() => setTab("activity")}>
            <ClipboardList size={14} /> Activity ({logs.length})
          </TabButton>
        </div>

        {isLoading ? (
          <p className="text-muted py-4">Loading...</p>
        ) : tab === "stock" ? (
          stockLines.length === 0 ? (
            <p className="text-muted py-4">No stock at this location.</p>
          ) : (
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-sm" role="grid" aria-label="Stock at location">
                <thead>
                  <tr className="bg-app text-left text-muted">
                    <th className="px-3 py-2 font-medium">Product</th>
                    <th className="px-3 py-2 font-medium">SKU</th>
                    <th className="px-3 py-2 font-medium">Lot</th>
                    <th className="px-3 py-2 font-medium">LPN</th>
                    <th className="px-3 py-2 font-medium text-right">Qty</th>
                    <th className="px-3 py-2 font-medium text-right">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {stockLines.map((sl) => (
                    <tr key={sl.id}>
                      <td className="px-3 py-2 font-medium">{sl.product_name}</td>
                      <td className="px-3 py-2 text-muted">{sl.sku}</td>
                      <td className="px-3 py-2 text-muted">{sl.lot_number || "—"}</td>
                      <td className="px-3 py-2 text-muted">{sl.lpn_number || "—"}</td>
                      <td className="px-3 py-2 text-right">{sl.quantity}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(sl.value, currencySymbol)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : tab === "lpns" ? (
          lpns.length === 0 ? (
            <p className="text-muted py-4">No LPNs at this location.</p>
          ) : (
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-sm" role="grid" aria-label="LPNs at location">
                <thead>
                  <tr className="bg-app text-left text-muted">
                    <th className="px-3 py-2 font-medium">LPN</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium text-right">Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lpns.map((l) => (
                    <tr key={l.id}>
                      <td className="px-3 py-2 font-medium">{l.lpn_number}</td>
                      <td className="px-3 py-2 text-muted capitalize">{l.lpn_type}</td>
                      <td className="px-3 py-2">
                        <span className={`badge ${l.status === "active" ? "badge-success" : "badge-warning"}`}>{l.status}</span>
                      </td>
                      <td className="px-3 py-2 text-right">{l.total_quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : logs.length === 0 ? (
          <p className="text-muted py-4">No activity recorded for this location.</p>
        ) : (
          <ul className="divide-y divide-border max-h-72 overflow-y-auto">
            {logs.map((log) => (
              <li key={log.id} className="py-2 flex items-start gap-2">
                <span className={`badge shrink-0 ${actionColors[log.action] || "badge-info"}`}>{log.action}</span>
                <div className="min-w-0">
                  <p className="text-ink">{log.description}</p>
                  <p className="text-xs text-muted">
                    by {log.username || `User #${log.user_id}`} · {new Date(log.created_at).toLocaleString()}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium ${
        active ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400" : "text-muted hover:bg-app"
      }`}
    >
      {children}
    </button>
  );
}
