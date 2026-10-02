import { Pencil, Trash2, TriangleAlert } from "lucide-react";
import type { WorkCenter, WorkCenterLoad } from "../types";
import { useSettings } from "../hooks/useSettings";
import { formatCurrency } from "../utils/currency";
import { WORK_CENTER_TYPE_LABELS, WORKING_WEEKDAYS, formatMinutes } from "../utils/workCenters";
import SlideOver from "./SlideOver";
import EmptyState from "./EmptyState";
import ProgressBar from "./ProgressBar";

interface Props {
  center: WorkCenter;
  report?: WorkCenterLoad;
  onClose: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

const sectionLabel = "text-xs font-semibold uppercase tracking-widest text-faint";

export default function WorkCenterDetail({ center, report, onClose, onEdit, onDelete }: Props) {
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  const days = center.working_day_list || [];

  return (
    <SlideOver
      open
      onClose={onClose}
      wide
      ariaLabel={center.name}
      breadcrumb={center.name}
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          {center.name}
          <span className={`badge ${center.is_active ? "badge-success" : "badge-danger"}`}>
            {center.is_active ? "Active" : "Inactive"}
          </span>
          {report?.is_bottleneck && (
            <span className="badge bg-red-500/10 text-red-700 dark:text-red-300 inline-flex items-center gap-1">
              <TriangleAlert size={12} /> Bottleneck
            </span>
          )}
        </span>
      }
      actions={
        <>
          {onEdit && (
            <button onClick={onEdit} className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1.5" aria-label="Edit work center">
              <Pencil size={14} />Edit
            </button>
          )}
          {onDelete && (
            <button onClick={onDelete} className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1.5 text-red-600 dark:text-red-400" aria-label="Delete work center">
              <Trash2 size={14} />Delete
            </button>
          )}
        </>
      }
    >
      <div className="border border-border rounded-lg overflow-hidden bg-white dark:bg-app">
        <div className="border-b border-border px-6 py-5">
          <p className={sectionLabel}>Work Center</p>
          <h3 className="text-xl font-bold text-ink mt-1 tracking-tight">{center.name}</h3>
          <p className="text-sm text-muted mt-0.5 font-mono">{center.code}</p>
        </div>

        <div className="grid sm:grid-cols-3 gap-x-6 gap-y-3 px-6 py-5 border-b border-dashed border-border text-sm">
          <div>
            <p className={sectionLabel}>Type</p>
            <p className="font-medium mt-1">{WORK_CENTER_TYPE_LABELS[center.work_center_type] ?? center.work_center_type}</p>
          </div>
          <div>
            <p className={sectionLabel}>Location</p>
            <p className="font-medium mt-1">{center.location_name || "—"}</p>
          </div>
          <div>
            <p className={sectionLabel}>Rate / hour</p>
            <p className="font-medium mt-1">{formatCurrency(center.hourly_rate, currencySymbol)}</p>
          </div>
          <div>
            <p className={sectionLabel}>Shift start</p>
            <p className="font-medium mt-1">{center.shift_start}</p>
          </div>
          <div>
            <p className={sectionLabel}>Hours / day</p>
            <p className="font-medium mt-1">{center.hours_per_day}h</p>
          </div>
          <div>
            <p className={sectionLabel}>Daily capacity</p>
            <p className="font-medium mt-1">{formatMinutes(center.daily_minutes)}</p>
          </div>
          <div>
            <p className={sectionLabel}>Efficiency</p>
            <p className="font-medium mt-1">{center.efficiency}%</p>
          </div>
          <div>
            <p className={sectionLabel}>Routing steps</p>
            <p className="font-medium mt-1">{center.operation_count}</p>
          </div>
          <div>
            <p className={sectionLabel}>Status</p>
            <div className="mt-1">
              <span className={`badge ${center.is_active ? "badge-success" : "badge-danger"}`}>
                {center.is_active ? "Active" : "Inactive"}
              </span>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 border-b border-dashed border-border">
          <p className={sectionLabel}>Working days</p>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {WORKING_WEEKDAYS.map((label, day) => {
              const on = days.includes(day);
              return (
                <span
                  key={label}
                  aria-label={`${label} ${on ? "is a working day" : "is not a working day"}`}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md border ${
                    on
                      ? "border-primary bg-primary-soft text-primary-strong dark:text-primary"
                      : "border-border text-faint"
                  }`}
                >
                  {label}
                </span>
              );
            })}
          </div>
        </div>

        <div className="px-6 py-5 border-b border-dashed border-border">
          <p className={sectionLabel}>Capacity &amp; load</p>
          {!report ? (
            <EmptyState compact title="No capacity report" message="Load appears once the window covers working days." />
          ) : (
            <>
              <div className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <p className={sectionLabel}>Window</p>
                  <p className="font-medium mt-1">{report.from_date} → {report.to_date}</p>
                </div>
                <div>
                  <p className={sectionLabel}>Working days</p>
                  <p className="font-medium mt-1">{report.working_days_available}</p>
                </div>
                <div>
                  <p className={sectionLabel}>Capacity</p>
                  <p className="font-medium mt-1">{formatMinutes(report.capacity_minutes)}</p>
                </div>
                <div>
                  <p className={sectionLabel}>Load</p>
                  <p className="font-medium mt-1">{formatMinutes(report.load_minutes)}</p>
                </div>
                <div>
                  <p className={sectionLabel}>Free</p>
                  <p className="font-medium mt-1">{formatMinutes(report.free_minutes)}</p>
                </div>
                <div>
                  <p className={sectionLabel}>Open / scheduled</p>
                  <p className="font-medium mt-1">{report.open_work_orders} / {report.scheduled_work_orders}</p>
                </div>
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className={`${sectionLabel} mb-0`}>Utilization</p>
                  {report.overdue_work_orders > 0 && (
                    <span className="badge bg-amber-500/10 text-amber-700 dark:text-amber-300">
                      {report.overdue_work_orders} overdue
                    </span>
                  )}
                </div>
                <ProgressBar
                  value={report.utilization_pct}
                  max={100}
                  label={`Utilization of ${center.name}`}
                  tone={report.is_bottleneck ? "danger" : undefined}
                />
              </div>
            </>
          )}
        </div>

        {center.notes && (
          <div className="px-6 py-5">
            <p className={sectionLabel}>Notes</p>
            <p className="text-sm mt-2 whitespace-pre-line">{center.notes}</p>
          </div>
        )}
      </div>
    </SlideOver>
  );
}