import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Settings as SettingsIcon, KeyRound, Image as ImageIcon, Camera, Trash2 } from "lucide-react";
import api from "../../api/client";
import { useToast } from "../../context/ToastContext";
import { errorMessage } from "../../utils/errors";
import PasswordInput from "../../components/PasswordInput";
import FileUploadButton from "../../components/FileUploadButton";
import { entityImageUrl } from "../../utils/images";
import { getPlaceholder, onImageError } from "../../utils/placeholders";
import type { Customer, CustomerPortalMe } from "../../types";

type Tab = "profile" | "password";

const TABS: { key: Tab; label: string }[] = [
  { key: "profile", label: "Profile" },
  { key: "password", label: "Password" },
];

export default function CustomerSettings() {
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const { data: me, isLoading: meLoading } = useQuery({
    queryKey: ["customer", "me"],
    queryFn: async () => (await api.get("/customer/me")).data as CustomerPortalMe,
  });
  const [tab, setTab] = useState<Tab>("profile");

  const customer: Customer | null = me?.customer ?? null;

  const form = useMemo(() => ({
    name: customer?.name ?? "",
    phone: customer?.phone ?? "",
    email: customer?.email ?? "",
    address: customer?.address ?? "",
  }), [customer]);

  const [draft, setDraft] = useState(form);
  const [draftInit, setDraftInit] = useState(false);
  useEffect(() => {
    if (draftInit || !customer) return;
    setDraftInit(true);
    setDraft(form);
  }, [form, customer, draftInit]);

  const [pw, setPw] = useState({ current_password: "", new_password: "", confirm_password: "" });
  const [pwSaving, setPwSaving] = useState(false);

  const updateProfile = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data } = await api.patch("/customer/profile", payload);
      return data as Customer;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer"] });
      addToast("Profile updated", "success");
    },
    onError: (err) => addToast(errorMessage(err, "Failed to update profile"), "error"),
  });

  const uploadImage = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/customer/profile/image", fd);
      return data as { image_url: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer"] });
      queryClient.invalidateQueries({ queryKey: ["customer", "me"] });
      addToast("Profile image updated", "success");
    },
    onError: (err) => addToast(errorMessage(err, "Failed to upload profile image"), "error"),
  });

  const removeImage = useMutation({
    mutationFn: async () => {
      const { data } = await api.delete("/customer/profile/image");
      return data as { image_url: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer"] });
      queryClient.invalidateQueries({ queryKey: ["customer", "me"] });
      addToast("Profile image removed", "success");
    },
    onError: (err) => addToast(errorMessage(err, "Failed to remove profile image"), "error"),
  });

  const changePassword = useMutation({
    mutationFn: async () => {
      await api.post("/customer/change-password", {
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
    await changePassword.mutateAsync();
    setPwSaving(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 min-w-0">
        <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
          <SettingsIcon size={22} strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-ink">Settings</h1>
          <p className="text-sm text-muted mt-1">Manage your profile and portal password.</p>
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
            <ImageIcon size={18} /> My Profile
          </h2>
          {meLoading && !customer ? (
            <div className="space-y-6 animate-pulse" aria-hidden="true">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[false, false, false, true].map((full, i) => (
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
                <img
                  src={customer?.image_url ? entityImageUrl(customer.image_url) : getPlaceholder()}
                  alt={draft.name || "Customer"}
                  onError={onImageError}
                  className="h-16 w-16 rounded-xl object-cover border border-border"
                />
                <div className="flex flex-wrap gap-2">
                  <FileUploadButton onFileChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadImage.mutate(f);
                  }} accept=".png,.jpg,.jpeg,.gif,.webp" className="btn-secondary">
                    <Camera size={15} className="inline mr-1" />
                    Upload Image
                  </FileUploadButton>
                  {customer?.image_url && (
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
                    name: draft.name,
                    phone: draft.phone,
                    email: draft.email,
                    address: draft.address,
                  });
                }}
                className="space-y-4"
              >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Name *</label>
                  <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Phone</label>
                  <input className="input" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Email</label>
                  <input type="email" className="input" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-ink mb-1">Address</label>
                  <input className="input" value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
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

      {tab === "password" && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <KeyRound size={18} /> Change Password
          </h2>
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1" htmlFor="customer-pw-current">Current Password</label>
              <PasswordInput id="customer-pw-current" value={pw.current_password} onChange={(v) => setPw((p) => ({ ...p, current_password: v }))} autoComplete="current-password" />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1" htmlFor="customer-pw-new">New Password</label>
              <PasswordInput id="customer-pw-new" value={pw.new_password} onChange={(v) => setPw((p) => ({ ...p, new_password: v }))} autoComplete="new-password" />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1" htmlFor="customer-pw-confirm">Confirm New Password</label>
              <PasswordInput id="customer-pw-confirm" value={pw.confirm_password} onChange={(v) => setPw((p) => ({ ...p, confirm_password: v }))} autoComplete="new-password" />
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