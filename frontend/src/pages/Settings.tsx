import { useEffect, useState } from "react";
import { Save, KeyRound, Bell, Hash, Workflow, DollarSign, Monitor } from "lucide-react";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { CURRENCIES, symbolFor } from "../utils/currencies";

type Tab = "store" | "notifications" | "documents" | "workflow" | "financial" | "display" | "password";

const TABS: { key: Tab; label: string; icon: typeof Save }[] = [
  { key: "store", label: "Store", icon: Save },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "documents", label: "Document Numbering", icon: Hash },
  { key: "workflow", label: "Workflow", icon: Workflow },
  { key: "financial", label: "Financial", icon: DollarSign },
  { key: "display", label: "Display", icon: Monitor },
  { key: "password", label: "Password", icon: KeyRound },
];

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
        active ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30" : "text-muted hover:bg-subtle hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export default function Settings() {
  const { can, logout } = useAuth();
  const { addToast } = useToast();
  const [tab, setTab] = useState<Tab>("store");
  const [form, setForm] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pw, setPw] = useState({ current_password: "", new_password: "" });
  const [pwSaving, setPwSaving] = useState(false);
  const canUpdateSettings = can("settings.update");
  const readOnly = !canUpdateSettings;

  useEffect(() => {
    let cancelled = false;
    api.get("/settings").then(({ data }) => {
      if (cancelled) return;
      setForm({
        store_name: data.store_name, address: data.address, phone: data.phone, email: data.email,
        currency_symbol: data.currency_symbol, currency_code: data.currency_code || "USD",
        tax_rate: String(data.tax_rate),
        default_reorder_level: String(data.default_reorder_level),
        expiry_warning_days: String(data.expiry_warning_days),
        low_stock_alerts: data.low_stock_alerts, expiry_alerts: data.expiry_alerts,
        shipment_prefix: data.shipment_prefix, work_order_prefix: data.work_order_prefix,
        sale_prefix: data.sale_prefix, invoice_prefix: data.invoice_prefix, po_prefix: data.po_prefix,
        require_qc_before_ship: data.require_qc_before_ship, auto_allocate_stock: data.auto_allocate_stock,
        enforce_fefo: data.enforce_fefo,
        default_costing_method: data.default_costing_method,
        fiscal_year_start_month: String(data.fiscal_year_start_month),
        default_items_per_page: String(data.default_items_per_page),
        date_format: data.date_format,
      });
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const set = (key: string, val: any) => setForm((f) => ({ ...f, [key]: val }));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put("/settings", {
        ...form,
        currency_code: form.currency_code || "USD",
        tax_rate: parseFloat(form.tax_rate) || 0,
        default_reorder_level: parseInt(form.default_reorder_level) || 10,
        expiry_warning_days: parseInt(form.expiry_warning_days) || 30,
        fiscal_year_start_month: parseInt(form.fiscal_year_start_month) || 1,
        default_items_per_page: parseInt(form.default_items_per_page) || 50,
      });
      addToast("Settings saved", "success");
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to save settings", "error");
    }
    setSaving(false);
  };

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwSaving(true);
    try {
      await api.put("/users/password/change", pw);
      addToast("Password changed. You have been signed out of all devices. Please log in with your new password.", "success");
      setPw({ current_password: "", new_password: "" });
      logout();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to change password", "error");
    }
    setPwSaving(false);
  };

  if (loading) return <div className="text-muted py-8">Loading settings...</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">System Settings</h1>

      {readOnly && (
        <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg px-3 py-2">
          You have read-only access to these settings. Contact an administrator to make changes.
        </p>
      )}

      <div className="flex flex-wrap gap-1 border-b border-border pb-2">
        {TABS.map((t) => (
          <TabButton key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
            <t.icon size={15} /> {t.label}
          </TabButton>
        ))}
      </div>

      {tab === "store" && (
        <form onSubmit={handleSave} className="card space-y-4">
          <h2 className="text-lg font-semibold">Store Information</h2>
          <fieldset disabled={readOnly} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Store Name" value={form.store_name} onChange={(v) => set("store_name", v)} />
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Currency</label>
                <select className="select" value={form.currency_code} onChange={(e) => {
                  const code = e.target.value;
                  set("currency_code", code);
                  set("currency_symbol", symbolFor(code));
                }}>
                  {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.symbol} — {c.name} ({c.code})</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Address</label>
              <textarea className="input" rows={2} value={form.address || ""} onChange={(e) => set("address", e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Phone" value={form.phone} onChange={(v) => set("phone", v)} />
              <Field label="Email" value={form.email} onChange={(v) => set("email", v)} type="email" />
            </div>
          </fieldset>
          {!readOnly && <SaveButton loading={saving} />}
        </form>
      )}

      {tab === "notifications" && (
        <form onSubmit={handleSave} className="card space-y-4">
          <h2 className="text-lg font-semibold">Notification Preferences</h2>
          <fieldset disabled={readOnly} className="space-y-4">
            <Toggle label="Low Stock Alerts" checked={form.low_stock_alerts} onChange={(v) => set("low_stock_alerts", v)}
              description="Notify admins when a product falls below its reorder level" />
            <Toggle label="Expiry Alerts" checked={form.expiry_alerts} onChange={(v) => set("expiry_alerts", v)}
              description="Notify admins when products are expiring or expired" />
            <Field label="Expiry Warning Days" value={form.expiry_warning_days} onChange={(v) => set("expiry_warning_days", v)} type="number"
              description="How many days before expiry to start warning" />
          </fieldset>
          {!readOnly && <SaveButton loading={saving} />}
        </form>
      )}

      {tab === "documents" && (
        <form onSubmit={handleSave} className="card space-y-4">
          <h2 className="text-lg font-semibold">Document Numbering</h2>
          <p className="text-sm text-muted">Configure prefixes for auto-generated document numbers.</p>
          <fieldset disabled={readOnly} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Shipment Prefix" value={form.shipment_prefix} onChange={(v) => set("shipment_prefix", v)} description="e.g. SHP → SHP-0001" />
              <Field label="Work Order Prefix" value={form.work_order_prefix} onChange={(v) => set("work_order_prefix", v)} description="e.g. WO → WO-0001" />
              <Field label="Sale Prefix" value={form.sale_prefix} onChange={(v) => set("sale_prefix", v)} description="e.g. SALE → SALE-0001" />
              <Field label="Invoice Prefix" value={form.invoice_prefix} onChange={(v) => set("invoice_prefix", v)} description="e.g. INV → INV-0001" />
              <Field label="Purchase Order Prefix" value={form.po_prefix} onChange={(v) => set("po_prefix", v)} description="e.g. PO → PO-0001" />
            </div>
          </fieldset>
          {!readOnly && <SaveButton loading={saving} />}
        </form>
      )}

      {tab === "workflow" && (
        <form onSubmit={handleSave} className="card space-y-4">
          <h2 className="text-lg font-semibold">Workflow Settings</h2>
          <fieldset disabled={readOnly} className="space-y-4">
            <Toggle label="Require QC Before Shipping" checked={form.require_qc_before_ship} onChange={(v) => set("require_qc_before_ship", v)}
              description="Block picking and shipping if a pending quality check exists for the product (failed quality checks always block)" />
            <Toggle label="Auto-Allocate Stock" checked={form.auto_allocate_stock} onChange={(v) => set("auto_allocate_stock", v)}
              description="Automatically allocate stock to fulfill a shipment when it is created" />
            <Toggle label="Enforce FEFO (First Expired, First Out)" checked={form.enforce_fefo} onChange={(v) => set("enforce_fefo", v)}
              description="Allocate stock by earliest expiry date. Disable for FIFO by registration order." />
          </fieldset>
          {!readOnly && <SaveButton loading={saving} />}
        </form>
      )}

      {tab === "financial" && (
        <form onSubmit={handleSave} className="card space-y-4">
          <h2 className="text-lg font-semibold">Financial Settings</h2>
          <fieldset disabled={readOnly} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Tax Rate (%)" value={form.tax_rate} onChange={(v) => set("tax_rate", v)} type="number" />
              <Field label="Default Reorder Level" value={form.default_reorder_level} onChange={(v) => set("default_reorder_level", v)} type="number" />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Default Costing Method</label>
              <select className="select" value={form.default_costing_method} onChange={(e) => set("default_costing_method", e.target.value)}>
                <option value="weighted_average">Weighted Average</option>
                <option value="fifo">FIFO (First In, First Out)</option>
                <option value="standard">Standard Cost</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Fiscal Year Start Month</label>
              <select className="select" value={form.fiscal_year_start_month} onChange={(e) => set("fiscal_year_start_month", e.target.value)}>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>{new Date(2000, i).toLocaleString("default", { month: "long" })}</option>
                ))}
              </select>
            </div>
          </fieldset>
          {!readOnly && <SaveButton loading={saving} />}
        </form>
      )}

      {tab === "display" && (
        <form onSubmit={handleSave} className="card space-y-4">
          <h2 className="text-lg font-semibold">Display Preferences</h2>
          <fieldset disabled={readOnly} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Default Items Per Page" value={form.default_items_per_page} onChange={(v) => set("default_items_per_page", v)} type="number" />
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Date Format</label>
                <select className="select" value={form.date_format} onChange={(e) => set("date_format", e.target.value)}>
                  <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                  <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                  <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                  <option value="DD.MM.YYYY">DD.MM.YYYY</option>
                </select>
              </div>
            </div>
          </fieldset>
          {!readOnly && <SaveButton loading={saving} />}
        </form>
      )}

      {tab === "password" && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <KeyRound size={18} className="text-faint" />
            Change Password
          </h2>
          <form onSubmit={handlePassword} className="space-y-4 max-w-md">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Current Password</label>
              <input type="password" className="input" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">New Password</label>
              <input type="password" className="input" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} required minLength={6} />
            </div>
            <div className="flex justify-end">
              <button type="submit" disabled={pwSaving} className="btn-primary">
                {pwSaving ? "Updating..." : "Change Password"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = "text", description }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; description?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-ink mb-1">{label}</label>
      <input type={type} className="input" value={value || ""} onChange={(e) => onChange(e.target.value)} />
      {description && <p className="text-xs text-faint mt-1">{description}</p>}
    </div>
  );
}

function Toggle({ label, checked, onChange, description }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; description?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-4 p-3 rounded-lg border border-border hover:bg-app cursor-pointer">
      <div>
        <span className="text-sm font-medium text-ink">{label}</span>
        {description && <p className="text-xs text-faint mt-0.5">{description}</p>}
      </div>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
          checked ? "bg-indigo-600" : "bg-subtle-strong"
        }`}>
        <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-surface shadow ring-0 transition-transform ${
          checked ? "translate-x-5" : "translate-x-0"
        }`} />
      </button>
    </label>
  );
}

function SaveButton({ loading }: { loading: boolean }) {
  return (
    <div className="flex justify-end pt-2">
      <button type="submit" disabled={loading} className="btn-primary">
        <Save size={16} className="inline mr-1" />
        {loading ? "Saving..." : "Save Settings"}
      </button>
    </div>
  );
}
