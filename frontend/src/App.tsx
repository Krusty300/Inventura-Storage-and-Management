import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import { RealtimeProvider } from "./context/RealtimeContext";
import { ThemeProvider } from "./context/ThemeContext";
import ErrorBoundary from "./components/ErrorBoundary";
import Layout from "./components/Layout";
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
          <Route path="/" element={<Dashboard />} />
          <Route path="/products" element={<Products />} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/suppliers" element={<Suppliers />} />
          <Route path="/stock-movements" element={<StockMovements />} />
          <Route path="/locations" element={<Locations />} />
          <Route path="/receiving" element={<Receipts />} />
          <Route path="/asns" element={<ASNs />} />
          <Route path="/lpns" element={<LPNs />} />
          <Route path="/lots" element={<Lots />} />
          <Route path="/serial-numbers" element={<SerialNumbers />} />
          <Route path="/cycle-counts" element={<CycleCounts />} />
          <Route path="/boms" element={<Boms />} />
          <Route path="/work-orders" element={<WorkOrders />} />
          <Route path="/planning" element={<Planning />} />
          <Route path="/shipments" element={<Shipments />} />
          <Route path="/quality-checks" element={<QualityChecks />} />
          <Route path="/exceptions" element={<Exceptions />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/sales" element={<Sales />} />
          <Route path="/users" element={<Users />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/activity-log" element={<ActivityLog />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/profile" element={<Profile />} />
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
