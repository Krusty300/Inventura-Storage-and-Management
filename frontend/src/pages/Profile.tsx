import { useEffect, useRef, useState } from "react";
import {
  User as Clock, Shield, Save, History, Camera, Trash2,
  Monitor, Download, LogOut,
} from "lucide-react";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useDateTimeFormat } from "../hooks/useDateTimeFormat";

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

export default function Profile() {
  const formatDateTime = useDateTimeFormat();
  const { user, updateUser, logout } = useAuth();
  const { addToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ username: "", email: "" });
  const [saving, setSaving] = useState(false);
  const [pw, setPw] = useState({ current_password: "", new_password: "" });
  const [pwSaving, setPwSaving] = useState(false);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);

  useEffect(() => {
    if (!user) return;
    setForm({ username: user.username, email: user.email });
    let cancelled = false;
    api.get("/activity-logs", { params: { limit: 10 } }).then(({ data }) => {
      if (cancelled) return;
      setActivity(data.items.filter((a: ActivityEntry) => a.user_id === user.id).slice(0, 8));
    }).catch(() => { if (!cancelled) setActivity([]); });
    return () => { cancelled = true; };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadSessions = () => {
    api.get("/auth/sessions").then(({ data }) => setSessions(data)).catch(() => {});
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.put("/auth/me", form);
      updateUser(data);
      addToast("Profile updated", "success");
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to update profile", "error");
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

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const { data } = await api.post("/auth/me/avatar", fd);
      updateUser(data);
      addToast("Avatar updated", "success");
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to upload avatar", "error");
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleAvatarRemove = async () => {
    try {
      const { data } = await api.delete("/auth/me/avatar");
      updateUser(data);
      addToast("Avatar removed", "success");
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to remove avatar", "error");
    }
  };

  const revokeSession = async (id: number) => {
    try {
      await api.delete(`/auth/sessions/${id}`);
      addToast("Session signed out", "success");
      loadSessions();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to revoke session", "error");
    }
  };

  const revokeOthers = async () => {
    try {
      await api.delete("/auth/sessions");
      addToast("Other sessions signed out", "success");
      loadSessions();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to sign out other sessions", "error");
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
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to export data", "error");
    }
  };

  if (!user) return null;

  const activeSessions = sessions.filter((s) => !s.revoked_at);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">Profile</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-6 lg:col-span-2">
          <div className="card">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              Account Information
            </h2>
            <div className="flex items-center gap-4 mb-6">
              {user.avatar_url ? (
                <img src={user.avatar_url} alt={user.username}
                  className="h-20 w-20 rounded-full object-cover border border-border" />
              ) : (
                <div
                  className="h-20 w-20 rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-400
                    flex items-center justify-center text-2xl font-semibold border border-border"
                >
                  {user.username.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => fileRef.current?.click()} className="btn-secondary">
                  <Camera size={15} className="inline mr-1" />
                  Upload Avatar
                </button>
                {user.avatar_url && (
                  <button type="button" onClick={handleAvatarRemove} className="btn-secondary">
                    <Trash2 size={15} className="inline mr-1" />
                    Remove
                  </button>
                )}
                <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.gif,.webp" className="hidden"
                  onChange={handleAvatarUpload} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <InfoItem label="Username" value={user.username} />
              <InfoItem label="Email" value={user.email} />
              <InfoItem label="Role" value={user.role} />
              <InfoItem label="Last Login" value={formatDateTime(user.last_login_at)} />
              <InfoItem label="Member Since" value={formatDateTime(user.created_at)} />
              <InfoItem label="User ID" value={String(user.id)} />
            </div>
          </div>

          <div className="card">
            <h2 className="text-lg font-semibold mb-4">Edit Profile</h2>
            <form onSubmit={handleSave} className="space-y-4 max-w-md">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Username</label>
                <input type="text" className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Email</label>
                <input type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              </div>
              <div className="flex justify-end">
                <button type="submit" disabled={saving} className="btn-primary">
                  <Save size={16} className="inline mr-1" />
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>

          <div className="card">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
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
            {activeSessions.length === 0 ? (
              <p className="text-sm text-muted">No active sessions.</p>
            ) : (
              <ul className="divide-y divide-border">
                {activeSessions.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm text-ink">
                        <Monitor size={15} className="text-faint shrink-0" />
                        <span className="font-medium truncate">{deviceLabel(s.user_agent)}</span>
                        {s.is_current && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30">
                            This device
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-faint mt-0.5 truncate">
                        {s.ip_address || "Unknown IP"} · Last seen {formatDateTime(s.last_seen_at)}
                      </p>
                    </div>
                    {!s.is_current && (
                      <button type="button" onClick={() => revokeSession(s.id)} className="text-sm text-muted hover:text-red-600 shrink-0">
                        Revoke
                      </button>
                    )}
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
            {activity.length === 0 ? (
              <p className="text-sm text-muted">No recent activity found.</p>
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
