import { useDateFormat } from "../hooks/useDateFormat";
import { useState } from "react";
import { Eye, FlaskConical, ShieldCheck, ShieldX, CalendarX } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { Lot, PaginatedResponse, StockMovement } from "../types";
import Modal from "../components/Modal";
import ConfirmDialog from "../components/ConfirmDialog";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import { useDebounce } from "../hooks/useDebounce";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";


import { usePageSize } from "../hooks/usePageSize";

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "in_stock", label: "In Stock" },
  { value: "quarantined", label: "Quarantined" },
  { value: "expired", label: "Expired" },
] as const;

function statusBadge(status: string) {
  switch (status) {
    case "in_stock": return "badge-success";
    case "quarantined": return "badge-warning";
    case "expired": return "badge-danger";
    default: return "badge-info";
  }
}

export default function Lots() {
  const formatDate = useDateFormat();
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
  const [viewing, setViewing] = useState<Lot | null>(null);
  const [expiring, setExpiring] = useState<Lot | null>(null);
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { addToast } = useToast();
  const debouncedSearch = useDebounce(search, 300);

  const updateMutation = useMutation({
    mutationFn: ({ id, status: next }: { id: number; status: string }) =>
      api.put(`/lots/${id}`, { status: next }),
    onSuccess: () => {
      addToast("Lot updated", "success");
      queryClient.invalidateQueries({ queryKey: ["lots"] });
      queryClient.invalidateQueries({ queryKey: ["exceptions"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (err: any) => addToast(err.response?.data?.detail || "Cannot update lot", "error"),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["lots", debouncedSearch, status, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() };
      if (debouncedSearch) params.search = debouncedSearch;
      if (status) params.status = status;
      const { data } = await api.get("/lots", { params });
      return data as PaginatedResponse<Lot>;
    },
  });

  const lots = data?.items || [];

  const changeStatus = (lot: Lot, next: string) => {
    updateMutation.mutate({ id: lot.id, status: next });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Lots</h1>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 max-w-md">
          <input className="input pl-10" placeholder="Search by lot number, product, or SKU..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search lots" />
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
        <table className="w-full text-sm" role="grid" aria-label="Lots table">
          <thead>
            <tr className="bg-app text-left">
              <th className="px-4 py-3 font-medium text-muted">Lot #</th>
              <th className="px-4 py-3 font-medium text-muted">Product</th>
              <th className="px-4 py-3 font-medium text-muted">Supplier</th>
              <th className="px-4 py-3 font-medium text-muted">Location</th>
              <th className="px-4 py-3 font-medium text-muted">On Hand</th>
              <th className="px-4 py-3 font-medium text-muted">Expiry</th>
              <th className="px-4 py-3 font-medium text-muted">Received</th>
              <th className="px-4 py-3 font-medium text-muted">Status</th>
              <th className="px-4 py-3 font-medium text-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <Skeleton rows={5} cols={9} />
            ) : lots.length === 0 ? (
              <EmptyState title="No lots yet" message="Lots are created automatically when you record a receipt or finish a work order with a lot number." />
            ) : lots.map((l) => (
              <tr key={l.id} className="hover:bg-app">
                <td className="px-4 py-3 font-medium">{l.lot_number}</td>
                <td className="px-4 py-3 text-muted">{l.product_name}</td>
                <td className="px-4 py-3 text-muted">{l.supplier_name || "—"}</td>
                <td className="px-4 py-3 text-muted">{l.locations?.length ? l.locations.join(", ") : "—"}</td>
                <td className="px-4 py-3">
                  {l.on_hand}
                  {l.serial_count > 0 && <span className="ml-1 text-xs text-muted">({l.serial_count} serial)</span>}
                </td>
                <td className="px-4 py-3 text-muted">{l.expiry_date ? formatDate(l.expiry_date) : "—"}</td>
                <td className="px-4 py-3 text-muted">{formatDate(l.received_date)}</td>
                <td className="px-4 py-3"><span className={`badge ${statusBadge(l.status)}`}>{l.status.replace("_", " ")}</span></td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => setViewing(l)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`View ${l.lot_number}`}><Eye size={16} /></button>
                    {can("lots.update") && l.status === "in_stock" && (
                      <button onClick={() => changeStatus(l, "quarantined")} className="p-1 text-faint hover:text-amber-600 dark:text-amber-400" title="Quarantine" aria-label={`Quarantine ${l.lot_number}`}><ShieldX size={16} /></button>
                    )}
                    {can("lots.update") && l.status === "quarantined" && (
                      <button onClick={() => changeStatus(l, "in_stock")} className="p-1 text-faint hover:text-green-600 dark:text-green-400" title="Release" aria-label={`Release ${l.lot_number}`}><ShieldCheck size={16} /></button>
                    )}
                    {can("lots.update") && (l.status === "in_stock" || l.status === "quarantined") && (
                      <button onClick={() => setExpiring(l)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" title="Mark Expired" aria-label={`Expire ${l.lot_number}`}><CalendarX size={16} /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <Pagination page={page} totalPages={data?.pages || 1} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />

      {viewing && <LotDetail lot={viewing} onClose={() => setViewing(null)} />}

      <ConfirmDialog
        open={!!expiring}
        title="Mark Lot Expired"
        message={`Are you sure you want to mark "${expiring?.lot_number}" as expired? Expired lots cannot be returned to stock.`}
        confirmLabel="Mark Expired"
        confirmClass="btn-danger"
        onConfirm={() => { if (expiring) changeStatus(expiring, "expired"); setExpiring(null); }}
        onCancel={() => setExpiring(null)}
      />
    </div>
  );
}

function LotDetail({ lot, onClose }: { lot: Lot; onClose: () => void }) {
  const formatDate = useDateFormat();
  const { data: movements, isLoading } = useQuery({
    queryKey: ["lot-movements", lot.id],
    queryFn: async () => {
      const { data } = await api.get(`/lots/${lot.id}/movements`);
      return data as StockMovement[];
    },
  });

  return (
    <Modal open onClose={onClose} title={`Lot ${lot.lot_number}`} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-muted">Product</p>
            <p className="font-medium">{lot.product_name}</p>
          </div>
          <div>
            <p className="text-muted">Supplier</p>
            <p className="font-medium">{lot.supplier_name || "—"}</p>
          </div>
          <div>
            <p className="text-muted">Location</p>
            <p className="font-medium">{lot.locations?.length ? lot.locations.join(", ") : "—"}</p>
          </div>
          <div>
            <p className="text-muted">On Hand</p>
            <p className="font-medium">{lot.on_hand}</p>
          </div>
          <div>
            <p className="text-muted">Status</p>
            <p className="font-medium"><span className={`badge ${statusBadge(lot.status)}`}>{lot.status.replace("_", " ")}</span></p>
          </div>
          <div>
            <p className="text-muted">Expiry</p>
            <p className="font-medium">{lot.expiry_date ? formatDate(lot.expiry_date) : "—"}</p>
          </div>
          <div>
            <p className="text-muted">Received</p>
            <p className="font-medium">{formatDate(lot.received_date)}</p>
          </div>
          <div>
            <p className="text-muted">Serial numbers</p>
            <p className="font-medium">{lot.serial_count}</p>
          </div>
        </div>

        <div className="border border-border rounded-lg overflow-hidden">
          <div className="bg-app px-4 py-2 flex items-center gap-2">
            <FlaskConical size={14} className="text-muted" />
            <span className="text-sm font-medium text-ink">Movements</span>
          </div>
          {isLoading ? (
            <p className="text-sm text-muted px-4 py-3">Loading...</p>
          ) : !movements || movements.length === 0 ? (
            <p className="text-sm text-muted px-4 py-3">No movements recorded for this lot.</p>
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

        <div className="flex justify-end pt-2">
          <button onClick={onClose} className="btn-secondary">Close</button>
        </div>
      </div>
    </Modal>
  );
}
