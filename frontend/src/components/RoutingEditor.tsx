import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, Workflow } from "lucide-react";
import api from "../api/client";
import type { Routing, WorkCenter } from "../types";
import { useToast } from "../context/ToastContext";
import { errorMessage } from "../utils/errors";
import { formatMinutes } from "../utils/workCenters";
import SlideOver from "./SlideOver";
import FittedSelect from "./FittedSelect";
import EmptyState from "./EmptyState";

interface Props {
  routing: Routing;
  centers: WorkCenter[];
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => void;
}

interface OpDraft {
  key: string;
  work_center_id: string;
  name: string;
  setup_minutes: string;
  run_minutes_per_unit: string;
  notes: string;
}

const sectionLabel = "text-xs font-semibold uppercase tracking-widest text-faint";

let opKey = 0;
function makeOpKey(): string {
  opKey += 1;
  return `op-${opKey}`;
}

export default function RoutingEditor({ routing, centers, readOnly, onClose, onSaved }: Props) {
  const { addToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [ops, setOps] = useState<OpDraft[]>(() =>
    routing.operations.map((op) => ({
      key: makeOpKey(),
      work_center_id: String(op.work_center_id),
      name: op.name,
      setup_minutes: String(op.setup_minutes),
      run_minutes_per_unit: String(op.run_minutes_per_unit),
      notes: op.notes,
    })),
  );

  const usableCenters = centers.filter((c) => c.is_active || ops.some((o) => o.work_center_id === String(c.id)));
  const centerOptions = usableCenters.map((c) => ({ value: String(c.id), label: `${c.name} (${c.code})` }));
  const efficiencyById = useMemo(() => {
    const map = new Map<number, number>();
    centers.forEach((c) => map.set(c.id, c.efficiency > 0 ? c.efficiency : 100));
    return map;
  }, [centers]);

  const idealTotal = ops.reduce((sum, o) => sum + (Number(o.setup_minutes) || 0) + (Number(o.run_minutes_per_unit) || 0), 0);
  const adjustedTotal = ops.reduce((sum, o) => {
    const base = (Number(o.setup_minutes) || 0) + (Number(o.run_minutes_per_unit) || 0);
    const eff = efficiencyById.get(Number(o.work_center_id)) ?? 100;
    return sum + base * (100 / eff);
  }, 0);

  const update = (key: string, patch: Partial<OpDraft>) => {
    setOps((prev) => prev.map((o) => (o.key === key ? { ...o, ...patch } : o)));
  };

  const move = (index: number, delta: number) => {
    setOps((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const addStep = () => {
    const fallback = usableCenters[0];
    setOps((prev) => [
      ...prev,
      {
        key: makeOpKey(),
        work_center_id: fallback ? String(fallback.id) : "",
        name: "",
        setup_minutes: "0",
        run_minutes_per_unit: "0",
        notes: "",
      },
    ]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (ops.some((o) => !o.work_center_id)) {
      addToast("Every step needs a work center", "error");
      return;
    }
    if (ops.some((o) => (Number(o.setup_minutes) || 0) < 0 || (Number(o.run_minutes_per_unit) || 0) < 0)) {
      addToast("Step times cannot be negative", "error");
      return;
    }
    setSaving(true);
    try {
      await api.put(`/routings/products/${routing.product_id}`, {
        operations: ops.map((o, index) => ({
          work_center_id: Number(o.work_center_id),
          position: index,
          name: o.name.trim(),
          setup_minutes: Number(o.setup_minutes) || 0,
          run_minutes_per_unit: Number(o.run_minutes_per_unit) || 0,
          notes: o.notes.trim(),
          is_active: true,
        })),
      });
      addToast("Routing saved", "success");
      onSaved();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Error saving routing"), "error");
    }
    setSaving(false);
  };

  const title = `Routing — ${routing.product_name}`;

  return (
    <SlideOver
      open
      onClose={onClose}
      wide
      ariaLabel={title}
      breadcrumb={title}
      title={readOnly ? `Routing — ${routing.product_name}` : `Edit Routing — ${routing.product_name}`}
    >
      <div className="border border-border rounded-lg overflow-hidden bg-white dark:bg-app">
        <div className="border-b border-border px-6 py-4">
          <p className={sectionLabel}>{readOnly ? "Routing" : "Edit Routing"}</p>
          <p className="text-xl font-bold text-ink mt-0.5 tracking-tight">{routing.product_name}</p>
          <p className="text-sm text-muted font-mono mt-0.5">{routing.sku}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-0">
          <div className="px-6 py-5 border-b border-dashed border-border">
            <p className={`${sectionLabel} mb-3`}>Steps</p>
            {ops.length === 0 ? (
              <EmptyState
                compact
                icon={<Workflow size={32} />}
                title="No steps yet"
                message={usableCenters.length === 0 ? "Add an active work center before laying out a route." : "Add the first step to build this route."}
                actionLabel={readOnly || usableCenters.length === 0 ? undefined : "Add Step"}
                onAction={readOnly || usableCenters.length === 0 ? undefined : addStep}
              />
            ) : (
              <div className="space-y-3">
                {ops.map((op, index) => (
                  <div key={op.key} className="rounded-lg border border-border bg-app p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-primary-soft text-primary-strong dark:text-primary text-xs font-semibold flex items-center justify-center shrink-0">
                        {index + 1}
                      </span>
                      <span className="text-sm font-medium text-ink">Step {index + 1}</span>
                      {!readOnly && (
                        <div className="ml-auto flex items-center gap-1">
                          <button type="button" onClick={() => move(index, -1)} disabled={index === 0} className="h-8 w-8 inline-flex items-center justify-center rounded-md text-faint hover:text-primary disabled:opacity-30" aria-label={`Move step ${index + 1} up`}>
                            <ArrowUp size={16} />
                          </button>
                          <button type="button" onClick={() => move(index, 1)} disabled={index === ops.length - 1} className="h-8 w-8 inline-flex items-center justify-center rounded-md text-faint hover:text-primary disabled:opacity-30" aria-label={`Move step ${index + 1} down`}>
                            <ArrowDown size={16} />
                          </button>
                          <button type="button" onClick={() => setOps((prev) => prev.filter((o) => o.key !== op.key))} className="h-8 w-8 inline-flex items-center justify-center rounded-md text-faint hover:text-red-600" aria-label={`Remove step ${index + 1}`}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-muted mb-1">Work center</label>
                        <FittedSelect
                          ariaLabel={`Step ${index + 1} work center`}
                          value={op.work_center_id}
                          onChange={(v) => update(op.key, { work_center_id: v })}
                          options={centerOptions}
                          disabled={readOnly}
                          placeholder="Select center"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-muted mb-1">Step name</label>
                        <input className="input" value={op.name} onChange={(e) => update(op.key, { name: e.target.value })} placeholder="e.g. Cut, Weld, Paint" disabled={readOnly} aria-label={`Step ${index + 1} name`} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-muted mb-1">Setup minutes</label>
                        <input type="number" min="0" className="input" value={op.setup_minutes} onChange={(e) => update(op.key, { setup_minutes: e.target.value })} disabled={readOnly} aria-label={`Step ${index + 1} setup minutes`} />
                      </div>
                      <div>
                        <label className="block text-xs text-muted mb-1">Run minutes / unit</label>
                        <input type="number" min="0" step="0.01" className="input" value={op.run_minutes_per_unit} onChange={(e) => update(op.key, { run_minutes_per_unit: e.target.value })} disabled={readOnly} aria-label={`Step ${index + 1} run minutes per unit`} />
                      </div>
                    </div>
                  </div>
                ))}
                {!readOnly && usableCenters.length > 0 && (
                  <button type="button" onClick={addStep} className="btn-secondary inline-flex items-center gap-1">
                    <Plus size={16} /> Add Step
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="px-6 py-5 border-b border-dashed border-border">
            <p className={`${sectionLabel} mb-3`}>Duration</p>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className={`${sectionLabel} mb-0`}>Ideal minutes / unit</p>
                <p className="font-semibold text-ink mt-1">{formatMinutes(idealTotal)}</p>
              </div>
              <div>
                <p className={`${sectionLabel} mb-0`}>Real minutes / unit (efficiency adjusted)</p>
                <p className="font-semibold text-ink mt-1">{formatMinutes(adjustedTotal)}</p>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
            <button type="button" onClick={onClose} className="btn-secondary">{readOnly ? "Close" : "Cancel"}</button>
            {!readOnly && (
              <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving..." : "Save Routing"}</button>
            )}
          </div>
        </form>
      </div>
    </SlideOver>
  );
}