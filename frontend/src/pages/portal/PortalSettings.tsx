import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Settings as SettingsIcon, Image as ImageIcon, KeyRound, Camera, Trash2 } from "lucide-react";
import api from "../../api/client";
import { useToast } from "../../context/ToastContext";
import { errorMessage } from "../../utils/errors";
import { entityImageUrl } from "../../utils/images";
import { onImageError, getPlaceholder } from "../../utils/placeholders";
import PasswordInput from "../../components/PasswordInput";
import FileUploadButton from "../../components/FileUploadButton";
import type { PortalMe, Supplier } from "../../types";

const DEFAULT_SUPPLIER_PREFERENCES = {
  auto_acknowledge: false,
  notify_new_orders: true,
  show_lead_time: true,
  default_page_size: 10,
} as Record<string, unknown>;

type Tab = "profile" | "preferences" | "password";

const TABS: { key: Tab; label: string }[] = [
  { key: "profile", label: "Profile" },
  { key: "preferences", label: "Preferences" },
  { key: "password", label: "Password" },
];

function Toggle({ label, checked, onChange, description }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; description?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-4 sm:col-span-2 p-3 rounded-lg border border-border hover:bg-app cursor-pointer">
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

interface PortalSettings {
  supplier_id: number;
  supplier_name: string;
  preferences: Record<string, unknown>;
}

export default function PortalSettings() {
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const { data: me, isLoading: meLoading } = useQuery({
    queryKey: ["portal", "me"],
    queryFn: async () => (await api.get("/portal/me")).data as PortalMe,
  });

  const { data: settingsData, isLoading: settingsLoading } = useQuery({
    queryKey: ["portal", "settings"],
    queryFn: async () => (await api.get("/portal/settings")).data as PortalSettings,
  });

  const portalLoading = meLoading || settingsLoading;

  const supplier: Supplier | null = me?.supplier ?? null;

  const form = useMemo(() => ({
    name: supplier?.name ?? settingsData?.supplier_name ?? "",
    contact_person: supplier?.contact_person ?? "",
    email: supplier?.email ?? "",
    phone: supplier?.phone ?? "",
    address: supplier?.address ?? "",
    notes: supplier?.notes ?? "",
    lead_time_days: supplier?.lead_time_days?.toString() ?? "",
  }), [supplier, settingsData]);

  const prefs = useMemo(
    () => ({ ...DEFAULT_SUPPLIER_PREFERENCES, ...(settingsData?.preferences ?? {}) }),
    [settingsData]
  );

const [profileDraft, setProfileDraft] = useState(form);
  const [prefDraft, setPrefDraft] = useState(prefs);
  const [tab, setTab] = useState<Tab>("profile");
  const [pw, setPw] = useState({ current_password: "", new_password: "", confirm_password: "" });
  const [pwSaving, setPwSaving] = useState(false);
  const profileInitRef = useRef(false);

  useEffect(() => {
    if (portalLoading || !me || !settingsData) return;
    if (profileInitRef.current) return;
    profileInitRef.current = true;
    setProfileDraft(form);
    setPrefDraft(prefs);
  }, [form, prefs, portalLoading, me, settingsData]);

  const updateProfile = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data } = await api.patch("/portal/profile", payload);
      return data as PortalMe["supplier"];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal"] });
      addToast("Profile updated", "success");
    },
    onError: (err) => addToast(errorMessage(err, "Failed to update profile"), "error"),
  });

  const updatePrefs = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data } = await api.patch("/portal/settings", payload);
      return data as PortalSettings;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal"] });
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      addToast("Preferences saved", "success");
    },
    onError: (err) => addToast(errorMessage(err, "Failed to save preferences"), "error"),
  });

  const uploadImage = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/portal/profile/image", fd);
      return data as { image_url: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal"] });
      addToast("Logo updated", "success");
    },
    onError: (err) => addToast(errorMessage(err, "Failed to upload logo"), "error"),
  });

  const removeImage = useMutation({
    mutationFn: async () => {
      const { data } = await api.delete("/portal/profile/image");
      return data as { image_url: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal"] });
      addToast("Logo removed", "success");
    },
    onError: (err) => addToast(errorMessage(err, "Failed to remove logo"), "error"),
  });

  const changePassword = useMutation({
    mutationFn: async () => {
      await api.post("/portal/change-password", {
        current_password: pw.current_password,
        new_password: pw.new_password,
      });
    },
    onSuccess: () => {
      setPw({ current_password: "", new_password: "", confirm_password: "" });
      addToast("Password changed", "success");
    },
    onError: (err) => addToast(errorMessage(err, "Failed to change password"), "error"),
  });

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.new_password !== pw.confirm_password) {
      addToast("Passwords do not match", "error");
      return;
    }
    setPwSaving(true);
    try {
      await changePassword.mutateAsync();
    } catch {
      // The mutation's onError already surfaces the toast; a thrown rejection
      // here would be an unhandled promise rejection and leave the button stuck.
    } finally {
      setPwSaving(false);
    }
  };

  const imageUrl = supplier?.image_url ? entityImageUrl(supplier.image_url) : getPlaceholder();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 min-w-0">
        <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
          <SettingsIcon size={22} strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-ink">Settings</h1>
          <p className="text-sm text-muted mt-1">Manage your company profile and portal preferences.</p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === key
                ? "bg-primary-soft dark:bg-primary/10 text-primary-strong dark:text-primary border border-primary-soft dark:border-primary/30"
                : "text-muted hover:bg-subtle hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "profile" && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <ImageIcon size={18} /> Company Profile
          </h2>
          {portalLoading ? (
            <div className="space-y-6 animate-pulse" aria-hidden="true">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-xl border border-border bg-subtle-strong" />
                <div className="h-9 w-28 rounded-lg bg-subtle-strong" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[false, false, false, false, true, true].map((full, i) => (
                  <div key={i} className={full ? "sm:col-span-2" : ""}>
                    <div className="h-3 w-24 bg-subtle-strong rounded mb-1.5" />
                    <div className="h-10 rounded-lg bg-subtle-strong" />
                  </div>
                ))}
              </div>
              <div className="flex justify-end">
                <div className="h-10 w-28 rounded-lg bg-subtle-strong" />
              </div>
            </div>
          ) : (
          <>
          <div className="flex items-center gap-4 mb-6">
            <img src={imageUrl} alt={form.name} onError={onImageError} className="h-16 w-16 rounded-xl object-cover border border-border" />
            <div className="flex flex-wrap gap-2">
              <FileUploadButton onFileChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadImage.mutate(f);
              }} accept=".png,.jpg,.jpeg,.gif,.webp" className="btn-secondary">
                <Camera size={15} className="inline mr-1" />
                Upload Logo
              </FileUploadButton>
              {supplier?.image_url && (
                <button type="button" onClick={() => removeImage.mutate()} className="btn-secondary" disabled={removeImage.isPending}>
                  <Trash2 size={15} className="inline mr-1" />
                  Remove
                </button>
              )}
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateProfile.mutate({
                name: profileDraft.name,
                contact_person: profileDraft.contact_person,
                email: profileDraft.email,
                phone: profileDraft.phone,
                address: profileDraft.address,
                notes: profileDraft.notes,
                lead_time_days: profileDraft.lead_time_days === "" ? null : Number(profileDraft.lead_time_days),
              });
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Company Name *</label>
                <input className="input" value={profileDraft.name} onChange={(e) => setProfileDraft({ ...profileDraft, name: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Contact Person</label>
                <input className="input" value={profileDraft.contact_person} onChange={(e) => setProfileDraft({ ...profileDraft, contact_person: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Email</label>
                <input type="email" className="input" value={profileDraft.email} onChange={(e) => setProfileDraft({ ...profileDraft, email: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Phone</label>
                <input className="input" value={profileDraft.phone} onChange={(e) => setProfileDraft({ ...profileDraft, phone: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-ink mb-1">Address</label>
                <input className="input" value={profileDraft.address} onChange={(e) => setProfileDraft({ ...profileDraft, address: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-ink mb-1">Notes</label>
                <input className="input" value={profileDraft.notes} onChange={(e) => setProfileDraft({ ...profileDraft, notes: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Lead Time (days)</label>
                <input type="number" min={0} className="input" value={profileDraft.lead_time_days} onChange={(e) => setProfileDraft({ ...profileDraft, lead_time_days: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end">
              <button type="submit" className="btn-primary" disabled={updateProfile.isPending}>
                <Save size={16} className="inline mr-1" />
                {updateProfile.isPending ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
          </>
          )}
        </div>
      )}

      {tab === "preferences" && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <SettingsIcon size={18} /> Portal Preferences
          </h2>
          <p className="text-sm text-muted mb-4">These preferences control how your portal behaves.</p>
          {portalLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-pulse" aria-hidden="true">
              {[true, true, true, false].map((full, i) => (
                <div key={i} className={full ? "sm:col-span-2" : ""}>
                  <div className="h-12 rounded-lg border border-border bg-subtle-strong" />
                </div>
              ))}
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const payload: Record<string, unknown> = {
                  auto_acknowledge: prefDraft.auto_acknowledge,
                  notify_new_orders: prefDraft.notify_new_orders,
                  show_lead_time: prefDraft.show_lead_time,
                  default_page_size: Number(prefDraft.default_page_size ?? 10),
                };
                updatePrefs.mutate(payload);
              }}
              className="grid grid-cols-1 sm:grid-cols-2 gap-4"
            >
              <div className="sm:col-span-2">
                <Toggle
                  label="Auto-acknowledge approved orders"
                  description="When we approve a purchase order, mark it as acknowledged immediately."
                  checked={!!prefDraft.auto_acknowledge}
                  onChange={(v) => setPrefDraft((d) => ({ ...d, auto_acknowledge: v }))}
                />
              </div>
              <div className="sm:col-span-2">
                <Toggle
                  label="Notify me of new orders"
                  description="Send a notification when a purchase order is approved."
                  checked={!!prefDraft.notify_new_orders}
                  onChange={(v) => setPrefDraft((d) => ({ ...d, notify_new_orders: v }))}
                />
              </div>
              <div className="sm:col-span-2">
                <Toggle
                  label="Show lead time"
                  description="Display expected delivery lead time on order details."
                  checked={!!prefDraft.show_lead_time}
                  onChange={(v) => setPrefDraft((d) => ({ ...d, show_lead_time: v }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Default page size</label>
                <select className="input" value={String(prefDraft.default_page_size ?? 10)} onChange={(e) => setPrefDraft((d) => ({ ...d, default_page_size: e.target.value }))}>
                  <option value="10">10</option>
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
              </div>
              <div className="flex justify-end">
                <button type="submit" className="btn-primary" disabled={updatePrefs.isPending}>
                  <Save size={16} className="inline mr-1" />
                  {updatePrefs.isPending ? "Saving..." : "Save Preferences"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {tab === "password" && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <KeyRound size={18} /> Change Password
          </h2>
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1" htmlFor="portal-pw-current">Current Password</label>
              <PasswordInput id="portal-pw-current" value={pw.current_password} onChange={(v) => setPw((p) => ({ ...p, current_password: v }))} autoComplete="current-password" />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1" htmlFor="portal-pw-new">New Password</label>
              <PasswordInput id="portal-pw-new" value={pw.new_password} onChange={(v) => setPw((p) => ({ ...p, new_password: v }))} autoComplete="new-password" />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1" htmlFor="portal-pw-confirm">Confirm New Password</label>
              <PasswordInput id="portal-pw-confirm" value={pw.confirm_password} onChange={(v) => setPw((p) => ({ ...p, confirm_password: v }))} autoComplete="new-password" />
            </div>
            <div className="flex justify-end">
              <button type="submit" className="btn-primary" disabled={pwSaving}>
                <KeyRound size={16} className="inline mr-1" />
                {pwSaving ? "Changing..." : "Change Password"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}