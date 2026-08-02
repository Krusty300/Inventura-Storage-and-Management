import { useEffect, useState } from "react";
import { Save, KeyRound } from "lucide-react";
import api from "../api/client";
import type { Settings as SettingsType } from "../types";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

export default function Settings() {
  const { can } = useAuth();
  const { addToast } = useToast();

  const [form, setForm] = useState({
    store_name: "", address: "", phone: "", email: "",
    currency_symbol: "$", tax_rate: "0", default_reorder_level: "10",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [pw, setPw] = useState({ current_password: "", new_password: "" });
  const [pwSaving, setPwSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get("/settings").then(({ data }) => {
      if (cancelled) return;
      const s = data as SettingsType;
      setForm({
        store_name: s.store_name, address: s.address, phone: s.phone, email: s.email,
        currency_symbol: s.currency_symbol, tax_rate: s.tax_rate.toString(),
        default_reorder_level: s.default_reorder_level.toString(),
      });
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setSaving(true);
    try {
      await api.put("/settings", {
        ...form,
        tax_rate: parseFloat(form.tax_rate) || 0,
        default_reorder_level: parseInt(form.default_reorder_level) || 10,
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
      addToast("Password changed", "success");
      setPw({ current_password: "", new_password: "" });
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to change password", "error");
    }
    setPwSaving(false);
  };

  const field = (label: string, key: string, type = "text") => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input type={type} className="input" value={(form as any)[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </div>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {can("settings.update") && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Store Information</h2>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {field("Store Name", "store_name")}
              {field("Currency Symbol", "currency_symbol")}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
              <textarea className="input" rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              {field("Phone", "phone")}
              {field("Email", "email", "email")}
            </div>
            <div className="grid grid-cols-2 gap-4">
              {field("Tax Rate (%)", "tax_rate", "number")}
              {field("Default Reorder Level", "default_reorder_level", "number")}
            </div>
            <div className="flex justify-end">
              <button type="submit" disabled={loading || saving} className="btn-primary">
                <Save size={16} className="inline mr-1" />
                {loading ? "Loading..." : saving ? "Saving..." : "Save Settings"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <KeyRound size={18} className="text-gray-400" />
          Change Password
        </h2>
        <form onSubmit={handlePassword} className="space-y-4 max-w-md">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
            <input type="password" className="input" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <input type="password" className="input" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} required minLength={6} />
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={pwSaving} className="btn-primary">
              {pwSaving ? "Updating..." : "Change Password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
