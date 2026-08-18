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

function PageBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

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
const Notes = lazy(() => import("./pages/Notes"));
const Exceptions = lazy(() => import("./pages/Exceptions"));
const Profile = lazy(() => import("./pages/Profile"));

const queryClient = new QueryClient();

const spinner = (
  <div className="flex items-center justify-center h-screen">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-300" />
  </div>
);

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return spinner;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  if (loading) return spinner;
  return (
    <Suspense fallback={spinner}>
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
          <Route path="/" element={<PageBoundary><RequirePermission perm="dashboard.view"><Dashboard /></RequirePermission></PageBoundary>} />
          <Route path="/products" element={<PageBoundary><RequirePermission perm="products.view"><Products /></RequirePermission></PageBoundary>} />
          <Route path="/categories" element={<PageBoundary><RequirePermission perm="categories.view"><Categories /></RequirePermission></PageBoundary>} />
          <Route path="/customers" element={<PageBoundary><RequirePermission perm="customers.view"><Customers /></RequirePermission></PageBoundary>} />
          <Route path="/suppliers" element={<PageBoundary><RequirePermission perm="suppliers.view"><Suppliers /></RequirePermission></PageBoundary>} />
          <Route path="/stock-movements" element={<PageBoundary><RequirePermission perm="stock.view"><StockMovements /></RequirePermission></PageBoundary>} />
          <Route path="/locations" element={<PageBoundary><RequirePermission perm="locations.view"><Locations /></RequirePermission></PageBoundary>} />
          <Route path="/receiving" element={<PageBoundary><RequirePermission perm="receipts.view"><Receipts /></RequirePermission></PageBoundary>} />
          <Route path="/asns" element={<PageBoundary><RequirePermission perm="asns.view"><ASNs /></RequirePermission></PageBoundary>} />
          <Route path="/lpns" element={<PageBoundary><RequirePermission perm="lpns.view"><LPNs /></RequirePermission></PageBoundary>} />
          <Route path="/lots" element={<PageBoundary><RequirePermission perm="lots.view"><Lots /></RequirePermission></PageBoundary>} />
          <Route path="/serial-numbers" element={<PageBoundary><RequirePermission perm="serial_numbers.view"><SerialNumbers /></RequirePermission></PageBoundary>} />
          <Route path="/cycle-counts" element={<PageBoundary><RequirePermission perm="cycle_counts.view"><CycleCounts /></RequirePermission></PageBoundary>} />
          <Route path="/boms" element={<PageBoundary><RequirePermission perm="bom.view"><Boms /></RequirePermission></PageBoundary>} />
          <Route path="/work-orders" element={<PageBoundary><RequirePermission perm="work_orders.view"><WorkOrders /></RequirePermission></PageBoundary>} />
          <Route path="/planning" element={<PageBoundary><RequirePermission perm="planning.view"><Planning /></RequirePermission></PageBoundary>} />
          <Route path="/forecasting" element={<PageBoundary><RequirePermission perm="forecasting.view"><Forecasting /></RequirePermission></PageBoundary>} />
          <Route path="/shipments" element={<PageBoundary><RequirePermission perm="shipments.view"><Shipments /></RequirePermission></PageBoundary>} />
          <Route path="/notes" element={<PageBoundary><RequirePermission perm="notes.view"><Notes /></RequirePermission></PageBoundary>} />
          <Route path="/quality-checks" element={<PageBoundary><RequirePermission perm="quality_checks.view"><QualityChecks /></RequirePermission></PageBoundary>} />
          <Route path="/exceptions" element={<PageBoundary><RequirePermission perm="reports.view"><Exceptions /></RequirePermission></PageBoundary>} />
          <Route path="/orders" element={<PageBoundary><RequirePermission perm="orders.view"><Orders /></RequirePermission></PageBoundary>} />
          <Route path="/sales" element={<PageBoundary><RequirePermission perm="sales.view"><Sales /></RequirePermission></PageBoundary>} />
          <Route path="/users" element={<PageBoundary><RequirePermission perm="users.view"><Users /></RequirePermission></PageBoundary>} />
          <Route path="/reports" element={<PageBoundary><RequirePermission perm="reports.view"><Reports /></RequirePermission></PageBoundary>} />
          <Route path="/activity-log" element={<PageBoundary><RequirePermission perm="activity.view"><ActivityLog /></RequirePermission></PageBoundary>} />
          <Route path="/settings" element={<PageBoundary><RequirePermission perm="settings.view"><Settings /></RequirePermission></PageBoundary>} />
          <Route path="/profile" element={<PageBoundary><RequirePermission perm="profile.view"><Profile /></RequirePermission></PageBoundary>} />
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
