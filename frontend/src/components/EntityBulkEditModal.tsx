import { useState } from "react";
import Modal from "./Modal";
import api from "../api/client";

export interface BulkFieldOption {
  value: string;
  label: string;
}

export interface BulkFieldConfig {
  name: string;
  label: string;
  type: "text" | "number" | "select";
  options?: BulkFieldOption[];
  clearValue?: string;
  valueType?: "string" | "number" | "boolean";
  placeholder?: string;
}

interface Props {
  ids: number[];
  entityLabel: string;
  endpoint: string;
  fields: BulkFieldConfig[];
  onClose: () => void;
  onSaved: () => void;
}

export default function EntityBulkEditModal({ ids, entityLabel, endpoint, fields, onClose, onSaved }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, ""]))
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const hasChanges = fields.some((f) => (values[f.name] ?? "") !== "");

  const handleSubmit = async () => {
    if (!hasChanges) return;
    setSubmitting(true);
    setError("");
    try {
      const body: Record<string, any> = { ids };
      for (const f of fields) {
        const v = values[f.name];
        if (v === "" || v === undefined) continue;
        if (f.type === "select" && f.clearValue && v === f.clearValue) {
          body[f.name] = null;
          continue;
        }
        if (f.valueType === "number") body[f.name] = Number(v);
        else if (f.valueType === "boolean") body[f.name] = v === "true";
        else body[f.name] = v;
      }
      await api.patch(endpoint, body);
      onSaved();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Bulk edit failed");
    }
    setSubmitting(false);
  };

  return (
    <Modal open onClose={onClose} title={`Edit ${ids.length} ${entityLabel}(s)`}>
      <div className="space-y-4">
        <p className="text-sm text-muted">Only fields you change will be updated.</p>

        {fields.map((f) => (
          <div key={f.name}>
            <label className="block text-sm font-medium text-ink mb-1">{f.label}</label>
            {f.type === "select" ? (
              <select
                className="select"
                value={values[f.name]}
                onChange={(e) => setValues((prev) => ({ ...prev, [f.name]: e.target.value }))}
                aria-label={f.label}
              >
                <option value="">— No change —</option>
                {(f.options || []).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : (
              <input
                type={f.type === "number" ? "number" : "text"}
                min={f.type === "number" ? 0 : undefined}
                className="input"
                placeholder={f.placeholder || "— No change —"}
                value={values[f.name]}
                onChange={(e) => setValues((prev) => ({ ...prev, [f.name]: e.target.value }))}
                aria-label={f.label}
              />
            )}
          </div>
        ))}

        {error && <div className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">{error}</div>}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn-secondary text-sm px-3 py-1.5">Cancel</button>
          <button onClick={handleSubmit} disabled={!hasChanges || submitting} className="btn-primary text-sm px-3 py-1.5">
            {submitting ? "Saving..." : `Update ${ids.length} ${entityLabel}(s)`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
