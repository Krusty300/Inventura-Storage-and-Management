import { useDateFormat } from "../hooks/useDateFormat";
import { useState } from "react";
import { Eye, Fingerprint, ShieldCheck, ShieldX } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { PaginatedResponse, SerialNumber, StockMovement } from "../types";
import Modal from "../components/Modal";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import QuarantineSerialModal from "../components/QuarantineSerialModal";
import { useDebounce } from "../hooks/useDebounce";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useExportCsv } from "../hooks/useExportCsv";

import { usePageSize } from "../hooks/usePageSize";

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "in_stock", label: "In Stock" },
  { value: "reserved", label: "Reserved" },
  { value: "sold", label: "Sold" },
  { value: "quarantined", label: "Quarantined" },
  { value: "inactive", label: "Inactive" },
  { value: "scrapped", label: "Scrapped" },
] as const;

function statusBadge(status: string) {
  switch (status) {
    case "in_stock": return "badge-success";
    case "reserved": return "badge-info";
    case "sold": return "badge-neutral";
    case "quarantined": return "badge-warning";
    case "inactive": return "badge-neutral";
    case "scrapped": return "badge-danger";
    default: return "";
  }
}

export default function SerialNumbers() {
  const formatDate = useDateFormat();
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
  const [viewing, setViewing] = useState<SerialNumber | null>(null);
  const [quarantining, setQuarantining] = useState<SerialNumber | null>(null);
  const debouncedSearch = useDebounce(search, 300);
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { addToast } = useToast();
  const { exportCsv } = useExportCsv();

  const handleExport = () => {
    const params: Record<string, string> = {};
    if (debouncedSearch) params.search = debouncedSearch;
    if (status) params.status = status;
    exportCsv("/serial-numbers/export", "serial_numbers_report.csv", "Serial numbers report", params);
  };

  const { data, isLoading } = useQuery({
    queryKey: ["serial-numbers", debouncedSearch, status, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() };
      if (debouncedSearch) params.search = debouncedSearch;
      if (status) params.status = status;
      const { data } = await api.get("/serial-numbers", { params });
      return data as PaginatedResponse<SerialNumber>;
    },
  });

  const serials = data?.items || [];

  const releaseMutation = useMutation({
    mutationFn: (id: number) => api.put(`/serial-numbers/${id}/status`, { status: "in_stock" }),
    onSuccess: () => {
      addToast("Serial released from quarantine", "success");
      queryClient.invalidateQueries({ queryKey: ["serial-numbers"] });
      queryClient.invalidateQueries({ queryKey: ["exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (err: any) => addToast(err.response?.data?.detail || "Cannot release serial", "error"),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Serial Numbers</h1>
        <button onClick={handleExport} className="btn-secondary" aria-label="Export serial numbers to CSV">Export</button>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 max-w-md">
          <input className="input pl-10" placeholder="Search by serial number..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search serial numbers" />
        </div>
        <div role="group" aria-label="Filter by status" className="flex items-center gap-1 rounded-lg border border-border bg-subtle p-0.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => { setStatus(f.value); setPage(1); }}
              className={`px-3 py-1 rounded-md text-sm transition-colors ${status === f.value ? "bg-surface text-indigo-600 dark:text-indigo-400 shadow-sm" : "text-muted hover:text-ink"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
        <table className="w-full text-sm" role="grid" aria-label="Serial numbers table">
          <thead>
            <tr className="bg-app text-left">
              <th className="px-4 py-3 font-medium text-muted">Serial #</th>
              <th className="px-4 py-3 font-medium text-muted">Product</th>
              <th className="px-4 py-3 font-medium text-muted">Lot</th>
              <th className="px-4 py-3 font-medium text-muted">Location</th>
              <th className="px-4 py-3 font-medium text-muted">Status</th>
              <th className="px-4 py-3 font-medium text-muted">Sold</th>
              <th className="px-4 py-3 font-medium text-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <Skeleton rows={5} cols={7} />
            ) : serials.length === 0 ? (
              <EmptyState title="No serial numbers yet" message="Serialized products are tracked individually. Record a receipt for a serialized product to create serial numbers." />
            ) : serials.map((s) => (
              <tr key={s.id} className="hover:bg-app">
                <td className="px-4 py-3 font-medium font-mono">{s.serial_number}</td>
                <td className="px-4 py-3 text-muted">{s.product_name}</td>
                <td className="px-4 py-3 text-muted">{s.lot_number || "—"}</td>
                <td className="px-4 py-3 text-muted">{s.location_name || "—"}</td>
                <td className="px-4 py-3">{statusBadge(s.status) ? <span className={`badge ${statusBadge(s.status)}`}>{s.status}</span> : <span className="text-muted capitalize">{s.status}</span>}</td>
                <td className="px-4 py-3 text-muted">{s.sold_at ? formatDate(s.sold_at) : "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    {can("serial_numbers.update") && s.status === "quarantined" && (
                      <button
                        onClick={() => releaseMutation.mutate(s.id)}
                        disabled={releaseMutation.isPending}
                        className="p-1 text-faint hover:text-green-600 dark:text-green-400"
                        title="Release from quarantine"
                        aria-label={`Release ${s.serial_number}`}
                      >
                        <ShieldCheck size={16} />
                      </button>
                    )}
                    {can("stock.record") && s.status === "in_stock" && s.location_name && (
                      <button
                        onClick={() => setQuarantining(s)}
                        className="p-1 text-faint hover:text-amber-600 dark:text-amber-400"
                        title="Quarantine"
                        aria-label={`Quarantine ${s.serial_number}`}
                      >
                        <ShieldX size={16} />
                      </button>
                    )}
                    <button onClick={() => setViewing(s)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`View ${s.serial_number}`}><Eye size={16} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <Pagination page={page} totalPages={data?.pages || 1} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />

      {viewing && <SerialDetail serial={viewing} onClose={() => setViewing(null)} />}
      {quarantining && (
        <QuarantineSerialModal
          serial={quarantining}
          onClose={() => setQuarantining(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["serial-numbers"] });
            queryClient.invalidateQueries({ queryKey: ["exceptions"] });
            queryClient.invalidateQueries({ queryKey: ["products"] });
          }}
        />
      )}
    </div>
  );
}

function SerialDetail({ serial, onClose }: { serial: SerialNumber; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { addToast } = useToast();
  const [status, setStatus] = useState(serial.status);
  const [quarantining, setQuarantining] = useState(false);

  const statusMutation = useMutation({
    mutationFn: (next: string) => api.put(`/serial-numbers/${serial.id}/status`, { status: next }),
    onSuccess: (_res, next) => {
      setStatus(next);
      const message =
        next === "inactive" ? `Serial ${serial.serial_number} deactivated`
        : next === "in_stock" && serial.status === "quarantined" ? `Serial ${serial.serial_number} released from quarantine`
        : `Serial ${serial.serial_number} activated`;
      addToast(message, "success");
      queryClient.invalidateQueries({ queryKey: ["serial-numbers"] });
      queryClient.invalidateQueries({ queryKey: ["serial-movements", serial.id] });
      queryClient.invalidateQueries({ queryKey: ["exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (err: any) => addToast(err.response?.data?.detail || "Cannot update serial", "error"),
  });

  const { data: movements, isLoading } = useQuery({
    queryKey: ["serial-movements", serial.id],
    queryFn: async () => {
      const { data } = await api.get(`/serial-numbers/${serial.id}/movements`);
      return data as StockMovement[];
    },
  });

  const canToggle = can("serial_numbers.update") && (status === "in_stock" || status === "inactive" || status === "quarantined");

  return (
    <Modal open onClose={onClose} title={`Serial ${serial.serial_number}`} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-muted">Product</p>
            <p className="font-medium">{serial.product_name}</p>
          </div>
          <div>
            <p className="text-muted">Lot</p>
            <p className="font-medium">{serial.lot_number || "—"}</p>
          </div>
          <div>
            <p className="text-muted">Location</p>
            <p className="font-medium">{serial.location_name || "—"}</p>
          </div>
          <div>
            <p className="text-muted">Status</p>
            <p className="font-medium">{statusBadge(status) ? <span className={`badge ${statusBadge(status)}`}>{status}</span> : <span className="capitalize">{status}</span>}</p>
          </div>
        </div>

        <div className="border border-border rounded-lg overflow-hidden">
          <div className="bg-app px-4 py-2 flex items-center gap-2">
            <Fingerprint size={14} className="text-muted" />
            <span className="text-sm font-medium text-ink">Movements</span>
          </div>
          {isLoading ? (
            <p className="text-sm text-muted px-4 py-3">Loading...</p>
          ) : !movements || movements.length === 0 ? (
            <p className="text-sm text-muted px-4 py-3">No movements recorded for this serial number.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-app text-left">
                  <th className="px-4 py-2 font-medium text-muted">Date</th>
                  <th className="px-4 py-2 font-medium text-muted">Type</th>
                  <th className="px-4 py-2 font-medium text-muted">Qty</th>
                  <th className="px-4 py-2 font-medium text-muted">User</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-2 text-muted">{new Date(m.created_at).toLocaleString()}</td>
                    <td className="px-4 py-2 capitalize">{m.movement_type}</td>
                    <td className={`px-4 py-2 ${m.quantity_change < 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                      {m.quantity_change > 0 ? `+${m.quantity_change}` : m.quantity_change}
                    </td>
                    <td className="px-4 py-2 text-muted">{m.username}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          {canToggle && status === "quarantined" && (
            <button onClick={() => statusMutation.mutate("in_stock")} disabled={statusMutation.isPending} className="btn-primary inline-flex items-center gap-1">
              <ShieldCheck size={14} /> Release
            </button>
          )}
          {canToggle && status === "in_stock" && serial.location_name && (
            <button onClick={() => setQuarantining(true)} className="btn-secondary inline-flex items-center gap-1">
              <ShieldX size={14} /> Quarantine
            </button>
          )}
          {canToggle && status === "in_stock" && (
            <button onClick={() => statusMutation.mutate("inactive")} disabled={statusMutation.isPending} className="btn-danger">
              Deactivate
            </button>
          )}
          {canToggle && status === "inactive" && (
            <button onClick={() => statusMutation.mutate("in_stock")} disabled={statusMutation.isPending} className="btn-secondary">
              Activate
            </button>
          )}
          <button onClick={onClose} className="btn-secondary">Close</button>
        </div>
      </div>
      {quarantining && (
        <QuarantineSerialModal
          serial={{ ...serial, status }}
          onClose={() => setQuarantining(false)}
          onSaved={() => {
            setQuarantining(false);
            setStatus("quarantined");
            queryClient.invalidateQueries({ queryKey: ["serial-numbers"] });
            queryClient.invalidateQueries({ queryKey: ["serial-movements", serial.id] });
            queryClient.invalidateQueries({ queryKey: ["exceptions"] });
            queryClient.invalidateQueries({ queryKey: ["products"] });
          }}
        />
      )}
    </Modal>
  );
}
