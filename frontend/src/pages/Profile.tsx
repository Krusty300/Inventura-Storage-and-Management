import { useEffect, useRef, useState } from "react";
import {
  Clock, Shield, Save, History, Camera, Trash2,
  Monitor, Download, LogOut, UserCircle,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useDateTimeFormat } from "../hooks/useDateTimeFormat";
import { errorMessage } from "../utils/errors";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import PasswordInput from "../components/PasswordInput";
import FileUploadButton from "../components/FileUploadButton";

interface ActivityEntry {
  id: number;
  user_id: number;
  action: string;
  entity_type: string;
  description: string;
  created_at: string;
}

interface SessionItem {
  id: number;
  ip_address: string;
  user_agent: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
  is_current: boolean;
}

function deviceLabel(ua: string): string {
  if (/Firefox/i.test(ua)) return "Firefox";
  if (/Edg/i.test(ua)) return "Edge";
  if (/Chrome/i.test(ua)) return "Chrome";
  if (/Safari/i.test(ua)) return "Safari";
  return (ua.split(" ")[0] || "Unknown device").slice(0, 24);
}

const ROLE_BADGE: Record<string, string> = {
  admin: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400 border-sky-200 dark:border-sky-500/30",
  manager: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 border-amber-200 dark:border-amber-500/30",
  worker: "bg-gray-100 text-gray-600 dark:bg-gray-500/10 dark:text-gray-400 border-gray-200 dark:border-gray-500/30",
};

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${ROLE_BADGE[role] || ROLE_BADGE.worker}`}>
      {role.charAt(0).toUpperCase() + role.slice(1)}
    </span>
  );
}

export default function Profile() {
  const formatDateTime = useDateTimeFormat();
  const { user, updateUser, logout, completeLogout } = useAuth();
  const { addToast } = useToast();
  const editFormRef = useRef<HTMLFormElement>(null);
  const pwFormRef = useRef<HTMLFormElement>(null);
  const [form, setForm] = useState({ username: "", email: "" });
  const [saving, setSaving] = useState(false);
  const [pw, setPw] = useState({ current_password: "", new_password: "", confirm_password: "" });
  const [pwSaving, setPwSaving] = useState(false);
  const formInitRef = useRef(false);

  const { data: activity = [], isLoading: activityLoading } = useQuery<ActivityEntry[]>({
    queryKey: ["activity-logs", user?.id],
    queryFn: async () => {
      const { data } = await api.get("/activity-logs", { params: { limit: 10 } });
      return data.items.filter((a: ActivityEntry) => a.user_id === user!.id).slice(0, 8);
    },
    enabled: !!user?.id,
    placeholderData: [],
  });

  const queryClient = useQueryClient();
  const { data: sessions = [], isLoading: sessionsLoading } = useQuery<SessionItem[]>({
    queryKey: ["auth-sessions"],
    queryFn: async () => (await api.get("/auth/sessions")).data,
  });

  useEffect(() => {
    if (!user || formInitRef.current) return;
    formInitRef.current = true;
    setForm({ username: user.username, email: user.email });
  }, [user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.put("/auth/me", form);
      updateUser(data);
      addToast("Profile updated", "success");
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to update profile"), "error");
    }
    setSaving(false);
  };

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.new_password !== pw.confirm_password) {
      addToast("New passwords do not match", "error");
      return;
    }
    setPwSaving(true);
    try {
      await api.put("/users/password/change", { current_password: pw.current_password, new_password: pw.new_password });
      addToast("Password changed. You have been signed out of all devices. Please log in with your new password.", "success");
      setPw({ current_password: "", new_password: "", confirm_password: "" });
      logout();
      setTimeout(() => completeLogout(), 600);
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to change password"), "error");
    }
    setPwSaving(false);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const { data } = await api.post("/auth/me/avatar", fd);
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = data.avatar_url;
      });
      updateUser(data);
      addToast("Avatar updated", "success");
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to upload avatar"), "error");
    }
  };

  const handleAvatarRemove = async () => {
    try {
      const { data } = await api.delete("/auth/me/avatar");
      updateUser(data);
      addToast("Avatar removed", "success");
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to remove avatar"), "error");
    }
  };

  const revokeSession = async (id: number) => {
    try {
      await api.delete(`/auth/sessions/${id}`);
      addToast("Session signed out", "success");
      queryClient.invalidateQueries({ queryKey: ["auth-sessions"] });
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to revoke session"), "error");
    }
  };

  const revokeOthers = async () => {
    try {
      await api.delete("/auth/sessions");
      addToast("Other sessions signed out", "success");
      queryClient.invalidateQueries({ queryKey: ["auth-sessions"] });
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to sign out other sessions"), "error");
    }
  };

  const exportData = async () => {
    try {
      const { data } = await api.get("/auth/me/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `my-data-${user?.username}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      addToast("Data exported", "success");
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to export data"), "error");
    }
  };

  if (!user) return null;

  const activeSessions = sessions.filter((s) => !s.revoked_at);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 min-w-0">
        <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
          <UserCircle size={22} strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-ink">Profile</h1>
          <p className="text-sm text-muted mt-0.5">Manage your account details, password, and preferences.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-6 lg:col-span-2">
          <div className="card">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              Account Information
            </h2>
            <div className="flex items-center gap-4 mb-6">
              {user.avatar_url ? (
                <img src={user.avatar_url} alt={user.username}
                  className="h-20 w-20 rounded-full object-cover border border-border" loading="lazy" />
              ) : (
                <div
                  className="h-20 w-20 rounded-full bg-primary-soft dark:bg-primary/20 text-primary-strong dark:text-primary
                    flex items-center justify-center text-2xl font-semibold border border-border"
                >
                  {user.username.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <FileUploadButton
                  onFileChange={handleAvatarUpload}
                  accept=".png,.jpg,.jpeg,.gif,.webp"
                  className="btn-secondary"
                >
                  <Camera size={15} className="inline mr-1" />
                  Upload Avatar
                </FileUploadButton>
                {user.avatar_url && (
                  <button type="button" onClick={handleAvatarRemove} className="btn-secondary">
                    <Trash2 size={15} className="inline mr-1" />
                    Remove
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <InfoItem label="Username" value={user.username} />
              <InfoItem label="Email" value={user.email} />
              <div>
                <p className="text-xs text-faint uppercase tracking-wide mb-0.5">Role</p>
                <RoleBadge role={user.role} />
              </div>
              <InfoItem label="Last Login" value={formatDateTime(user.last_login_at)} />
              <InfoItem label="Member Since" value={formatDateTime(user.created_at)} />
              <InfoItem label="User ID" value={String(user.id)} />
            </div>
          </div>

          <div className="card !p-0 overflow-hidden">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Edit Profile</h2>
              <form ref={editFormRef} onSubmit={handleSave} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">Username</label>
                    <input type="text" className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">Email</label>
                    <input type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
                  </div>
                </div>
              </form>
            </div>
            <div className="flex justify-end px-6 py-3 border-t border-border bg-subtle/50">
              <button type="button" disabled={saving} className="btn-primary"
                onClick={() => editFormRef.current?.requestSubmit()}>
                <Save size={16} className="inline mr-1" />
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>

          <div className="card !p-0 overflow-hidden">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                Change Password
              </h2>
              <form ref={pwFormRef} onSubmit={handlePassword} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Current Password</label>
                  <PasswordInput id="pw-current" value={pw.current_password} onChange={(v) => setPw({ ...pw, current_password: v })} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">New Password</label>
                    <PasswordInput id="pw-new" value={pw.new_password} onChange={(v) => setPw({ ...pw, new_password: v })} minLength={6} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">Confirm New Password</label>
                    <PasswordInput id="pw-confirm" value={pw.confirm_password} onChange={(v) => setPw({ ...pw, confirm_password: v })} minLength={6} />
                  </div>
                </div>
                {pw.new_password && pw.confirm_password && pw.new_password !== pw.confirm_password && (
                  <p className="text-xs text-red-600 dark:text-red-400">Passwords do not match</p>
                )}
              </form>
            </div>
            <div className="flex justify-end px-6 py-3 border-t border-border bg-subtle/50">
              <button type="button" disabled={pwSaving || !pw.current_password || !pw.new_password || pw.new_password !== pw.confirm_password} className="btn-primary"
                onClick={() => pwFormRef.current?.requestSubmit()}>
                {pwSaving ? "Updating..." : "Change Password"}
              </button>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Monitor size={18} className="text-faint" />
                Active Sessions
              </h2>
              {activeSessions.length > 1 && (
                <button type="button" onClick={revokeOthers} className="btn-secondary">
                  <LogOut size={15} className="inline mr-1" />
                  Sign Out Other Devices
                </button>
              )}
            </div>
            {sessionsLoading ? (
              <Skeleton variant="rows" rows={3} cols={3} />
            ) : sessions.length === 0 ? (
              <EmptyState compact title="No session data" message="Sessions from devices you use to sign in will appear here." />
            ) : activeSessions.length === 0 ? (
              <EmptyState compact title="No active sessions" message="All sessions have been signed out." />
            ) : (
              <ul className="divide-y divide-border">
                {activeSessions.map((s) => (
                  <li key={s.id} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-subtle text-muted dark:bg-subtle-strong shrink-0">
                          <Monitor size={16} />
                        </div>
                        <div className="min-w-0 pt-0.5">
                          <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
                            <span className="font-medium truncate">{deviceLabel(s.user_agent)}</span>
                            {s.is_current && (
                              <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary-soft dark:bg-primary/10 text-primary-strong dark:text-primary border border-primary-soft dark:border-primary/30">
                                This device
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-faint mt-1 truncate">
                            {s.ip_address || "Unknown IP"}
                          </p>
                          <p className="text-xs text-faint mt-0.5">
                            Last seen {formatDateTime(s.last_seen_at)}
                          </p>
                        </div>
                      </div>
                      {!s.is_current && (
                        <div className="flex items-start shrink-0 pt-1">
                          <button type="button" onClick={() => revokeSession(s.id)} className="text-sm text-muted hover:text-red-600 whitespace-nowrap">
                            Revoke
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="card">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <History size={18} className="text-faint" />
              Recent Activity
            </h2>
            {activityLoading ? (
              <Skeleton variant="rows" rows={4} cols={3} />
            ) : activity.length === 0 ? (
              <EmptyState compact title="No recent activity found" message="Actions you perform will appear here." />
            ) : (
              <ul className="space-y-3">
                {activity.map((a) => (
                  <li key={a.id} className="text-sm">
                    <div className="flex items-center gap-1.5 text-muted mb-0.5">
                      <Shield size={12} className="text-faint" />
                      <span className="capitalize">{a.entity_type.replace("_", " ")}</span>
                      <span className="text-faint">·</span>
                      <Clock size={12} className="text-faint" />
                      <span className="text-xs">{formatDateTime(a.created_at)}</span>
                    </div>
                    <p className="text-ink">{a.description}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card">
            <h2 className="text-lg font-semibold mb-2">Data & Privacy</h2>
            <p className="text-sm text-muted mb-4">
              Download a JSON file with your profile, activity log, notifications, and the records you created.
            </p>
            <button type="button" onClick={exportData} className="btn-primary w-full justify-center">
              <Download size={16} className="inline mr-1" />
              Export My Data
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-faint uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-sm text-ink">{value}</p>
    </div>
  );
}
