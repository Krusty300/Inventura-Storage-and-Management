import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck, AlertTriangle, Info, PackageCheck } from "lucide-react";
import api from "../api/client";
import type { Notification } from "../types";
import { useRealtime } from "../context/RealtimeContext";

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
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const { subscribe } = useRealtime();

  const load = useCallback(async (withItems: boolean) => {
    try {
      const { data: count } = await api.get("/notifications/unread-count");
      setUnread(count);
      if (withItems) {
        const { data } = await api.get("/notifications", { params: { limit: 20 } });
        setItems(data);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    load(false);
    const t = setInterval(() => load(false), 30000);
    return () => clearInterval(t);
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
    await api.put("/notifications/read-all");
    setUnread(0);
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
  };
  const openNotification = async (n: Notification) => {
    setOpen(false);
    if (!n.is_read) {
      await api.put(`/notifications/${n.id}/read`);
      setUnread((u) => Math.max(0, u - 1));
    }
    if (n.link) navigate(n.link);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 text-gray-600 hover:text-indigo-600 rounded-full"
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
        <div className="absolute right-0 top-11 w-80 max-h-96 overflow-auto bg-white border border-gray-200 rounded-lg shadow-lg z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-800">Notifications</h3>
            {unread > 0 && (
              <button onClick={() => setConfirming(true)} className="flex items-center gap-1 text-xs text-indigo-600 hover:underline">
                <CheckCheck size={14} /> Mark all read
              </button>
            )}
          </div>
          {confirming && (
            <div className="px-4 py-3 border-b border-gray-100 bg-amber-50" role="alertdialog">
              <p className="text-sm text-gray-700 mb-2">Mark all notifications as read?</p>
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
          {items.length === 0 ? (
            <p className="px-4 py-8 text-sm text-gray-500 text-center">No notifications</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {items.map((n) => {
                const Icon = typeIcon[n.type] || Info;
                return (
                  <button
                    key={n.id}
                    onClick={() => openNotification(n)}
                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 flex gap-3 ${n.is_read ? "opacity-70" : ""}`}
                  >
                    <Icon
                      size={16}
                      className={n.type === "warning" ? "text-amber-500 mt-0.5" : "text-emerald-500 mt-0.5"}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{n.title}</p>
                      {n.message && <p className="text-xs text-gray-500 truncate">{n.message}</p>}
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {new Date(n.created_at).toLocaleString()}
                      </p>
                    </div>
                    {!n.is_read && <span className="w-2 h-2 bg-indigo-500 rounded-full ml-auto mt-1.5" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
