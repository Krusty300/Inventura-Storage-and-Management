import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import { RealtimeProvider } from "./context/RealtimeContext";
import { ThemeProvider } from "./context/ThemeContext";
import ErrorBoundary from "./components/ErrorBoundary";
import Layout from "./components/Layout";
import RequirePermission from "./components/RequirePermission";
import { lazy, Suspense } from "react";
import type { ReactNode } from "react";

const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Products = lazy(() => import("./pages/Products"));
const Categories = lazy(() => import("./pages/Categories"));
const Customers = lazy(() => import("./pages/Customers"));
const Suppliers = lazy(() => import("./pages/Suppliers"));
const StockMovements = lazy(() => import("./pages/StockMovements"));
const Orders = lazy(() => import("./pages/Orders"));
const Users = lazy(() => import("./pages/Users"));
const ActivityLog = lazy(() => import("./pages/ActivityLog"));
const Reports = lazy(() => import("./pages/Reports"));
const Settings = lazy(() => import("./pages/Settings"));
const Sales = lazy(() => import("./pages/Sales"));
const Locations = lazy(() => import("./pages/Locations"));
const Receipts = lazy(() => import("./pages/Receipts"));
const ASNs = lazy(() => import("./pages/ASNs"));
const LPNs = lazy(() => import("./pages/LPNs"));
const Lots = lazy(() => import("./pages/Lots"));
const SerialNumbers = lazy(() => import("./pages/SerialNumbers"));
const CycleCounts = lazy(() => import("./pages/CycleCounts"));
const Boms = lazy(() => import("./pages/Boms"));
const WorkOrders = lazy(() => import("./pages/WorkOrders"));
const QualityChecks = lazy(() => import("./pages/QualityChecks"));
const Planning = lazy(() => import("./pages/Planning"));
const Forecasting = lazy(() => import("./pages/Forecasting"));
const Shipments = lazy(() => import("./pages/Shipments"));
const Exceptions = lazy(() => import("./pages/Exceptions"));
const Profile = lazy(() => import("./pages/Profile"));

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-300" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-300" /></div>;
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-300" /></div>}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/register" element={user ? <Navigate to="/" replace /> : <Register />} />
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<RequirePermission perm="dashboard.view"><Dashboard /></RequirePermission>} />
          <Route path="/products" element={<RequirePermission perm="products.view"><Products /></RequirePermission>} />
          <Route path="/categories" element={<RequirePermission perm="categories.view"><Categories /></RequirePermission>} />
          <Route path="/customers" element={<RequirePermission perm="customers.view"><Customers /></RequirePermission>} />
          <Route path="/suppliers" element={<RequirePermission perm="suppliers.view"><Suppliers /></RequirePermission>} />
          <Route path="/stock-movements" element={<RequirePermission perm="stock.view"><StockMovements /></RequirePermission>} />
          <Route path="/locations" element={<RequirePermission perm="locations.view"><Locations /></RequirePermission>} />
          <Route path="/receiving" element={<RequirePermission perm="receipts.view"><Receipts /></RequirePermission>} />
          <Route path="/asns" element={<RequirePermission perm="asns.view"><ASNs /></RequirePermission>} />
          <Route path="/lpns" element={<RequirePermission perm="lpns.view"><LPNs /></RequirePermission>} />
          <Route path="/lots" element={<RequirePermission perm="lots.view"><Lots /></RequirePermission>} />
          <Route path="/serial-numbers" element={<RequirePermission perm="serial_numbers.view"><SerialNumbers /></RequirePermission>} />
          <Route path="/cycle-counts" element={<RequirePermission perm="cycle_counts.view"><CycleCounts /></RequirePermission>} />
          <Route path="/boms" element={<RequirePermission perm="bom.view"><Boms /></RequirePermission>} />
          <Route path="/work-orders" element={<RequirePermission perm="work_orders.view"><WorkOrders /></RequirePermission>} />
          <Route path="/planning" element={<RequirePermission perm="planning.view"><Planning /></RequirePermission>} />
          <Route path="/forecasting" element={<RequirePermission perm="forecasting.view"><Forecasting /></RequirePermission>} />
          <Route path="/shipments" element={<RequirePermission perm="shipments.view"><Shipments /></RequirePermission>} />
          <Route path="/quality-checks" element={<RequirePermission perm="quality_checks.view"><QualityChecks /></RequirePermission>} />
          <Route path="/exceptions" element={<RequirePermission perm="reports.view"><Exceptions /></RequirePermission>} />
          <Route path="/orders" element={<RequirePermission perm="orders.view"><Orders /></RequirePermission>} />
          <Route path="/sales" element={<RequirePermission perm="sales.view"><Sales /></RequirePermission>} />
          <Route path="/users" element={<RequirePermission perm="users.view"><Users /></RequirePermission>} />
          <Route path="/reports" element={<RequirePermission perm="reports.view"><Reports /></RequirePermission>} />
          <Route path="/activity-log" element={<RequirePermission perm="activity.view"><ActivityLog /></RequirePermission>} />
          <Route path="/settings" element={<RequirePermission perm="settings.view"><Settings /></RequirePermission>} />
          <Route path="/profile" element={<RequirePermission perm="profile.view"><Profile /></RequirePermission>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <ToastProvider>
              <RealtimeProvider>
                <ErrorBoundary>
                  <AppRoutes />
                </ErrorBoundary>
              </RealtimeProvider>
            </ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
