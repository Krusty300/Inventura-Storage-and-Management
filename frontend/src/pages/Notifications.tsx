import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCheck, Info, PackageCheck, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { Notification, PaginatedResponse } from "../types";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import Pagination from "../components/Pagination";
import { usePageSize } from "../hooks/usePageSize";
import { useDateTimeFormat } from "../hooks/useDateTimeFormat";
import { useToast } from "../context/ToastContext";
import { errorMessage } from "../utils/errors";

const typeIcon: Record<string, typeof Info> = {
  warning: AlertTriangle,
  success: PackageCheck,
  info: Info,
};

const typeBadge: Record<string, string> = {
  warning: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 border-amber-200 dark:border-amber-500/30",
  success: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30",
  info: "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400 border-indigo-200 dark:border-indigo-500/30",
};

type Tab = "all" | "unread" | "warning" | "success";

export default function Notifications() {
  const formatDateTime = useDateTimeFormat();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { pageSize, setPageSize } = usePageSize();
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<Tab>("all");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["notifications", "page", page, tab, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() };
      if (tab === "unread") params.unread_only = "true";
      else if (tab === "warning" || tab === "success") params.type = tab;
      const { data } = await api.get("/notifications", { params });
      return data as PaginatedResponse<Notification>;
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  const markRead = useMutation({
    mutationFn: async (n: Notification) => {
      if (n.is_read) return;
      await api.put(`/notifications/${n.id}/read`);
    },
    onSuccess: invalidate,
    onError: (err) => addToast(errorMessage(err, "Failed to update notification"), "error"),
  });

  const markAllRead = useMutation({
    mutationFn: async () => api.put("/notifications/read-all"),
    onSuccess: () => {
      invalidate();
      addToast("All notifications marked as read", "success");
    },
    onError: (err) => addToast(errorMessage(err, "Failed to mark all as read"), "error"),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => api.delete(`/notifications/${id}`),
    onSuccess: () => {
      invalidate();
      addToast("Notification dismissed", "success");
    },
    onError: (err) => addToast(errorMessage(err, "Failed to dismiss notification"), "error"),
  });

  const items = data?.items || [];
  const tabButtons: { key: Tab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "unread", label: "Unread" },
    { key: "warning", label: "Warnings" },
    { key: "success", label: "Success" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Notifications</h1>
          <p className="text-sm text-muted mt-1">Alerts about low stock, expiring lots, and operational events.</p>
        </div>
        <button
          onClick={() => markAllRead.mutate()}
          className="btn-secondary"
          disabled={markAllRead.isPending}
          aria-label="Mark all notifications as read"
        >
          <CheckCheck size={16} className="inline mr-1" />
          {markAllRead.isPending ? "Marking..." : "Mark all read"}
        </button>
      </div>

      {isError && (
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          Failed to load notifications.
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {tabButtons.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => { setTab(key); setPage(1); }}
            className={`px-3 py-1 rounded-md text-sm transition-colors ${
              tab === key ? "bg-surface text-indigo-600 dark:text-indigo-400 shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden p-0">
        {isLoading ? (
          <div className="p-4"><Skeleton variant="rows" rows={8} cols={3} /></div>
        ) : items.length === 0 ? (
          <div className="py-10">
            <EmptyState title="No notifications" message="New notifications will appear here." />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((n) => {
              const Icon = typeIcon[n.type] || Info;
              return (
                <li
                  key={n.id}
                  className={`flex items-start gap-3 px-4 py-3 hover:bg-app ${n.is_read ? "opacity-70" : ""}`}
                >
                  <Icon
                    size={18}
                    className={`mt-0.5 ${n.type === "warning" ? "text-amber-500" : "text-emerald-500"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        className="text-sm font-medium text-ink text-left hover:underline truncate"
                        onClick={() => { if (!n.is_read) markRead.mutate(n); if (n.link) navigate(n.link); }}
                      >
                        {n.title}
                      </button>
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${typeBadge[n.type] || typeBadge.info}`}>
                        {n.type}
                      </span>
                    </div>
                    {n.message && <p className="text-sm text-muted mt-0.5">{n.message}</p>}
                    <p className="text-[10px] text-faint mt-1">{formatDateTime(n.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!n.is_read && (
                      <button
                        onClick={() => markRead.mutate(n)}
                        className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        Mark read
                      </button>
                    )}
                    <button
                      onClick={() => remove.mutate(n.id)}
                      className="p-1 rounded text-faint hover:text-red-600 hover:bg-subtle"
                      aria-label={`Dismiss ${n.title}`}
                      title="Dismiss"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Pagination
        page={page}
        totalPages={data?.pages || 1}
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
      />
    </div>
  );
}
