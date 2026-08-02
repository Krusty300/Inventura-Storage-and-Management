import { useQuery } from "@tanstack/react-query";
import { Shield, ShieldOff } from "lucide-react";
import api from "../api/client";
import Modal from "./Modal";
import type { PaginatedResponse } from "../types";

interface User {
  id: number;
  username: string;
  email: string;
  role: string;
  last_login_at: string | null;
  created_at: string;
}

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

const actionColors: Record<string, string> = {
  create: "badge-success",
  update: "badge-info",
  delete: "badge-danger",
  reset_password: "badge-warning",
};

export default function UserDetail({ user, onClose }: Props) {
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
            <span className="text-gray-500">Username:</span>
            <p className="font-medium">{user.username}</p>
          </div>
          <div>
            <span className="text-gray-500">Email:</span>
            <p className="font-medium">{user.email}</p>
          </div>
          <div>
            <span className="text-gray-500">Role:</span>
            <p className="font-medium flex items-center gap-1 mt-1">
              {user.role === "admin" ? <Shield size={14} className="text-indigo-500" /> : <ShieldOff size={14} className="text-gray-400" />}
              {user.role}
            </p>
          </div>
          <div>
            <span className="text-gray-500">Created:</span>
            <p className="font-medium">{new Date(user.created_at).toLocaleDateString()}</p>
          </div>
          <div>
            <span className="text-gray-500">Last Login:</span>
            <p className="font-medium">{user.last_login_at ? new Date(user.last_login_at).toLocaleString() : "Never"}</p>
          </div>
        </div>

        <div className="pt-4 border-t border-gray-100">
          <h3 className="text-base font-semibold text-gray-900 mb-3">Recent Activity</h3>
          {isLoading ? (
            <p className="text-gray-500 py-2">Loading activity...</p>
          ) : logs.length === 0 ? (
            <p className="text-gray-500 py-2">No activity recorded for this user.</p>
          ) : (
            <ul className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
              {logs.map((log) => (
                <li key={log.id} className="py-2 flex items-start gap-2">
                  <span className={`badge shrink-0 ${actionColors[log.action] || "badge-info"}`}>{log.action}</span>
                  <div className="min-w-0">
                    <p className="text-gray-800">{log.description}</p>
                    <p className="text-xs text-gray-500">
                      by {log.username || `User #${log.user_id}`} · {new Date(log.created_at).toLocaleString()}
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
