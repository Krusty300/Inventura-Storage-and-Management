import { useDateFormat } from "../hooks/useDateFormat";
import { useDateTimeFormat } from "../hooks/useDateTimeFormat";
import { useQuery } from "@tanstack/react-query";
import { Shield, ShieldOff, ShieldCheck, Truck } from "lucide-react";
import api from "../api/client";
import Skeleton from "./Skeleton";
import EmptyState from "./EmptyState";
import SlideOver from "./SlideOver";
import type { PaginatedResponse, User } from "../types";
import { statusBadge } from "../utils/statusBadges";
import { entityImageUrl } from "../utils/images";
import { onImageError } from "../utils/placeholders";

interface ActivityLogEntry {
  id: number;
  user_id: number;
  username: string;
  action: string;
  entity_type: string;
  entity_id: number | null;
  description: string;
  details: string;
  created_at: string;
}

interface Props {
  user: User;
  onClose: () => void;
}

export default function UserDetail({ user, onClose }: Props) {
  const formatDate = useDateFormat();
  const formatDateTime = useDateTimeFormat();
  const { data, isLoading } = useQuery({
    queryKey: ["activity-logs", "user", user.id],
    queryFn: async () => {
      const { data } = await api.get("/activity-logs", {
        params: { entity_type: "user", entity_id: user.id, limit: 20 },
      });
      return data as PaginatedResponse<ActivityLogEntry>;
    },
  });

  const logs = data?.items || [];

  return (
    <SlideOver open onClose={onClose} title={user.username} wide ariaLabel={`User details: ${user.username}`}>
      <div className="space-y-6 text-sm">
        <div className="flex items-start gap-4">
          {user.avatar_url ? (
            <img src={user.avatar_url} alt={user.username} className="h-14 w-14 rounded-full object-cover border border-border shrink-0" />
          ) : (
            <span className="flex items-center justify-center h-14 w-14 rounded-full bg-primary-soft dark:bg-primary/20 text-primary-strong dark:text-primary text-xl font-bold shrink-0">
              {user.username?.charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-ink truncate">{user.username}</h3>
            <p className="text-sm text-muted truncate">{user.email}</p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className={`badge ${user.role === "admin" ? "badge-info" : user.role === "manager" ? "badge-success" : user.role === "supplier" ? "badge-info" : "badge-warning"}`}>
                {user.role === "admin" && <Shield size={12} className="mr-0.5" />}
                {user.role === "manager" && <ShieldCheck size={12} className="mr-0.5" />}
                {user.role === "worker" && <ShieldOff size={12} className="mr-0.5" />}
                {user.role === "supplier" && <Truck size={12} className="mr-0.5" />}
                {user.role}
              </span>
              {user.role === "supplier" && user.supplier_id && (
                <span className="inline-flex items-center gap-1.5">
                  {user.supplier_image_url && (
                    <img src={entityImageUrl(user.supplier_image_url)} alt={user.supplier_name || "Supplier"} onError={onImageError} className="h-4 w-4 rounded-full object-cover border border-border shrink-0" />
                  )}
                  <span className="badge badge-neutral" title={`Supplier #${user.supplier_id}`}>
                    {user.supplier_name || `Supplier #${user.supplier_id}`}
                  </span>
                </span>
              )}
              {user.is_active ? (
                <span className="badge badge-success">Active</span>
              ) : (
                <span className="badge badge-danger">Inactive</span>
              )}
              {user.is_approved === false && (
                <span className="badge badge-warning">Pending approval</span>
              )}
              {user.permissions && user.permissions.length > 0 && (
                <span className="badge badge-success">Custom permissions</span>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
          <div>
            <p className="text-xs font-medium text-faint uppercase tracking-wide mb-0.5">User ID</p>
            <p className="font-medium text-ink">#{user.id}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-faint uppercase tracking-wide mb-0.5">Role</p>
            <p className="font-medium text-ink capitalize">{user.role}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-faint uppercase tracking-wide mb-0.5">Created</p>
            <p className="font-medium text-ink">{formatDate(user.created_at)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-faint uppercase tracking-wide mb-0.5">Last Login</p>
            <p className="font-medium text-ink">{user.last_login_at ? formatDateTime(user.last_login_at) : "Never"}</p>
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <h3 className="text-base font-semibold text-ink mb-3">Recent Activity</h3>
          {isLoading ? (
            <Skeleton variant="rows" rows={3} cols={3} />
          ) : logs.length === 0 ? (
            <EmptyState compact icon={<ShieldCheck size={20} />} title="No activity recorded for this user" message="Sign-in and permission changes will appear here." />
          ) : (
            <ul className="divide-y divide-border max-h-80 overflow-y-auto">
              {logs.map((log) => (
                <li key={log.id} className="py-2.5 flex items-start gap-2">
                  <span className={`badge shrink-0 mt-0.5 ${statusBadge(log.action)}`}>{log.action}</span>
                  <div className="min-w-0">
                    <p className="text-ink">{log.description}</p>
                    <p className="text-xs text-muted">
                      by {log.username || `User #${log.user_id}`} · {formatDateTime(log.created_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </SlideOver>
  );
}
