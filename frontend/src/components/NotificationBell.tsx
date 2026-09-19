import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck, AlertTriangle, Info, PackageCheck, X, ArrowRight } from "lucide-react";
import EmptyState from "./EmptyState";
import api from "../api/client";
import type { Notification } from "../types";
import { useRealtime } from "../context/RealtimeContext";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { useDateTimeFormat } from "../hooks/useDateTimeFormat";
import ScrollArea from "./ScrollArea";
import { errorMessage } from "../utils/errors";

const typeIcon: Record<string, typeof Info> = {
  warning: AlertTriangle,
  success: PackageCheck,
  info: Info,
};

export default function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const { subscribe } = useRealtime();
  const { user } = useAuth();
  const { addToast } = useToast();
  const formatDateTime = useDateTimeFormat();
  const allLink = user?.role === "supplier" || user?.role === "customer" ? "/portal/notifications" : "/notifications";

  const load = useCallback(async (withItems: boolean) => {
    if (withItems) setLoading(true);
    try {
      const { data: count } = await api.get("/notifications/unread-count");
      setUnread(count);
      if (withItems) {
        const { data } = await api.get("/notifications", { params: { limit: 20 } });
        setItems(data.items);
      }
    } catch {
      // ignore
    } finally {
      if (withItems) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
    const onFocus = () => load(false);
    const onVisibility = () => {
      if (!document.hidden) load(false);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  useEffect(() => {
    return subscribe((msg) => {
      if (msg.event === "entity_changed" && msg.entity === "notification") {
        load(false);
      }
    });
  }, [subscribe, load]);

  useEffect(() => {
    if (open) {
      load(true);
    }
  }, [open, load]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const markAllRead = async () => {
    try {
      await api.put("/notifications/read-all");
      setUnread(0);
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to mark all as read"), "error");
    }
  };

  const openNotification = async (n: Notification) => {
    setOpen(false);
    if (!n.is_read) {
      try {
        await api.put(`/notifications/${n.id}/read`);
        setUnread((u) => Math.max(0, u - 1));
      } catch (err: unknown) {
        addToast(errorMessage(err, "Failed to update notification"), "error");
        return;
      }
    }
    if (n.link) navigate(n.link);
  };

  const dismiss = async (e: React.MouseEvent, n: Notification) => {
    e.stopPropagation();
    try {
      await api.delete(`/notifications/${n.id}`);
      setItems((prev) => prev.filter((x) => x.id !== n.id));
      if (!n.is_read) setUnread((u) => Math.max(0, u - 1));
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to dismiss notification"), "error");
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 text-muted hover:text-primary dark:text-primary rounded-full"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
      >
        <Bell size={20} />
        {unread > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <ScrollArea className="absolute right-0 top-11 w-80 max-w-[calc(100vw-2rem)] bg-surface border border-border rounded-lg shadow-lg z-50" viewportClassName="max-h-96 sa-viewport-contain">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-ink">Notifications</h3>
            {unread > 0 && (
              <button onClick={() => setConfirming(true)} className="flex items-center gap-1 text-xs text-primary dark:text-primary hover:underline">
                <CheckCheck size={14} /> Mark all read
              </button>
            )}
          </div>
          {confirming && (
            <div className="px-4 py-3 border-b border-border bg-amber-50 dark:bg-amber-500/10" role="alertdialog">
              <p className="text-sm text-ink mb-2">Mark all notifications as read?</p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setConfirming(false)}
                  className="btn-secondary text-xs py-1 px-2"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { setConfirming(false); markAllRead(); }}
                  className="btn-primary text-xs py-1 px-2"
                >
                  Mark all read
                </button>
              </div>
            </div>
          )}
          {loading ? (
            <div role="status" aria-label="Loading notifications" className="divide-y divide-border">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3 px-4 py-3">
                  <div className="w-4 h-4 bg-subtle-strong rounded-full animate-pulse mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-3.5 w-3/4 bg-subtle-strong rounded animate-pulse" />
                    <div className="h-3 w-1/2 bg-subtle-strong rounded animate-pulse" />
                    <div className="h-2.5 w-1/4 bg-subtle-strong rounded animate-pulse" />
                  </div>
                  <div className="w-4 h-4 bg-subtle-strong rounded animate-pulse shrink-0" />
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState compact icon={<Bell size={20} />} title="No notifications" message="Updates about your inventory will appear here." />
          ) : (
            <>
              <div className="divide-y divide-border">
                {items.map((n) => {
                  const Icon = typeIcon[n.type] || Info;
                  return (
                    <div
                      key={n.id}
                      className={`group flex w-full text-left px-4 py-3 hover:bg-app gap-3 cursor-pointer ${n.is_read ? "opacity-70" : ""}`}
                      onClick={() => openNotification(n)}
                    >
                      <Icon
                        size={16}
                        className={n.type === "warning" ? "text-amber-500 mt-0.5" : "text-emerald-500 mt-0.5"}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink truncate">{n.title}</p>
                        {n.message && <p className="text-xs text-muted truncate">{n.message}</p>}
                        <p className="text-[10px] text-faint mt-0.5">
                          {formatDateTime(n.created_at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={(e) => dismiss(e, n)}
                          className="p-1 rounded text-faint hover:text-red-600 hover:bg-subtle"
                          aria-label={`Dismiss ${n.title}`}
                          title="Dismiss"
                        >
                          <X size={14} />
                        </button>
                        {!n.is_read && <span className="w-2 h-2 bg-primary rounded-full" />}
                      </div>
                    </div>
                  );
                })}
              </div>
              <button
                onClick={() => { setOpen(false); navigate(allLink); }}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 border-t border-border text-xs font-medium text-primary dark:text-primary hover:bg-app"
              >
                View all <ArrowRight size={14} />
              </button>
            </>
          )}
        </ScrollArea>
      )}
    </div>
  );
}
