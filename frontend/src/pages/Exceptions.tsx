import { useState } from "react";
import { AlertTriangle, PackageX, ShieldAlert, ClipboardList, Truck, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import type { ExceptionsReport, LotGenealogy } from "../types";
import Skeleton from "../components/Skeleton";
import Modal from "../components/Modal";

type Section = "low_stock" | "zero_stock" | "quarantined_lots" | "open_cycle_counts" | "pending_asns";

export default function Exceptions() {
  const [section, setSection] = useState<Section>("low_stock");
  const { data, isLoading } = useQuery({
    queryKey: ["exceptions"],
    queryFn: async () => {
      const { data } = await api.get("/reports/exceptions");
      return data as ExceptionsReport;
    },
  });

  const sections: { key: Section; label: string; icon: typeof AlertTriangle; color: string }[] = [
    { key: "low_stock", label: "Low Stock", icon: AlertTriangle, color: "bg-amber-100 text-amber-700" },
    { key: "zero_stock", label: "Out of Stock", icon: PackageX, color: "bg-red-100 text-red-700" },
    { key: "quarantined_lots", label: "Quarantined Lots", icon: ShieldAlert, color: "bg-orange-100 text-orange-700" },
    { key: "open_cycle_counts", label: "Open Cycle Counts", icon: ClipboardList, color: "bg-indigo-100 text-indigo-700" },
    { key: "pending_asns", label: "Pending ASNs", icon: Truck, color: "bg-blue-100 text-blue-700" },
  ];

  if (isLoading) return <Skeleton rows={8} cols={4} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Exceptions Dashboard</h1>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {sections.map((s) => {
          const count = data.summary[s.key] ?? 0;
          const Icon = s.icon;
          return (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              className={`card p-4 text-left hover:shadow transition-shadow ${section === s.key ? "ring-2 ring-indigo-400" : ""}`}
              aria-label={`Show ${s.label}`}
            >
              <div className="flex items-center justify-between">
                <span className={`p-2 rounded-lg ${s.color}`}><Icon size={20} /></span>
                <span className="text-2xl font-bold">{count}</span>
              </div>
              <p className="mt-2 text-sm font-medium text-gray-600">{s.label}</p>
            </button>
          );
        })}
      </div>

      <div className="card overflow-hidden p-0">
        <div className="px-4 py-3 bg-gray-50 border-b font-medium text-gray-700 capitalize">{section.replace(/_/g, " ")}</div>
        <div className="p-4">
          {section === "low_stock" && <LowStockTable data={data} />}
          {section === "zero_stock" && <ZeroStockTable data={data} />}
          {section === "quarantined_lots" && <QuarantineTable data={data} />}
          {section === "open_cycle_counts" && <CycleCountTable data={data} />}
          {section === "pending_asns" && <AsnTable data={data} />}
        </div>
      </div>
    </div>
  );
}

