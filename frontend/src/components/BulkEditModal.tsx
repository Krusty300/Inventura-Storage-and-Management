import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Modal from "./Modal";
import api from "../api/client";
import type { Supplier, Category } from "../types";

interface Props {
  ids: number[];
  onClose: () => void;
  onSaved: () => void;
}

export default function BulkEditModal({ ids, onClose, onSaved }: Props) {
  const [supplierId, setSupplierId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [reorderLevel, setReorderLevel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const { data: suppliers } = useQuery<Supplier[]>({
    queryKey: ["suppliers"],
    queryFn: async () => (await api.get("/suppliers")).data.items,
  });

  const { data: categories } = useQuery<Category[]>({
    queryKey: ["categories", 1],
    queryFn: async () => (await api.get("/categories")).data.items,
  });

  const hasChanges = supplierId !== "" || categoryId !== "" || reorderLevel !== "";

  const handleSubmit = async () => {
    if (!hasChanges) return;
    setSubmitting(true);
    setError("");
    try {
      const body: Record<string, any> = { ids };
      if (supplierId !== "") body.supplier_id = parseInt(supplierId);
      if (categoryId !== "") body.category_id = parseInt(categoryId);
      if (reorderLevel !== "") body.reorder_level = parseInt(reorderLevel);
      await api.patch("/products/bulk-edit", body);
      onSaved();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Bulk edit failed");
    }
    setSubmitting(false);
  };

  return (
    <Modal open onClose={onClose} title={`Edit ${ids.length} Product(s)`}>
      <div className="space-y-4">
        <p className="text-sm text-muted">Only fields you change will be updated.</p>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">Supplier</label>
          <select className="select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">— No change —</option>
            {(suppliers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">Category</label>
          <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">— No change —</option>
            {(categories || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">Reorder Level</label>
          <input type="number" min={0} className="input" placeholder="— No change —" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} />
        </div>

        {error && <div className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">{error}</div>}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn-secondary text-sm px-3 py-1.5">Cancel</button>
          <button onClick={handleSubmit} disabled={!hasChanges || submitting} className="btn-primary text-sm px-3 py-1.5">
            {submitting ? "Saving..." : `Update ${ids.length} Product(s)`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
