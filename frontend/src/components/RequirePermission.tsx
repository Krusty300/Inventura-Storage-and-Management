import { useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import EmptyState from "./EmptyState";
import PageLoader from "./PageLoader";

export default function RequirePermission({ perm, children }: { perm: string; children: ReactNode }) {
  const { can, loading } = useAuth();
  const navigate = useNavigate();
  if (loading) return <PageLoader />;
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
