import { useDateFormat } from "../hooks/useDateFormat";
import { useState } from "react";
import { Shield, ShieldOff, ShieldCheck, Eye, KeyRound, Trash2, UserCheck, Download, Clock, Check, Search, X } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { PaginatedResponse, User } from "../types";
import UserDetail from "../components/UserDetail";
import PermissionsEditor from "../components/PermissionsEditor";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import Modal from "../components/Modal";
import Pagination from "../components/Pagination";
import ConfirmDialog from "../components/ConfirmDialog";
import { useDebounce } from "../hooks/useDebounce";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { exportCSV } from "../utils/csv";

const PASSWORD_HINT = "At least 8 characters.";

import { usePageSize } from "../hooks/usePageSize";

export default function Users() {
  const formatDate = useDateFormat();
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
  const [sortBy, setSortBy] = useState("username");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editRole, setEditRole] = useState("");
  const [viewing, setViewing] = useState<User | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [resetting, setResetting] = useState<User | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);
  const [reactivating, setReactivating] = useState<User | null>(null);
  const [editingPermissions, setEditingPermissions] = useState<User | null>(null);
  const [confirming, setConfirming] = useState<{ user: User; role: string } | null>(null);
  const [activeTab, setActiveTab] = useState<"all" | "pending">("all");
  const [approving, setApproving] = useState<User | null>(null);
  const [approveRole, setApproveRole] = useState("worker");
  const [rejecting, setRejecting] = useState<User | null>(null);
  const queryClient = useQueryClient();
  const { can, user } = useAuth();
  const { addToast } = useToast();
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["users", debouncedSearch, page, pageSize, sortBy, sortDir, showInactive],
    queryFn: async () => {
      const params: Record<string, string> = {
        page: page.toString(),
        page_size: pageSize.toString(),
        sort_by: sortBy,
        sort_dir: sortDir,
      };
      if (debouncedSearch) params.search = debouncedSearch;
      if (showInactive) params.include_inactive = "true";
      const { data } = await api.get("/users", { params });
      return data as PaginatedResponse<User>;
    },
  });

  const users = data?.items || [];

  const { data: pendingData, isLoading: pendingLoading } = useQuery({
    queryKey: ["users", "pending"],
    queryFn: async () => {
      const { data } = await api.get("/users/pending");
      return data as User[];
    },
    enabled: activeTab === "pending",
  });

  const pendingUsers = pendingData || [];

  const approveMutation = useMutation({
    mutationFn: ({ id, role }: { id: number; role: string }) => api.post(`/users/${id}/approve`, { role }),
    onSuccess: () => {
      addToast("User approved", "success");
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setApproving(null);
    },
    onError: (err: any) => addToast(err.response?.data?.detail || "Failed to approve user", "error"),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: number) => api.post(`/users/${id}/reject`),
    onSuccess: () => {
      addToast("User rejected", "success");
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setRejecting(null);
    },
    onError: (err: any) => addToast(err.response?.data?.detail || "Failed to reject user", "error"),
  });

  const handleExport = () => {
    exportCSV(
      ["Username", "Email", "Role", "Last Login", "Created"],
      users.map((u) => [
        u.username,
        u.email,
        u.role,
        u.last_login_at ? formatDate(u.last_login_at) : "",
        formatDate(u.created_at),
      ]),
      "users"
    );
    addToast("Users exported to CSV", "success");
  };

  const toggleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col);
      setSortDir("asc");
    }
    setPage(1);
  };

  const sortIndicator = (col: string) =>
    sortBy === col ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  const sortableHeader = (label: string, col: string) => (
    <th className="px-4 py-3 font-medium text-muted cursor-pointer select-none hover:text-indigo-600 dark:text-indigo-400" onClick={() => toggleSort(col)} aria-label={`Sort by ${col}`}>
      {label}
      {sortIndicator(col)}
    </th>
  );

  const updateMutation = useMutation({
    mutationFn: ({ id, role }: { id: number; role: string }) => api.put(`/users/${id}`, { role }),
    onSuccess: () => {
      addToast("User role updated", "success");
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setEditingId(null);
    },
    onError: (err: any) => addToast(err.response?.data?.detail || "Failed to update user", "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/users/${id}`),
    onSuccess: () => {
      addToast("User deactivated", "success");
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setDeleting(null);
    },
    onError: (err: any) => addToast(err.response?.data?.detail || "Cannot deactivate user", "error"),
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: number) => api.put(`/users/${id}`, { is_active: true }),
    onSuccess: () => {
      addToast("User reactivated", "success");
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setReactivating(null);
    },
    onError: (err: any) => addToast(err.response?.data?.detail || "Failed to reactivate user", "error"),
  });

  const requestRoleChange = (user: User, role: string) => {
    setEditingId(null);
    if (role === user.role) return;
    setConfirming({ user, role });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">User Management</h1>
        <div className="flex gap-2">
          <button onClick={handleExport} className="btn-secondary inline-flex items-center gap-1" aria-label="Export users to CSV">
            <Download size={16} /> Export
          </button>
          {can("users.create") && (
            <button onClick={() => setShowCreate(true)} className="btn-primary inline-flex items-center gap-1">
              Add User
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input className="input pl-10" placeholder="Search by username or email..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search users" />
        </div>
        <div className="flex gap-1 bg-app-alt rounded-lg p-1">
          <button
            onClick={() => setActiveTab("all")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === "all" ? "bg-white dark:bg-gray-700 text-ink shadow-sm" : "text-muted hover:text-ink"}`}
          >
            All Users
          </button>
          <button
            onClick={() => setActiveTab("pending")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors inline-flex items-center gap-1.5 ${activeTab === "pending" ? "bg-white dark:bg-gray-700 text-ink shadow-sm" : "text-muted hover:text-ink"}`}
          >
            <Clock size={14} />
            Pending
            {pendingUsers.length > 0 && (
              <span className="bg-amber-500 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">{pendingUsers.length}</span>
            )}
          </button>
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => { setShowInactive(e.target.checked); setPage(1); }}
            className="accent-indigo-600"
            aria-label="Show deactivated users"
          />
          Show deactivated
        </label>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
        {activeTab === "pending" ? (
          <table className="w-full text-sm" role="grid" aria-label="Pending users table">
            <thead>
              <tr className="bg-app text-left">
                <th scope="col" className="px-4 py-3 font-medium text-muted">Username</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Email</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Requested Role</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Registered</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pendingLoading ? (
                <Skeleton rows={3} cols={5} />
              ) : pendingUsers.length === 0 ? (
                <EmptyState title="No pending users" message="All registrations have been reviewed." />
              ) : pendingUsers.map((u) => (
                <tr key={u.id} className="hover:bg-app">
                  <td className="px-4 py-3 font-medium">{u.username}</td>
                  <td className="px-4 py-3 text-muted">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className={`badge ${u.role === "admin" ? "badge-info" : u.role === "manager" ? "badge-success" : "badge-warning"}`}>{u.role}</span>
                  </td>
                  <td className="px-4 py-3 text-muted">{formatDate(u.created_at)}</td>
                  <td className="px-4 py-3">
                    {can("users.update") && (
                      <div className="flex gap-2 items-center">
                        <button onClick={() => { setApproving(u); setApproveRole(u.role); }} className="inline-flex items-center gap-1 btn-primary text-xs py-1 px-2">
                          <Check size={14} /> Approve
                        </button>
                        <button onClick={() => setRejecting(u)} className="inline-flex items-center gap-1 btn-secondary text-xs py-1 px-2 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300">
                          <X size={14} /> Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
        <table className="w-full text-sm" role="grid" aria-label="Users table">
          <thead>
            <tr className="bg-app text-left">
              {sortableHeader("Username", "username")}
              {sortableHeader("Email", "email")}
              {sortableHeader("Role", "role")}
              {sortableHeader("Last Login", "last_login_at")}
              {sortableHeader("Created", "created_at")}
              <th scope="col" className="px-4 py-3 font-medium text-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <Skeleton rows={5} cols={6} />
            ) : isError ? (
              <EmptyState title="Access denied" message="Only administrators can view and manage users." />
            ) : !users || users.length === 0 ? (
              <EmptyState
                title="No users found"
                message="Use Add User to create accounts for your team."
                actionLabel={can("users.create") ? "Add User" : undefined}
                onAction={can("users.create") ? () => setShowCreate(true) : undefined}
              />
            ) : users.map((u) => (
              <tr key={u.id} className="hover:bg-app">
                <td className="px-4 py-3 font-medium">
                  <span className="inline-flex items-center gap-2">
                    {u.username}
                    {u.is_approved === false && <span className="badge badge-warning"><Clock size={10} className="mr-0.5" /> Pending</span>}
                    {!u.is_active && <span className="badge badge-danger">Inactive</span>}
                    {user && u.id === user.id && <span className="badge badge-success">You</span>}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted">{u.email}</td>
                <td className="px-4 py-3">
                  {editingId === u.id ? (
                    <select className="select text-sm py-1" value={editRole} onChange={(e) => setEditRole(e.target.value)} aria-label={`Edit role for ${u.username}`}>
                      <option value="worker">worker</option>
                      <option value="manager">manager</option>
                      {can("users.assign_admin_role") && <option value="admin">admin</option>}
                    </select>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      {u.role === "admin" ? <Shield size={14} className="text-indigo-500" /> : u.role === "manager" ? <ShieldCheck size={14} className="text-blue-500" /> : <ShieldOff size={14} className="text-faint" />}
                      <span className={`badge ${u.role === "admin" ? "badge-info" : u.role === "manager" ? "badge-success" : "badge-warning"}`}>{u.role}</span>
                      {u.role !== "admin" && u.permissions && u.permissions.length > 0 && (
                        <span className="badge badge-success" title={`${u.permissions.length} custom permission(s)`}>Custom</span>
                      )}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted">{u.last_login_at ? formatDate(u.last_login_at) : "Never"}</td>
                <td className="px-4 py-3 text-muted">{formatDate(u.created_at)}</td>
                <td className="px-4 py-3">
                  {editingId === u.id ? (
                    <div className="flex gap-2">
                      <button onClick={() => requestRoleChange(u, editRole)} className="btn-primary text-xs py-1 px-2">Save</button>
                      <button onClick={() => setEditingId(null)} className="btn-secondary text-xs py-1 px-2">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex gap-2 items-center">
                      <button onClick={() => setViewing(u)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`View ${u.username}`}><Eye size={16} /></button>
                      {!u.is_active && can("users.update") && (
                        <button onClick={() => setReactivating(u)} className="p-1 text-faint hover:text-green-600 dark:text-green-400" aria-label={`Reactivate ${u.username}`}><UserCheck size={16} /></button>
                      )}
                      {u.is_active && can("users.update") && (
                        <button onClick={() => setResetting(u)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Reset password for ${u.username}`}><KeyRound size={16} /></button>
                      )}
                      {u.is_active && can("users.delete") && (!user || u.id !== user.id) && (
                        <button onClick={() => setDeleting(u)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Deactivate ${u.username}`}><Trash2 size={16} /></button>
                      )}
                      {u.is_active && can("users.update") && (!user || u.id !== user.id) && (
                        <button onClick={() => { setEditingId(u.id); setEditRole(u.role); }} className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:text-indigo-400">Edit</button>
                      )}
                      {u.is_active && u.role !== "admin" && can("users.update") && (!user || u.id !== user.id) && (
                        <button onClick={() => setEditingPermissions(u)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" title="Manage permissions" aria-label={`Manage permissions for ${u.username}`}><ShieldCheck size={16} /></button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
        </div>
      </div>

      {viewing && <UserDetail user={viewing} onClose={() => setViewing(null)} />}

      {editingPermissions && (
        <PermissionsEditor
          user={editingPermissions}
          onClose={() => setEditingPermissions(null)}
          onSaved={() => { setEditingPermissions(null); queryClient.invalidateQueries({ queryKey: ["users"] }); }}
        />
      )}

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); queryClient.invalidateQueries({ queryKey: ["users"] }); }}
        />
      )}

      {resetting && (
        <ResetPasswordModal
          user={resetting}
          onClose={() => setResetting(null)}
          onSaved={() => { setResetting(null); queryClient.invalidateQueries({ queryKey: ["users"] }); }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Deactivate User"
        message={`Deactivate "${deleting?.username}"? They will no longer be able to sign in. This can be reversed by an administrator.`}
        confirmLabel="Deactivate"
        onConfirm={() => deleteMutation.mutate(deleting!.id)}
        onCancel={() => setDeleting(null)}
      />

      <ConfirmDialog
        open={!!reactivating}
        title="Reactivate User"
        message={`Reactivate "${reactivating?.username}"? They will be able to sign in again.`}
        confirmLabel="Reactivate"
        confirmClass="btn-primary"
        onConfirm={() => reactivateMutation.mutate(reactivating!.id)}
        onCancel={() => setReactivating(null)}
      />

      <ConfirmDialog
        open={!!confirming}
        title="Confirm Role Change"
        message={`Change "${confirming?.user.username}"'s role from ${confirming?.user.role} to ${confirming?.role}?`}
        confirmLabel="Confirm"
        confirmClass="btn-primary"
        onConfirm={() => {
          if (confirming) updateMutation.mutate({ id: confirming.user.id, role: confirming.role });
          setConfirming(null);
        }}
        onCancel={() => setConfirming(null)}
      />

      {approving && (
        <Modal open onClose={() => setApproving(null)} title={`Approve ${approving.username}`}>
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Approve <strong>{approving.username}</strong> ({approving.email}) and assign a role:
            </p>
            <div>
              <label htmlFor="approve-role" className="block text-sm font-medium text-ink mb-1">Role</label>
              <select id="approve-role" className="select" value={approveRole} onChange={(e) => setApproveRole(e.target.value)}>
                <option value="worker">Worker</option>
                <option value="manager">Manager</option>
                {can("users.assign_admin_role") && <option value="admin">Admin</option>}
              </select>
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <button onClick={() => setApproving(null)} className="btn-secondary">Cancel</button>
              <button onClick={() => approveMutation.mutate({ id: approving.id, role: approveRole })} className="btn-primary inline-flex items-center gap-1">
                <Check size={16} /> Approve
              </button>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={!!rejecting}
        title="Reject User"
        message={`Reject "${rejecting?.username}"'s registration? Their account will be deactivated.`}
        confirmLabel="Reject"
        confirmClass="btn-primary"
        onConfirm={() => {
          if (rejecting) rejectMutation.mutate(rejecting.id);
        }}
        onCancel={() => setRejecting(null)}
      />

      <Pagination page={page} totalPages={data?.pages || 1} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
    </div>
  );
}

function CreateUserModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ username: "", email: "", password: "", role: "worker" });
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();
  const { can } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/users", form);
      addToast(`User ${form.username} created`, "success");
      onSaved();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to create user", "error");
    }
    setSaving(false);
  };

  const field = (label: string, key: string, id: string, type = "text") => (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink mb-1">{label}</label>
      <input id={id} type={type} className="input" value={(form as any)[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} required />
    </div>
  );

  return (
    <Modal open onClose={onClose} title="Add User">
      <form onSubmit={handleSubmit} className="space-y-4">
        {field("Username", "username", "create-username")}
        {field("Email", "email", "create-email", "email")}
        <div>
          <label htmlFor="create-password" className="block text-sm font-medium text-ink mb-1">Password</label>
          <input id="create-password" type="password" className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          <p className="text-xs text-muted mt-1">{PASSWORD_HINT}</p>
        </div>
        <div>
          <label htmlFor="create-role" className="block text-sm font-medium text-ink mb-1">Role</label>
          <select id="create-role" className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="worker">Worker</option>
            <option value="manager">Manager</option>
            {can("users.assign_admin_role") && <option value="admin">Admin</option>}
          </select>
        </div>
        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? "Creating..." : "Create User"}</button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: () => void }) {
  const [new_password, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/users/${user.id}/reset-password`, { new_password });
      addToast(`Password reset for ${user.username}`, "success");
      onSaved();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Failed to reset password", "error");
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title={`Reset Password — ${user.username}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-muted">Set a new password for <strong>{user.username}</strong>. The user will need to sign in with this new password.</p>
        <div>
          <label htmlFor="reset-password" className="block text-sm font-medium text-ink mb-1">New password</label>
          <input id="reset-password" type="password" className="input" value={new_password} onChange={(e) => setNewPassword(e.target.value)} required />
          <p className="text-xs text-muted mt-1">{PASSWORD_HINT}</p>
        </div>
        <div className="flex justify-end gap-3 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? "Resetting..." : "Reset Password"}</button>
        </div>
      </form>
    </Modal>
  );
}
