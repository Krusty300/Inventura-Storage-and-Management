import { useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import EmptyState from "./EmptyState";

export default function RequirePermission({ perm, children }: { perm: string; children: ReactNode }) {
  const { can, loading } = useAuth();
  const navigate = useNavigate();
  if (loading) return <div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-300" /></div>;
  if (!can(perm)) {
    return (
      <EmptyState
        variant="block"
        title="Access denied"
        message="You don't have permission to view this page."
        actionLabel="Go to Dashboard"
        onAction={() => navigate("/")}
      />
    );
  }
  return <>{children}</>;
}
