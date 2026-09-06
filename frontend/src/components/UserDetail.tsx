import { useDateFormat } from "../hooks/useDateFormat";
import { useDateTimeFormat } from "../hooks/useDateTimeFormat";
import { useQuery } from "@tanstack/react-query";
import { Shield, ShieldOff, ShieldCheck } from "lucide-react";
import api from "../api/client";
import Skeleton from "./Skeleton";
import Modal from "./Modal";
import type { PaginatedResponse, User } from "../types";
import { statusBadge } from "../utils/statusBadges";

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
    <Modal open onClose={onClose} title={user.username} wide>
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-muted">Username:</span>
            <p className="font-medium">{user.username}</p>
          </div>
          <div>
            <span className="text-muted">Email:</span>
            <p className="font-medium">{user.email}</p>
          </div>
          <div>
            <span className="text-muted">Role:</span>
            <p className="font-medium flex items-center gap-1 mt-1">
              {user.role === "admin" ? <Shield size={14} className="text-primary" /> : user.role === "manager" ? <ShieldCheck size={14} className="text-blue-500" /> : <ShieldOff size={14} className="text-faint" />}
              {user.role}
            </p>
          </div>
          <div>
            <span className="text-muted">Created:</span>
            <p className="font-medium">{formatDate(user.created_at)}</p>
          </div>
          <div>
            <span className="text-muted">Last Login:</span>
            <p className="font-medium">{user.last_login_at ? formatDateTime(user.last_login_at) : "Never"}</p>
          </div>
          <div>
            <span className="text-muted">Status:</span>
            <p className="font-medium mt-1 flex items-center gap-2">
              {user.is_active ? <span className="badge badge-success">Active</span> : <span className="badge badge-danger">Inactive</span>}
              {user.is_approved === false && <span className="badge badge-warning">Pending Approval</span>}
            </p>
          </div>
        </div>

        <div className="pt-4 border-t border-border">
          <h3 className="text-base font-semibold text-ink mb-3">Recent Activity</h3>
          {isLoading ? (
            <Skeleton variant="rows" rows={3} cols={3} />
          ) : logs.length === 0 ? (
            <p className="text-muted py-2">No activity recorded for this user.</p>
          ) : (
            <ul className="divide-y divide-border max-h-72 overflow-y-auto">
              {logs.map((log) => (
                <li key={log.id} className="py-2 flex items-start gap-2">
                  <span className={`badge shrink-0 ${statusBadge(log.action)}`}>{log.action}</span>
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
    </Modal>
  );
}
