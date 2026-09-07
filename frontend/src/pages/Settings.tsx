import { useEffect, useRef, useState } from "react";
import { Save, KeyRound, Bell, Hash, Workflow, DollarSign, Monitor, FileText, Upload, X, Settings as SettingsIcon, Image as ImageIcon } from "lucide-react";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useSettings as useSettingsQuery } from "../hooks/useSettings";
import Skeleton from "../components/Skeleton";
import { CURRENCIES, symbolFor } from "../utils/currencies";
import { errorMessage } from "../utils/errors";
import FittedSelect from "../components/FittedSelect";

type Tab = "store" | "notifications" | "documents" | "workflow" | "financial" | "display" | "invoice" | "password";

const TABS: { key: Tab; label: string; icon: typeof Save }[] = [
  { key: "store", label: "Store", icon: Save },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "documents", label: "Document Numbering", icon: Hash },
  { key: "workflow", label: "Workflow", icon: Workflow },
  { key: "financial", label: "Financial", icon: DollarSign },
  { key: "display", label: "Display", icon: Monitor },
  { key: "invoice", label: "Invoice", icon: FileText },
  { key: "password", label: "Password", icon: KeyRound },
];

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
        active ? "bg-primary-soft dark:bg-primary/10 text-primary-strong dark:text-primary border border-primary-soft dark:border-primary/30" : "text-muted hover:bg-subtle hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export default function Settings() {
  const { can, logout, completeLogout } = useAuth();
  const { addToast } = useToast();
  const [tab, setTab] = useState<Tab>("store");
  const [form, setForm] = useState<Record<string, any>>({});
  const formInitRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [pw, setPw] = useState({ current_password: "", new_password: "" });
  const [pwSaving, setPwSaving] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const canUpdateSettings = can("settings.update");
  const readOnly = !canUpdateSettings;
  const { data: settingsData, isLoading: loading } = useSettingsQuery();

  useEffect(() => {
    if (!settingsData || formInitRef.current) return;
    formInitRef.current = true;
    setForm({
      store_name: settingsData.store_name, address: settingsData.address, phone: settingsData.phone, email: settingsData.email,
      currency_symbol: settingsData.currency_symbol, currency_code: settingsData.currency_code || "USD",
      tax_rate: String(settingsData.tax_rate),
      default_reorder_level: String(settingsData.default_reorder_level),
      expiry_warning_days: String(settingsData.expiry_warning_days),
      low_stock_alerts: settingsData.low_stock_alerts, expiry_alerts: settingsData.expiry_alerts,
      shipment_prefix: settingsData.shipment_prefix, work_order_prefix: settingsData.work_order_prefix,
      invoice_prefix: settingsData.invoice_prefix, po_prefix: settingsData.po_prefix,
      receipt_prefix: settingsData.receipt_prefix, asn_prefix: settingsData.asn_prefix,
      qc_prefix: settingsData.qc_prefix, cc_prefix: settingsData.cc_prefix,
      return_prefix: settingsData.return_prefix, transfer_prefix: settingsData.transfer_prefix,
      unallocated_prefix: settingsData.unallocated_prefix, quarantine_prefix: settingsData.quarantine_prefix,
      lpn_prefix: settingsData.lpn_prefix, lpn_move_prefix: settingsData.lpn_move_prefix,
      lpn_load_prefix: settingsData.lpn_load_prefix, lpn_unload_prefix: settingsData.lpn_unload_prefix,
      stock_in_prefix: settingsData.stock_in_prefix, stock_out_prefix: settingsData.stock_out_prefix,
      adjustment_prefix: settingsData.adjustment_prefix,
      require_qc_before_ship: settingsData.require_qc_before_ship, auto_allocate_stock: settingsData.auto_allocate_stock,
      enforce_fefo: settingsData.enforce_fefo,
      default_costing_method: settingsData.default_costing_method,
      fiscal_year_start_month: String(settingsData.fiscal_year_start_month),
      default_items_per_page: String(settingsData.default_items_per_page),
      date_format: settingsData.date_format,
      logo_url: settingsData.logo_url || "",
      tax_id: settingsData.tax_id || "",
      payment_terms: settingsData.payment_terms || "",
      bank_details: settingsData.bank_details || "",
      footer_note: settingsData.footer_note || "",
    });
  }, [settingsData]);

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
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to save settings"), "error");
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
      setTimeout(() => completeLogout(), 600);
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to change password"), "error");
    }
    setPwSaving(false);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/settings/logo", fd, { headers: { "Content-Type": "multipart/form-data" } });
      set("logo_url", data.logo_url);
      addToast("Logo uploaded", "success");
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to upload logo"), "error");
    }
    setLogoUploading(false);
    if (logoInputRef.current) logoInputRef.current.value = "";
  };

  const handleLogoRemove = async () => {
    try {
      await api.delete("/settings/logo");
      set("logo_url", "");
      addToast("Logo removed", "success");
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to remove logo"), "error");
    }
  };

  if (loading) return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 min-w-0">
        <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
          <SettingsIcon size={22} strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-ink">System Settings</h1>
          <p className="text-sm text-muted mt-0.5">Configure your business, currency, and defaults.</p>
        </div>
      </div>
      <div className="card p-6 space-y-4">
        <Skeleton variant="rows" rows={6} cols={2} />
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 min-w-0">
        <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
          <SettingsIcon size={22} strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-ink">System Settings</h1>
          <p className="text-sm text-muted mt-0.5">Configure your business, currency, and defaults.</p>
        </div>
      </div>

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
                <FittedSelect
                  value={form.currency_code}
                  onChange={(code) => {
                    set("currency_code", code);
                    set("currency_symbol", symbolFor(code));
                  }}
                  options={CURRENCIES.map((c) => ({ value: c.code, label: `${c.symbol} — ${c.name} (${c.code})` }))}
                  ariaLabel="Currency"
                />
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
            <div>
              <h3 className="text-sm font-medium text-ink mb-2">Core Documents</h3>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Invoice Prefix" value={form.invoice_prefix} onChange={(v) => set("invoice_prefix", v)} description="e.g. INV → INV-0001" />
                <Field label="Purchase Order Prefix" value={form.po_prefix} onChange={(v) => set("po_prefix", v)} description="e.g. PO → PO-0001" />
                <Field label="Shipment Prefix" value={form.shipment_prefix} onChange={(v) => set("shipment_prefix", v)} description="e.g. SHP → SHP-0001" />
                <Field label="Work Order Prefix" value={form.work_order_prefix} onChange={(v) => set("work_order_prefix", v)} description="e.g. WO → WO-0001" />
                <Field label="Receipt Prefix" value={form.receipt_prefix} onChange={(v) => set("receipt_prefix", v)} description="e.g. RCP → RCP-0001" />
                <Field label="ASN Prefix" value={form.asn_prefix} onChange={(v) => set("asn_prefix", v)} description="e.g. ASN → ASN-0001" />
              </div>
            </div>
            <div>
              <h3 className="text-sm font-medium text-ink mb-2">Warehouse Operations</h3>
              <div className="grid grid-cols-2 gap-4">
                <Field label="LPN Prefix" value={form.lpn_prefix} onChange={(v) => set("lpn_prefix", v)} description="e.g. LPN → LPN-0001" />
                <Field label="LPN Move Prefix" value={form.lpn_move_prefix} onChange={(v) => set("lpn_move_prefix", v)} description="e.g. MOV → MOV-0001" />
                <Field label="LPN Load Prefix" value={form.lpn_load_prefix} onChange={(v) => set("lpn_load_prefix", v)} description="e.g. LOD → LOD-0001" />
                <Field label="LPN Unload Prefix" value={form.lpn_unload_prefix} onChange={(v) => set("lpn_unload_prefix", v)} description="e.g. ULD → ULD-0001" />
              </div>
            </div>
            <div>
              <h3 className="text-sm font-medium text-ink mb-2">Stock Movements</h3>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Stock In Prefix" value={form.stock_in_prefix} onChange={(v) => set("stock_in_prefix", v)} description="e.g. SI → SI-0001" />
                <Field label="Stock Out Prefix" value={form.stock_out_prefix} onChange={(v) => set("stock_out_prefix", v)} description="e.g. SO → SO-0001" />
                <Field label="Transfer Prefix" value={form.transfer_prefix} onChange={(v) => set("transfer_prefix", v)} description="e.g. TRF → TRF-0001" />
                <Field label="Return Prefix" value={form.return_prefix} onChange={(v) => set("return_prefix", v)} description="e.g. RET → RET-0001" />
                <Field label="Adjustment Prefix" value={form.adjustment_prefix} onChange={(v) => set("adjustment_prefix", v)} description="e.g. ADJ → ADJ-0001" />
                <Field label="Unallocated Move Prefix" value={form.unallocated_prefix} onChange={(v) => set("unallocated_prefix", v)} description="e.g. UNL → UNL-0001" />
                <Field label="Quarantine Prefix" value={form.quarantine_prefix} onChange={(v) => set("quarantine_prefix", v)} description="e.g. QAR → QAR-0001" />
              </div>
            </div>
            <div>
              <h3 className="text-sm font-medium text-ink mb-2">Quality</h3>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Quality Check Prefix" value={form.qc_prefix} onChange={(v) => set("qc_prefix", v)} description="e.g. QC → QC-0001" />
                <Field label="Cycle Count Prefix" value={form.cc_prefix} onChange={(v) => set("cc_prefix", v)} description="e.g. CC → CC-0001" />
              </div>
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
              <FittedSelect
                value={form.default_costing_method}
                onChange={(v) => set("default_costing_method", v)}
                options={[
                  { value: "weighted_average", label: "Weighted Average" },
                  { value: "fifo", label: "FIFO (First In, First Out)" },
                  { value: "standard", label: "Standard Cost" },
                ]}
                ariaLabel="Default Costing Method"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Fiscal Year Start Month</label>
              <FittedSelect
                value={form.fiscal_year_start_month}
                onChange={(v) => set("fiscal_year_start_month", v)}
                options={Array.from({ length: 12 }, (_, i) => ({
                  value: String(i + 1),
                  label: new Date(2000, i).toLocaleString("default", { month: "long" }),
                }))}
                ariaLabel="Fiscal Year Start Month"
              />
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
                <FittedSelect
                  value={form.date_format}
                  onChange={(v) => set("date_format", v)}
                  options={[
                    { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
                    { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
                    { value: "DD/MM/YYYY", label: "DD/MM/YYYY" },
                    { value: "DD.MM.YYYY", label: "DD.MM.YYYY" },
                  ]}
                  ariaLabel="Date Format"
                />
              </div>
            </div>
          </fieldset>
          {!readOnly && <SaveButton loading={saving} />}
        </form>
      )}

      {tab === "invoice" && (
        <form onSubmit={handleSave} className="card space-y-4">
          <h2 className="text-lg font-semibold">Invoice Settings</h2>
          <p className="text-sm text-muted">Configure how your invoices look when printed or exported as PDF.</p>
          <fieldset disabled={readOnly} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Company Logo</label>
              <p className="text-xs text-faint mb-2">Displayed on all invoices and PDFs. Recommended size: 300×80px, max 5 MB.</p>
              {form.logo_url ? (
                <div className="flex items-center gap-4">
                  <div className="w-40 h-20 rounded-lg border border-border bg-white flex items-center justify-center overflow-hidden">
                    <img src={form.logo_url} alt="Company logo" className="max-w-full max-h-full object-contain" />
                  </div>
                  {!readOnly && (
                    <div className="flex gap-2">
                      <button type="button" onClick={() => logoInputRef.current?.click()} className="btn-secondary text-sm flex items-center gap-1.5">
                        <Upload size={14} />Replace
                      </button>
                      <button type="button" onClick={handleLogoRemove} className="btn-secondary text-sm flex items-center gap-1.5 text-red-600 dark:text-red-400">
                        <X size={14} />Remove
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div
                  onClick={() => !readOnly && logoInputRef.current?.click()}
                  className={`w-40 h-20 rounded-lg border-2 border-dashed border-border bg-app flex flex-col items-center justify-center gap-1 text-faint ${readOnly ? "" : "hover:border-primary hover:text-primary cursor-pointer transition-colors"}`}
                >
                  {logoUploading ? (
                    <span className="text-xs">Uploading...</span>
                  ) : (
                    <>
                      <ImageIcon size={20} />
                      <span className="text-xs">Upload logo</span>
                    </>
                  )}
                </div>
              )}
              <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={handleLogoUpload} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Tax ID / VAT Number" value={form.tax_id} onChange={(v) => set("tax_id", v)} placeholder="e.g. GB123456789" />
              <Field label="Payment Terms" value={form.payment_terms} onChange={(v) => set("payment_terms", v)} placeholder="e.g. Net 30, Due on Receipt" />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Bank Details</label>
              <textarea className="input" rows={3} value={form.bank_details || ""} onChange={(e) => set("bank_details", e.target.value)} placeholder="Bank name, Account number, Sort code / IBAN&#10;Displayed on invoices for wire transfer payments" />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Invoice Footer Note</label>
              <textarea className="input" rows={2} value={form.footer_note || ""} onChange={(e) => set("footer_note", e.target.value)} placeholder="e.g. Thank you for your business! Terms and conditions apply." />
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
          <form onSubmit={handlePassword} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Current Password</label>
                <input type="password" className="input" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">New Password</label>
                <input type="password" className="input" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} required minLength={6} />
              </div>
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

function Field({ label, value, onChange, type = "text", description, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; description?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-ink mb-1">{label}</label>
      <input type={type} className="input" value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
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
          checked ? "bg-primary-solid" : "bg-subtle-strong"
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
