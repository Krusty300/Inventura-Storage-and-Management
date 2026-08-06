import { useState } from "react";
import { Shield, ShieldOff, Eye, KeyRound, Trash2, Download } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { PaginatedResponse } from "../types";
import UserDetail from "../components/UserDetail";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import Modal from "../components/Modal";
import Pagination from "../components/Pagination";
import ConfirmDialog from "../components/ConfirmDialog";
import { useDebounce } from "../hooks/useDebounce";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { exportCSV } from "../utils/csv";

interface User {
  id: number;
  username: string;
  email: string;
  role: string;
  last_login_at: string | null;
  created_at: string;
}

const PASSWORD_HINT = "At least 8 characters.";

const PAGE_SIZE = 25;

export default function Users() {
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [sortBy, setSortBy] = useState("username");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editRole, setEditRole] = useState("");
  const [viewing, setViewing] = useState<User | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [resetting, setResetting] = useState<User | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);
  const [confirming, setConfirming] = useState<{ user: User; role: string } | null>(null);
  const queryClient = useQueryClient();
  const { can, user } = useAuth();
  const { addToast } = useToast();
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["users", debouncedSearch, page, pageSize, sortBy, sortDir],
    queryFn: async () => {
      const params: Record<string, string> = {
        page: page.toString(),
        page_size: pageSize.toString(),
        sort_by: sortBy,
        sort_dir: sortDir,
      };
      if (debouncedSearch) params.search = debouncedSearch;
      const { data } = await api.get("/users", { params });
      return data as PaginatedResponse<User>;
    },
  });

  const users = data?.items || [];

  const handleExport = () => {
    exportCSV(
      ["Username", "Email", "Role", "Last Login", "Created"],
      users.map((u) => [
        u.username,
        u.email,
        u.role,
        u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : "",
        new Date(u.created_at).toLocaleDateString(),
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
          <input className="input pl-10" placeholder="Search by username or email..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search users" />
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm" role="grid" aria-label="Users table">
          <thead>
            <tr className="bg-app text-left">
              {sortableHeader("Username", "username")}
              {sortableHeader("Email", "email")}
              {sortableHeader("Role", "role")}
              {sortableHeader("Last Login", "last_login_at")}
              {sortableHeader("Created", "created_at")}
              <th className="px-4 py-3 font-medium text-muted">Actions</th>
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
                    {user && u.id === user.id && <span className="badge badge-success">You</span>}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted">{u.email}</td>
                <td className="px-4 py-3">
                  {editingId === u.id ? (
                    <select className="select text-sm py-1" value={editRole} onChange={(e) => setEditRole(e.target.value)} aria-label={`Edit role for ${u.username}`}>
                      <option value="worker">worker</option>
                      <option value="admin">admin</option>
                    </select>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      {u.role === "admin" ? <Shield size={14} className="text-indigo-500" /> : <ShieldOff size={14} className="text-faint" />}
                      <span className={`badge ${u.role === "admin" ? "badge-info" : "badge-warning"}`}>{u.role}</span>
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted">{u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : "Never"}</td>
                <td className="px-4 py-3 text-muted">{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  {editingId === u.id ? (
                    <div className="flex gap-2">
                      <button onClick={() => requestRoleChange(u, editRole)} className="btn-primary text-xs py-1 px-2">Save</button>
                      <button onClick={() => setEditingId(null)} className="btn-secondary text-xs py-1 px-2">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex gap-2 items-center">
                      <button onClick={() => setViewing(u)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`View ${u.username}`}><Eye size={16} /></button>
                      {can("users.update") && (
                        <button onClick={() => setResetting(u)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={`Reset password for ${u.username}`}><KeyRound size={16} /></button>
                      )}
                      {can("users.delete") && (!user || u.id !== user.id) && (
                        <button onClick={() => setDeleting(u)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Deactivate ${u.username}`}><Trash2 size={16} /></button>
                      )}
                      {can("users.update") && (!user || u.id !== user.id) && (
                        <button onClick={() => { setEditingId(u.id); setEditRole(u.role); }} className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:text-indigo-400">Edit</button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {viewing && <UserDetail user={viewing} onClose={() => setViewing(null)} />}

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

      <Pagination page={page} totalPages={data?.pages || 1} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
    </div>
  );
}

function CreateUserModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ username: "", email: "", password: "", role: "worker" });
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

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
            <option value="admin">Admin</option>
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
