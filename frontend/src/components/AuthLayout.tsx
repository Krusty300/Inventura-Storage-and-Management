import type { ReactNode } from "react";
import { BarChart3, Boxes, PackageCheck } from "lucide-react";
import { useSettings } from "../hooks/useSettings";

interface Props {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export default function AuthLayout({ title, subtitle, children, footer }: Props) {
  const { data: settings } = useSettings();
  const storeName = settings?.store_name || "Inventura Storage";

  return (
    <div className="min-h-screen flex bg-app">
      <div className="hidden lg:flex lg:w-[40%] relative flex-col justify-between overflow-hidden bg-gradient-to-br from-[#7c3aed] via-[#6d28d9] to-[#4c1d95] p-12 text-white">
        <div className="absolute -top-24 -right-24 h-96 w-96 rounded-full bg-surface/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-black/20 blur-3xl" />
        <div className="absolute top-1/2 left-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#863bff]/30 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <img src="/favicon.svg" alt={`${storeName} logo`} className="h-10 w-10" loading="eager" />
          <span className="text-xl font-bold">{storeName}</span>
        </div>
        <div className="relative space-y-8">
          <h2 className="text-3xl font-bold leading-tight">
            Warehouse & inventory management, simplified.
          </h2>
          <ul className="space-y-4 text-white/85">
            <li className="flex items-center gap-3">
              <PackageCheck className="h-5 w-5 shrink-0" />
              Track products, variants, and locations
            </li>
            <li className="flex items-center gap-3">
              <BarChart3 className="h-5 w-5 shrink-0" />
              Low-stock alerts and live dashboards
            </li>
            <li className="flex items-center gap-3">
              <Boxes className="h-5 w-5 shrink-0" />
              Receipts, shipments, and work orders
            </li>
          </ul>
        </div>
        <p className="relative text-sm text-white/60">
          &copy; {new Date().getFullYear()} {storeName}
        </p>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-md mx-auto">
          <div className="lg:hidden flex justify-center mb-8">
            <div className="flex items-center gap-3">
              <img src="/favicon.svg" alt={`${storeName} logo`} className="h-8 w-8" loading="eager" />
              <span className="text-2xl font-bold text-ink">{storeName}</span>
            </div>
          </div>
          <div className="bg-surface rounded-2xl shadow-lg border border-border p-8 sm:p-10">
            <h2 className="text-2xl font-bold text-ink text-center">{title}</h2>
            {subtitle && <p className="text-sm text-muted mt-1 text-center">{subtitle}</p>}
            <div className="mt-6">{children}</div>
            {footer}
          </div>
        </div>
      </div>
    </div>
  );
}