function LowStockTable({ data }: { data: ExceptionsReport }) {
  if (data.low_stock.length === 0) return <p className="text-sm text-gray-500">No low stock items.</p>;
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-left text-gray-600 border-b"><th className="py-2">Product</th><th className="py-2">SKU</th><th className="py-2">On Hand</th><th className="py-2">Reorder</th><th className="py-2">Category</th><th className="py-2">Supplier</th></tr></thead>
      <tbody className="divide-y divide-gray-100">
        {data.low_stock.map((p) => (
          <tr key={p.id}>
            <td className="py-2 font-medium">{p.name}</td>
            <td className="py-2 text-gray-500">{p.sku}</td>
            <td className="py-2"><span className={p.quantity <= 0 ? "text-red-600 font-medium" : "text-amber-600 font-medium"}>{p.quantity}</span></td>
            <td className="py-2 text-gray-500">{p.reorder_level}</td>
            <td className="py-2 text-gray-500">{p.category || "—"}</td>
            <td className="py-2 text-gray-500">{p.supplier || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ZeroStockTable({ data }: { data: ExceptionsReport }) {
  if (data.zero_stock.length === 0) return <p className="text-sm text-gray-500">No out-of-stock items.</p>;
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-left text-gray-600 border-b"><th className="py-2">Product</th><th className="py-2">SKU</th></tr></thead>
      <tbody className="divide-y divide-gray-100">
        {data.zero_stock.map((p) => (
          <tr key={p.id}>
            <td className="py-2 font-medium">{p.name}</td>
            <td className="py-2 text-gray-500">{p.sku}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function QuarantineTable({ data }: { data: ExceptionsReport }) {
  const [recallLot, setRecallLot] = useState<(typeof data.quarantined_lots)[number] | null>(null);
  if (data.quarantined_lots.length === 0) return <p className="text-sm text-gray-500">No quarantined lots.</p>;
  return (
    <div>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-gray-600 border-b"><th className="py-2">Lot</th><th className="py-2">Product</th><th className="py-2">On Hand</th><th className="py-2">Expiry</th><th className="py-2">Received</th><th className="py-2">Actions</th></tr></thead>
        <tbody className="divide-y divide-gray-100">
          {data.quarantined_lots.map((l) => (
            <tr key={l.id}>
              <td className="py-2 font-medium">{l.lot_number}</td>
              <td className="py-2 text-gray-500">{l.product_name}</td>
              <td className="py-2 text-orange-600 font-medium">{l.on_hand}</td>
              <td className="py-2 text-gray-500">{l.expiry_date ? new Date(l.expiry_date).toLocaleDateString() : "—"}</td>
              <td className="py-2 text-gray-500">{new Date(l.received_date).toLocaleDateString()}</td>
              <td className="py-2">
                <button onClick={() => setRecallLot(l)} className="btn-secondary text-xs py-1 px-2 inline-flex items-center gap-1">
                  <Search size={12} /> Recall
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {recallLot && <RecallModal lot={recallLot} onClose={() => setRecallLot(null)} />}
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
        <p className="text-gray-600">
          Quarantined lot <span className="font-medium text-gray-900">{lot.lot_number}</span> ({lot.product_name}).
          Any finished good made from this lot is listed below.
        </p>
        {isLoading ? (
          <div className="text-gray-400">Loading genealogy...</div>
        ) : !data || data.affected.length === 0 ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-700">
            No downstream finished goods consumed this lot. Impact is limited to the lot itself.
          </div>
        ) : (
          <div>
            <p className="font-medium text-gray-700 mb-2">Affected downstream lots ({data.affected.length})</p>
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-3 py-2 font-medium text-gray-600">Depth</th>
                    <th className="px-3 py-2 font-medium text-gray-600">Product</th>
                    <th className="px-3 py-2 font-medium text-gray-600">Lot</th>
                    <th className="px-3 py-2 font-medium text-gray-600">Qty Consumed</th>
                    <th className="px-3 py-2 font-medium text-gray-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.affected.map((a) => (
                    <tr key={`${a.lot_id}-${a.depth}`}>
                      <td className="px-3 py-2 text-gray-500">Level {a.depth}</td>
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
            <p className="font-medium text-gray-700 mb-2">Source lots (upstream)</p>
            <div className="flex flex-wrap gap-2">
              {data.parents.map((p) => (
                <span key={p.lot_id} className="badge bg-gray-100 text-gray-700 border border-gray-200">
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
  if (data.open_cycle_counts.length === 0) return <p className="text-sm text-gray-500">No open cycle counts.</p>;
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-left text-gray-600 border-b"><th className="py-2">Count #</th><th className="py-2">Location</th><th className="py-2">Status</th><th className="py-2">Expected</th><th className="py-2">Variance</th><th className="py-2">Date</th></tr></thead>
      <tbody className="divide-y divide-gray-100">
        {data.open_cycle_counts.map((c) => (
          <tr key={c.id}>
            <td className="py-2 font-medium">{c.cc_number}</td>
            <td className="py-2 text-gray-500">{c.location || "—"}</td>
            <td className="py-2"><span className="badge badge-info">{c.status}</span></td>
            <td className="py-2">{c.total_expected}</td>
            <td className={`py-2 font-medium ${c.total_variance !== 0 ? "text-orange-600" : "text-gray-400"}`}>{c.total_variance > 0 ? "+" : ""}{c.total_variance}</td>
            <td className="py-2 text-gray-500">{new Date(c.created_at).toLocaleDateString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AsnTable({ data }: { data: ExceptionsReport }) {
  if (data.pending_asns.length === 0) return <p className="text-sm text-gray-500">No pending ASNs.</p>;
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-left text-gray-600 border-b"><th className="py-2">ASN #</th><th className="py-2">Supplier</th><th className="py-2">Expected Arrival</th><th className="py-2">Items Pending</th></tr></thead>
      <tbody className="divide-y divide-gray-100">
        {data.pending_asns.map((a) => (
          <tr key={a.id}>
            <td className="py-2 font-medium">{a.asn_number}</td>
            <td className="py-2 text-gray-500">{a.supplier || "—"}</td>
            <td className="py-2 text-gray-500">{a.expected_arrival ? new Date(a.expected_arrival).toLocaleDateString() : "—"}</td>
            <td className="py-2">{a.items_pending}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
