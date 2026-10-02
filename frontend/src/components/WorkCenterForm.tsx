import { useState } from "react";
import api from "../api/client";
import type { Location, WorkCenter } from "../types";
import { useToast } from "../context/ToastContext";
import { errorMessage } from "../utils/errors";
import { WORK_CENTER_TYPES, WORK_CENTER_TYPE_LABELS, WORKING_WEEKDAYS } from "../utils/workCenters";
import SlideOver from "./SlideOver";
import FittedSelect from "./FittedSelect";
import TextArea from "./TextArea";

interface Props {
  center: WorkCenter | null;
  locations: Location[];
  onClose: () => void;
  onSaved: () => void;
}

interface WorkCenterForm {
  code: string;
  name: string;
  work_center_type: string;
  location_id: string;
  hours_per_day: string;
  shift_start: string;
  efficiency: string;
  hourly_rate: string;
  working_days: number[];
  notes: string;
  is_active: boolean;
}

const sectionLabel = "text-xs font-semibold uppercase tracking-widest text-faint";

export default function WorkCenterForm({ center, locations, onClose, onSaved }: Props) {
  const { addToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<WorkCenterForm>(() => ({
    code: center?.code ?? "",
    name: center?.name ?? "",
    work_center_type: center?.work_center_type ?? "workstation",
    location_id: center?.location_id != null ? String(center.location_id) : "",
    hours_per_day: String(center?.hours_per_day ?? 8),
    shift_start: center?.shift_start ?? "08:00",
    efficiency: String(center?.efficiency ?? 100),
    hourly_rate: String(center?.hourly_rate ?? 0),
    working_days: center?.working_day_list ?? [0, 1, 2, 3, 4],
    notes: center?.notes ?? "",
    is_active: center?.is_active ?? true,
  }));

  const toggleDay = (day: number) => {
    setForm((prev) => ({
      ...prev,
      working_days: prev.working_days.includes(day)
        ? prev.working_days.filter((d) => d !== day)
        : [...prev.working_days, day].sort((a, b) => a - b),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.code.trim()) {
      addToast("Name and code are required", "error");
      return;
    }
    const hours = Number(form.hours_per_day);
    const efficiency = Number(form.efficiency);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      addToast("Hours per day must be between 0 and 24", "error");
      return;
    }
    if (!Number.isFinite(efficiency) || efficiency <= 0 || efficiency > 1000) {
      addToast("Efficiency must be between 0 and 1000", "error");
      return;
    }
    setSaving(true);
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      work_center_type: form.work_center_type,
      location_id: form.location_id ? Number(form.location_id) : null,
      hours_per_day: hours,
      shift_start: form.shift_start,
      efficiency,
      hourly_rate: Number(form.hourly_rate) || 0,
      working_days: form.working_days,
      notes: form.notes.trim(),
      is_active: form.is_active,
    };
    try {
      if (center) await api.put(`/work-centers/${center.id}`, payload);
      else await api.post("/work-centers", payload);
      addToast(center ? "Work center updated" : "Work center created", "success");
      onSaved();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Error saving work center"), "error");
    }
    setSaving(false);
  };

  const locationOptions = [
    { value: "", label: "No location" },
    ...locations
      .filter((l) => l.is_active || l.id === center?.location_id)
      .map((l) => ({ value: String(l.id), label: l.path })),
  ];

  const title = center ? `Edit ${center.code ? `${center.code}: ` : ""}${center.name}` : "New Work Center";

  return (
    <SlideOver
      open
      onClose={onClose}
      title={center ? "Edit Work Center" : "Add Work Center"}
      ariaLabel={title}
      breadcrumb={title}
      wide
    >
      <div className="border border-border rounded-lg overflow-hidden bg-white dark:bg-app">
        <div className="border-b border-border px-6 py-4">
          <p className={sectionLabel}>{center ? "Edit Work Center" : "New Work Center"}</p>
          <p className="text-xl font-bold text-ink mt-0.5 tracking-tight">{title}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-0">
          <div className="px-6 py-5 border-b border-dashed border-border">
            <p className={`${sectionLabel} mb-3`}>General Information</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Name *</label>
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. CNC Mill 1" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Code *</label>
                <input className="input font-mono" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. CNC-1" required />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Type</label>
                <FittedSelect
                  ariaLabel="Work center type"
                  value={form.work_center_type}
                  onChange={(v) => setForm({ ...form, work_center_type: v })}
                  options={WORK_CENTER_TYPES.map((t) => ({ value: t, label: WORK_CENTER_TYPE_LABELS[t] }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Location</label>
                <FittedSelect
                  ariaLabel="Location"
                  value={form.location_id}
                  onChange={(v) => setForm({ ...form, location_id: v })}
                  options={locationOptions}
                />
              </div>
            </div>
          </div>

          <div className="px-6 py-5 border-b border-dashed border-border">
            <p className={`${sectionLabel} mb-3`}>Capacity &amp; Schedule</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Hours / day</label>
                <input type="number" min="0" max="24" step="0.5" className="input" value={form.hours_per_day} onChange={(e) => setForm({ ...form, hours_per_day: e.target.value })} aria-label="Hours per day" />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Shift start</label>
                <input type="time" className="input" value={form.shift_start} onChange={(e) => setForm({ ...form, shift_start: e.target.value })} aria-label="Shift start" />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Efficiency %</label>
                <input type="number" min="1" max="1000" step="1" className="input" value={form.efficiency} onChange={(e) => setForm({ ...form, efficiency: e.target.value })} aria-label="Efficiency percent" />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Rate / hour</label>
                <input type="number" min="0" step="0.01" className="input" value={form.hourly_rate} onChange={(e) => setForm({ ...form, hourly_rate: e.target.value })} aria-label="Rate per hour" />
              </div>
            </div>

            <div className="mt-4">
              <span className="block text-sm font-medium text-ink mb-2">Working days</span>
              <div className="flex flex-wrap gap-1.5">
                {WORKING_WEEKDAYS.map((label, day) => {
                  const on = form.working_days.includes(day);
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => toggleDay(day)}
                      aria-pressed={on}
                      aria-label={label}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                        on
                          ? "border-primary bg-primary-soft text-primary-strong dark:text-primary"
                          : "border-border text-muted hover:text-ink"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted mt-2">Capacity is only counted on these days.</p>
            </div>
          </div>

          <div className="px-6 py-5 border-b border-dashed border-border">
            <p className={`${sectionLabel} mb-3`}>Notes</p>
            <TextArea rows={3} value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} ariaLabel="Notes" placeholder="Anything the floor should know about this center" />

            <label className="flex items-center gap-2 text-sm text-ink px-1 mt-4">
              <input
                type="checkbox"
                className="rounded border-border-strong accent-primary"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
              Active
              <span className="text-xs text-muted font-normal">Inactive centers are hidden from routing choices.</span>
            </label>
          </div>

          <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Saving..." : center ? "Update Work Center" : "Create Work Center"}
            </button>
          </div>
        </form>
      </div>
    </SlideOver>
  );
}