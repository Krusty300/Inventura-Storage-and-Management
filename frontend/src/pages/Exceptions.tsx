import { useDateFormat } from "../hooks/useDateFormat";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, PackageX, ShieldAlert, ShieldCheck, ClipboardList, Truck, Search, Tags, Undo2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { ExceptionsReport, LotGenealogy } from "../types";
import Skeleton from "../components/Skeleton";
import Modal from "../components/Modal";
import ConfirmDialog from "../components/ConfirmDialog";
import ErrorState from "../components/ErrorState";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { errorMessage } from "../utils/errors";


type Section = "quality_checks" | "low_stock" | "zero_stock" | "quarantined_lots" | "quarantined_serials" | "open_cycle_counts" | "pending_asns";

const SECTIONS: { key: Section; label: string; icon: typeof AlertTriangle; color: string }[] = [
  { key: "quality_checks", label: "Quality Checks", icon: ShieldCheck, color: "bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400" },
  { key: "low_stock", label: "Low Stock", icon: AlertTriangle, color: "bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  { key: "zero_stock", label: "Out of Stock", icon: PackageX, color: "bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400" },
  { key: "quarantined_lots", label: "Quarantined Lots", icon: ShieldAlert, color: "bg-orange-100 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400" },
  { key: "quarantined_serials", label: "Quarantined Serials", icon: Tags, color: "bg-orange-100 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400" },
  { key: "open_cycle_counts", label: "Open Cycle Counts", icon: ClipboardList, color: "bg-sky-100 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  { key: "pending_asns", label: "Pending ASNs", icon: Truck, color: "bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400" },
];

export default function Exceptions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [section, setSection] = useState<Section>(() => {
    const requested = searchParams.get("section");
    return SECTIONS.some((s) => s.key === requested) ? (requested as Section) : "quality_checks";
  });
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["exceptions"],
    queryFn: async () => {
      const { data } = await api.get("/reports/exceptions");
      return data as ExceptionsReport;
    },
  });

  useEffect(() => {
    const s = searchParams.get("section") as Section | null;
    if (s && SECTIONS.some((x) => x.key === s)) setSection(s);
  }, [searchParams]);

  const selectSection = (s: Section) => {
    setSection(s);
    setSearchParams({ section: s }, { replace: true });
  };

  if (isLoading) return <Skeleton variant="rows" rows={8} cols={4} />;
  if (isError) return <ErrorState variant="block" title="Failed to load exceptions" onRetry={() => queryClient.invalidateQueries({ queryKey: ["exceptions"] })} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 min-w-0">
        <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
          <ShieldAlert size={22} strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-ink">Exceptions Dashboard</h1>
          <p className="text-sm text-muted mt-0.5">Quarantined, expired, and blocked stock that needs attention.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        {SECTIONS.map((s) => {
          const count = data.summary[s.key] ?? 0;
          const Icon = s.icon;
          return (
            <button
              key={s.key}
              onClick={() => selectSection(s.key)}
              className={`card p-4 text-left hover:shadow transition-shadow ${section === s.key ? "ring-2 ring-primary" : ""}`}
              aria-label={`Show ${s.label}`}
            >
              <div className="flex items-center justify-between">
                <span className={`p-2 rounded-lg ${s.color}`}><Icon size={20} /></span>
                <span className="text-2xl font-bold">{count}</span>
              </div>
              <p className="mt-2 text-sm font-medium text-muted">{s.label}</p>
            </button>
          );
        })}
      </div>

      <div className="card overflow-hidden p-0">
        <div className="px-4 py-3 bg-app border-b font-medium text-ink flex items-center justify-between gap-4">
          <span>{SECTIONS.find((s) => s.key === section)?.label}</span>
          {(section === "quarantined_lots" || section === "quarantined_serials") && (
            <span className="text-xs font-normal text-muted">
              {data.summary.quarantined_units ?? 0} units quarantined · {data.summary.quarantined_lots ?? 0} lots · {data.summary.quarantined_serials ?? 0} serials
            </span>
          )}
        </div>
        <div className="p-4 overflow-x-auto">
          {section === "quality_checks" && <QualityCheckTable data={data} />}
          {section === "low_stock" && <LowStockTable data={data} />}
          {section === "zero_stock" && <ZeroStockTable data={data} />}
          {section === "quarantined_lots" && <QuarantineTable data={data} />}
          {section === "quarantined_serials" && <QuarantineSerialTable data={data} />}
          {section === "open_cycle_counts" && <CycleCountTable data={data} />}
          {section === "pending_asns" && <AsnTable data={data} />}
        </div>
      </div>
    </div>
  );
}

