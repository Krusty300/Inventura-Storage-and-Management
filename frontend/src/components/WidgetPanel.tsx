import { useCallback, useEffect, useState } from "react";
import { GripVertical, Settings, X } from "lucide-react";
import api from "../api/client";
import type { WidgetConfig } from "../types";
import { WIDGET_REGISTRY, getWidgetMeta } from "../utils/widgetRegistry";

interface WidgetPanelProps {
  children: (visibleWidgets: string[], toolbar: React.ReactNode) => React.ReactNode;
}

export default function WidgetPanel({ children }: WidgetPanelProps) {
  const [widgets, setWidgets] = useState<WidgetConfig[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.get<{ widgets: WidgetConfig[] }>("/dashboard/widgets").then(({ data }) => {
      const w = data.widgets ?? [];
      w.sort((a: WidgetConfig, b: WidgetConfig) => a.order - b.order);
      setWidgets(w);
      setLoaded(true);
    }).catch(() => {
      const defaults = WIDGET_REGISTRY.map((m, i) => ({ id: m.id, visible: true, order: i }));
      setWidgets(defaults);
      setLoaded(true);
    });
  }, []);

  const saveLayout = useCallback((updated: WidgetConfig[]) => {
    const sorted = [...updated].sort((a, b) => a.order - b.order);
    setWidgets(sorted);
    api.put("/dashboard/widgets", { widgets: sorted }).catch(() => {});
  }, []);

  const toggleVisibility = (id: string) => {
    saveLayout(widgets.map((w) => w.id === id ? { ...w, visible: !w.visible } : w));
  };

  const toggleAll = (visible: boolean) => {
    saveLayout(widgets.map((w) => ({ ...w, visible })));
  };

  const handleDragStart = (idx: number) => { setDragIdx(idx); };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };
  const handleDrop = (targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) { setDragIdx(null); return; }
    const updated = [...widgets];
    const [moved] = updated.splice(dragIdx, 1);
    updated.splice(targetIdx, 0, moved);
    saveLayout(updated.map((w, i) => ({ ...w, order: i })));
    setDragIdx(null);
  };

  const resetToDefault = () => {
    const defaults = WIDGET_REGISTRY.map((m, i) => ({ id: m.id, visible: true, order: i }));
    saveLayout(defaults);
    setEditMode(false);
  };

  if (!loaded) return null;

  const visibleWidgets = widgets.filter((w) => w.visible).map((w) => w.id);

  const toolbar = (
    <div className="flex items-center gap-2 shrink-0">
      {editMode && (
        <button onClick={resetToDefault} className="btn-secondary text-xs">Reset Layout</button>
      )}
      <button
        onClick={() => setEditMode(!editMode)}
        className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border transition-colors ${
          editMode
            ? "bg-primary-solid text-white border-primary-solid hover:bg-primary-solid-hover"
            : "border-border text-muted hover:text-ink hover:border-ink/20"
        }`}
        aria-label={editMode ? "Exit edit mode" : "Customize dashboard"}
      >
        <Settings size={14} />
        {editMode ? "Done" : "Customize"}
      </button>
    </div>
  );

  return (
    <>
      {children(visibleWidgets, toolbar)}

      {editMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEditMode(false)}>
          <div className="bg-white dark:bg-app rounded-xl shadow-2xl border border-border w-full max-w-lg mx-4 max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-lg font-semibold text-ink">Customize Dashboard</h2>
              <button onClick={() => setEditMode(false)} className="p-1 rounded hover:bg-subtle text-muted" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="flex gap-2 px-5 py-3 border-b border-border">
              <button onClick={() => toggleAll(true)} className="btn-secondary text-xs">Show All</button>
              <button onClick={() => toggleAll(false)} className="btn-secondary text-xs">Hide All</button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-3 space-y-1">
              {widgets.map((w, idx) => {
                const meta = getWidgetMeta(w.id);
                return (
                  <div
                    key={w.id}
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={handleDragOver}
                    onDrop={() => handleDrop(idx)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors cursor-grab active:cursor-grabbing ${
                      dragIdx === idx ? "border-primary bg-primary-soft dark:bg-primary/10" : "border-border hover:border-ink/20"
                    }`}
                  >
                    <GripVertical size={16} className="text-faint shrink-0" />
                    <span className="text-sm text-ink flex-1 truncate">{meta.label}</span>
                    <span className="text-xs text-faint capitalize">{meta.category}</span>
                    <button
                      onClick={() => toggleVisibility(w.id)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                        w.visible ? "bg-primary-solid" : "bg-gray-300 dark:bg-gray-600"
                      }`}
                      aria-label={`Toggle ${meta.label}`}
                      role="switch"
                      aria-checked={w.visible}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform ${
                        w.visible ? "translate-x-4" : "translate-x-0"
                      }`} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
