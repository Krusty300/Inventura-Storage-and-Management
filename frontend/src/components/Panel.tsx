import type { ReactNode } from "react";

// Shared layout primitives for slide-over panels. These encode the card,
// section and footer structure used by the product form and detail views so
// every other module renders the same way without repeating class strings.

export const panelSectionLabel = "text-xs font-semibold uppercase tracking-widest text-faint";

export const panelLabel = "block text-sm font-medium text-ink mb-1";

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function PanelCard({ children, className = "" }: CardProps) {
  return (
    <div className={`border border-border rounded-lg overflow-hidden bg-white dark:bg-app ${className}`.trim()}>
      {children}
    </div>
  );
}

interface HeaderProps {
  title: ReactNode;
  eyebrow?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function PanelHeader({ title, eyebrow, subtitle, actions }: HeaderProps) {
  return (
    <div className="border-b border-border px-6 py-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className={panelSectionLabel}>{eyebrow}</p>}
        <p className="text-xl font-bold text-ink mt-0.5 tracking-tight truncate">{title}</p>
        {subtitle && <p className="text-sm text-muted mt-0.5 truncate">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

interface SectionProps {
  label?: string;
  children: ReactNode;
  className?: string;
  last?: boolean;
}

export function PanelSection({ label, children, className = "", last }: SectionProps) {
  return (
    <div className={`px-6 py-5 ${last ? "" : "border-b border-dashed border-border"} ${className}`.trim()}>
      {label && <p className={`${panelSectionLabel} mb-3`}>{label}</p>}
      {children}
    </div>
  );
}

export function PanelFooter({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">{children}</div>;
}

interface FieldProps {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}

export function PanelField({ label, htmlFor, children, className = "" }: FieldProps) {
  return (
    <div className={className}>
      <label className={panelLabel} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

interface DetailItemProps {
  label: string;
  children: ReactNode;
}

export function PanelDetailItem({ label, children }: DetailItemProps) {
  return (
    <div>
      <p className={panelSectionLabel}>{label}</p>
      <div className="font-medium mt-1">{children}</div>
    </div>
  );
}

const GRID_COLUMNS = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
};

export function PanelDetailGrid({ children, columns = 3 }: { children: ReactNode; columns?: 2 | 3 | 4 }) {
  return (
    <div className={`grid ${GRID_COLUMNS[columns]} gap-x-6 gap-y-3 px-6 py-5 border-b border-dashed border-border text-sm`}>
      {children}
    </div>
  );
}