function QualityCheckTable({ data }: { data: ExceptionsReport }) {
  if (!data.quality_checks || data.quality_checks.length === 0) return <p className="text-sm text-muted">No pending or failed quality checks.</p>;
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-left text-muted border-b"><th className="py-2">QC #</th><th className="py-2">Product</th><th className="py-2">Location</th><th className="py-2">Lot</th><th className="py-2">Result</th></tr></thead>
      <tbody className="divide-y divide-border">
        {data.quality_checks.map((q) => (
          <tr key={q.id}>
            <td className="py-2 font-medium">{q.qc_number}</td>
            <td className="py-2 text-muted">{q.product_name}</td>
            <td className="py-2 text-muted">{q.location_name}</td>
            <td className="py-2 text-muted">{q.lot_number || "—"}</td>
            <td className="py-2"><span className={`badge ${q.result === "fail" ? "badge-danger" : "badge-warning"}`}>{q.result}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LowStockTable({ data }: { data: ExceptionsReport }) {
  if (data.low_stock.length === 0) return <p className="text-sm text-muted">No low stock items.</p>;
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-left text-muted border-b"><th className="py-2">Product</th><th className="py-2">SKU</th><th className="py-2">On Hand</th><th className="py-2">Reorder</th><th className="py-2">Category</th><th className="py-2">Supplier</th></tr></thead>
      <tbody className="divide-y divide-border">
        {data.low_stock.map((p) => (
          <tr key={p.id}>
            <td className="py-2 font-medium">{p.name}</td>
            <td className="py-2 text-muted">{p.sku}</td>
            <td className="py-2"><span className={p.quantity <= 0 ? "text-red-600 dark:text-red-400 font-medium" : "text-amber-600 dark:text-amber-400 font-medium"}>{p.quantity}</span></td>
            <td className="py-2 text-muted">{p.reorder_level}</td>
            <td className="py-2 text-muted">{p.category || "—"}</td>
            <td className="py-2 text-muted">{p.supplier || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ZeroStockTable({ data }: { data: ExceptionsReport }) {
  if (data.zero_stock.length === 0) return <p className="text-sm text-muted">No out-of-stock items.</p>;
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-left text-muted border-b"><th className="py-2">Product</th><th className="py-2">SKU</th></tr></thead>
      <tbody className="divide-y divide-border">
        {data.zero_stock.map((p) => (
          <tr key={p.id}>
            <td className="py-2 font-medium">{p.name}</td>
            <td className="py-2 text-muted">{p.sku}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function QuarantineTable({ data }: { data: ExceptionsReport }) {
  const formatDate = useDateFormat();
  const [recallLot, setRecallLot] = useState<(typeof data.quarantined_lots)[number] | null>(null);
  const [releaseTarget, setReleaseTarget] = useState<(typeof data.quarantined_lots)[number] | null>(null);
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { addToast } = useToast();
  const [releasing, setReleasing] = useState<number | null>(null);
  if (data.quarantined_lots.length === 0) return <p className="text-sm text-muted">No quarantined lots.</p>;

  const confirmRelease = async () => {
    if (!releaseTarget) return;
    const lot = releaseTarget;
    setReleaseTarget(null);
    setReleasing(lot.id);
    try {
      await api.put(`/lots/${lot.id}`, { status: "in_stock" });
      addToast(`Lot ${lot.lot_number} released`, "success");
      queryClient.invalidateQueries({ queryKey: ["exceptions"] });
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to release lot"), "error");
    } finally {
      setReleasing(null);
    }
  };

  return (
    <div>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-muted border-b"><th className="py-2">Lot</th><th className="py-2">Product</th><th className="py-2">On Hand</th><th className="py-2">Expiry</th><th className="py-2">Received</th><th className="py-2">Actions</th></tr></thead>
        <tbody className="divide-y divide-border">
          {data.quarantined_lots.map((l) => (
            <tr key={l.id}>
              <td className="py-2 font-medium">{l.lot_number}</td>
              <td className="py-2 text-muted">{l.product_name}</td>
              <td className="py-2 text-orange-600 dark:text-orange-400 font-medium">{l.on_hand}</td>
              <td className="py-2 text-muted">{l.expiry_date ? formatDate(l.expiry_date) : "—"}</td>
              <td className="py-2 text-muted">{formatDate(l.received_date)}</td>
              <td className="py-2">
                <div className="flex gap-2">
                  <button onClick={() => setRecallLot(l)} className="btn-secondary text-xs py-1 px-2 inline-flex items-center gap-1">
                    <Search size={12} /> Recall
                  </button>
                  {can("lots.update") && (
                    <button onClick={() => setReleaseTarget(l)} disabled={releasing === l.id}
                      className="btn-primary text-xs py-1 px-2 inline-flex items-center gap-1">
                      <Undo2 size={12} /> {releasing === l.id ? "Releasing..." : "Release"}
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {recallLot && <RecallModal lot={recallLot} onClose={() => setRecallLot(null)} />}
      <ConfirmDialog
        open={!!releaseTarget}
        title="Release Quarantined Lot"
        message={`Release lot ${releaseTarget?.lot_number} back to sellable stock?`}
        confirmLabel="Release Lot"
        confirmClass="btn-primary"
        onConfirm={confirmRelease}
        onCancel={() => setReleaseTarget(null)}
      />
    </div>
  );
}

function QuarantineSerialTable({ data }: { data: ExceptionsReport }) {
  const [releaseTarget, setReleaseTarget] = useState<(typeof data.quarantined_serials)[number] | null>(null);
  const [releasing, setReleasing] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { addToast } = useToast();
  const serials = data.quarantined_serials ?? [];
  if (serials.length === 0) return <p className="text-sm text-muted">No quarantined serials.</p>;

  const confirmRelease = async () => {
    if (!releaseTarget) return;
    const serial = releaseTarget;
    setReleaseTarget(null);
    setReleasing(serial.id);
    try {
      await api.put(`/serial-numbers/${serial.id}/status`, { status: "in_stock" });
      addToast(`Serial ${serial.serial_number} released`, "success");
      queryClient.invalidateQueries({ queryKey: ["exceptions"] });
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to release serial"), "error");
    } finally {
      setReleasing(null);
    }
  };

  return (
    <div>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-muted border-b"><th className="py-2">Serial</th><th className="py-2">Product</th><th className="py-2">Location</th><th className="py-2">Lot</th><th className="py-2">Actions</th></tr></thead>
        <tbody className="divide-y divide-border">
          {serials.map((s) => (
            <tr key={s.id}>
              <td className="py-2 font-medium">{s.serial_number}</td>
              <td className="py-2 text-muted">{s.product_name}</td>
              <td className="py-2 text-muted">{s.location_name || "—"}</td>
              <td className="py-2 text-muted">{s.lot_number || "—"}</td>
              <td className="py-2">
                {can("serial_numbers.update") && (
                  <button onClick={() => setReleaseTarget(s)} disabled={releasing === s.id}
                    aria-label={`Release serial ${s.serial_number}`}
                    className="btn-primary text-xs py-1 px-2 inline-flex items-center gap-1">
                    <Undo2 size={12} /> {releasing === s.id ? "Releasing..." : "Release"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ConfirmDialog
        open={!!releaseTarget}
        title="Release Quarantined Serial"
        message={`Release serial ${releaseTarget?.serial_number} back to sellable stock?`}
        confirmLabel="Release Serial"
        confirmClass="btn-primary"
        onConfirm={confirmRelease}
        onCancel={() => setReleaseTarget(null)}
      />
    </div>
  );
}

function RecallModal({ lot, onClose }: { lot: { id: number; lot_number: string; product_name: string }; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["lot-genealogy", lot.id],
    queryFn: async () => {
      const { data } = await api.get(`/lots/${lot.id}/genealogy`);
      return data as LotGenealogy;
    },
  });
  return (
    <Modal open onClose={onClose} title={`Recall - ${lot.lot_number}`} wide>
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          Quarantined lot <span className="font-medium text-ink">{lot.lot_number}</span> ({lot.product_name}).
          Any finished good made from this lot is listed below.
        </p>
        {isLoading ? (
          <Skeleton variant="rows" rows={2} cols={3} />
        ) : !data || data.affected.length === 0 ? (
          <div className="rounded-lg border border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/10 p-4 text-green-700 dark:text-green-400">
            No downstream finished goods consumed this lot. Impact is limited to the lot itself.
          </div>
        ) : (
          <div>
            <p className="font-medium text-ink mb-2">Affected downstream lots ({data.affected.length})</p>
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-app text-left">
                    <th scope="col" className="px-3 py-2 font-medium text-muted">Depth</th>
                    <th scope="col" className="px-3 py-2 font-medium text-muted">Product</th>
                    <th scope="col" className="px-3 py-2 font-medium text-muted">Lot</th>
                    <th scope="col" className="px-3 py-2 font-medium text-muted">Qty Consumed</th>
                    <th scope="col" className="px-3 py-2 font-medium text-muted">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.affected.map((a) => (
                    <tr key={`${a.lot_id}-${a.depth}`}>
                      <td className="px-3 py-2 text-muted">Level {a.depth}</td>
                      <td className="px-3 py-2 font-medium">{a.product_name}</td>
                      <td className="px-3 py-2">{a.lot_number}</td>
                      <td className="px-3 py-2">{a.quantity}</td>
                      <td className="px-3 py-2">
                        <span className={`badge ${a.status === "quarantined" ? "badge-danger" : a.status === "in_stock" ? "badge-success" : "badge-warning"}`}>{a.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {data && data.parents.length > 0 && (
          <div>
            <p className="font-medium text-ink mb-2">Source lots (upstream)</p>
            <div className="flex flex-wrap gap-2">
              {data.parents.map((p) => (
                <span key={p.lot_id} className="badge bg-subtle text-ink border border-border">
                  {p.product_name}: {p.lot_number} ({p.quantity} used)
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="flex justify-end pt-2">
          <button onClick={onClose} className="btn-secondary">Close</button>
        </div>
      </div>
    </Modal>
  );
}

function CycleCountTable({ data }: { data: ExceptionsReport }) {
  const formatDate = useDateFormat();
  if (data.open_cycle_counts.length === 0) return <p className="text-sm text-muted">No open cycle counts.</p>;
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-left text-muted border-b"><th className="py-2">Count #</th><th className="py-2">Location</th><th className="py-2">Status</th><th className="py-2">Expected</th><th className="py-2">Variance</th><th className="py-2">Date</th></tr></thead>
      <tbody className="divide-y divide-border">
        {data.open_cycle_counts.map((c) => (
          <tr key={c.id}>
            <td className="py-2 font-medium">{c.cc_number}</td>
            <td className="py-2 text-muted">{c.location || "—"}</td>
            <td className="py-2"><span className="badge badge-info">{c.status}</span></td>
            <td className="py-2">{c.total_expected}</td>
            <td className={`py-2 font-medium ${c.total_variance !== 0 ? "text-orange-600 dark:text-orange-400" : "text-faint"}`}>{c.total_variance > 0 ? "+" : ""}{c.total_variance}</td>
            <td className="py-2 text-muted">{formatDate(c.created_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AsnTable({ data }: { data: ExceptionsReport }) {
  const formatDate = useDateFormat();
  if (data.pending_asns.length === 0) return <p className="text-sm text-muted">No pending ASNs.</p>;
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-left text-muted border-b"><th className="py-2">ASN #</th><th className="py-2">Supplier</th><th className="py-2">Expected Arrival</th><th className="py-2">Items Pending</th></tr></thead>
      <tbody className="divide-y divide-border">
        {data.pending_asns.map((a) => (
          <tr key={a.id}>
            <td className="py-2 font-medium">{a.asn_number}</td>
            <td className="py-2 text-muted">{a.supplier || "—"}</td>
            <td className="py-2 text-muted">{a.expected_arrival ? formatDate(a.expected_arrival) : "—"}</td>
            <td className="py-2">{a.items_pending}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
