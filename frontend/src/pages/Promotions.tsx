import { useState } from "react";
import { Pencil, Trash2, Search, BadgePercent, CalendarRange, Percent, Coins, Layers, Clock } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { PaginatedResponse, Promotion } from "../types";
import SlideOver from "../components/SlideOver";
import ConfirmDialog from "../components/ConfirmDialog";
import Pagination from "../components/Pagination";

import TextArea from "../components/TextArea";
import EmptyState from "../components/EmptyState";
import Table from "../components/Table";
import DatePicker from "../components/DatePicker";
import { useDebounce } from "../hooks/useDebounce";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { useSettings } from "../hooks/useSettings";
import { usePageSize } from "../hooks/usePageSize";
import { useDateFormat } from "../hooks/useDateFormat";
import { errorMessage } from "../utils/errors";
import { formatCurrency } from "../utils/currency";

export default function Promotions() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const { pageSize } = usePageSize();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Promotion | null>(null);
  const [deleting, setDeleting] = useState<Promotion | null>(null);
  const [viewing, setViewing] = useState<Promotion | null>(null);
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { can } = useAuth();
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["promotions", debouncedSearch, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() };
      if (debouncedSearch) params.search = debouncedSearch;
      const { data } = await api.get("/promotions", { params });
      return data as PaginatedResponse<Promotion>;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/promotions/${id}`),
    onSuccess: () => { addToast("Promotion deleted", "success"); queryClient.invalidateQueries({ queryKey: ["promotions"] }); },
    onError: (err: unknown) => { addToast(errorMessage(err, "Cannot delete"), "error"); },
  });

  const promotions = data?.items || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-y-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <BadgePercent size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-ink">Promotions</h1>
            <p className="text-sm text-muted mt-1">Create discount codes and promotional offers.</p>
          </div>
        </div>
        {can("promotions.create") && (
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary">Add Promotion</button>
        )}
      </div>

      {isError && <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">{errorMessage(error, "Failed to load promotions")}</div>}

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
        <input className="input pl-10" placeholder="Search promotions..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search promotions" />
      </div>

      <div className="card overflow-hidden p-0">
        <Table
          ariaLabel="Promotions table"
          role="grid"
          columns={[
            { key: "code", header: "Code" },
            { key: "discount", header: "Discount" },
            { key: "minQty", header: "Min Qty" },
            { key: "minAmount", header: "Min Amount" },
            { key: "validFrom", header: "Valid From" },
            { key: "validTo", header: "Valid To" },
            { key: "uses", header: "Uses" },
            { key: "status", header: "Status" },
            { key: "actions", header: "Actions" },
          ]}
          loading={isLoading}
          skeletonRows={5}
          noData={promotions.length === 0}
          empty={
                <EmptyState title={search ? "No matching promotions" : "No promotions"} message={search ? `Nothing matched "${search}". Try adjusting your search.` : "Create your first promotion to offer discounts."} actionLabel={search ? undefined : "Add Promotion"} onAction={search ? undefined : () => { setEditing(null); setShowForm(true); }} />
          }
        >
          {promotions.map((p) => (
                <tr key={p.id} className="hover:bg-app cursor-pointer" onClick={() => setViewing(p)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <BadgePercent size={16} className="text-primary" />
                      <span className="font-medium font-mono">{p.code}</span>
                    </div>
                    {p.description && <p className="text-xs text-muted mt-0.5 max-w-[200px] truncate">{p.description}</p>}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {p.discount_type === "percentage" ? `${p.value}%` : formatCurrency(p.value, currencySymbol)}
                  </td>
                  <td className="px-4 py-3 text-muted">{p.min_qty || "\u2014"}</td>
                  <td className="px-4 py-3 text-muted">{p.min_amount > 0 ? formatCurrency(p.min_amount, currencySymbol) : "\u2014"}</td>
                  <td className="px-4 py-3 text-muted">{p.valid_from || "\u2014"}</td>
                  <td className="px-4 py-3 text-muted">{p.valid_to || "\u2014"}</td>
                  <td className="px-4 py-3 text-muted">{p.max_uses > 0 ? `${p.used_count}/${p.max_uses}` : `${p.used_count}`}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${p.is_active ? "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400" : "bg-gray-100 text-gray-500 dark:bg-gray-500/10 dark:text-gray-400"}`}>
                      {p.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-2">
                      {can("promotions.update") && <button onClick={() => { setEditing(p); setShowForm(true); }} className="p-1 text-faint hover:text-primary dark:text-primary" aria-label={`Edit ${p.code}`}><Pencil size={16} /></button>}
                      {can("promotions.delete") && <button onClick={() => setDeleting(p)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Delete ${p.code}`}><Trash2 size={16} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
          </Table>
      </div>

      {data && data.pages > 1 && <Pagination page={page} totalPages={data.pages} onPageChange={setPage} />}

      {showForm && <PromotionForm promotion={editing} currencySymbol={currencySymbol} onClose={() => { setShowForm(false); setEditing(null); }} onSaved={() => { setShowForm(false); setEditing(null); queryClient.invalidateQueries({ queryKey: ["promotions"] }); }} />}
      {deleting && <ConfirmDialog open title="Delete Promotion" message={`Delete "${deleting.code}"? This cannot be undone.`} onConfirm={() => { deleteMutation.mutate(deleting.id); setDeleting(null); }} onCancel={() => setDeleting(null)} />}
      {viewing && <PromotionDetail promotion={viewing} currencySymbol={currencySymbol} onClose={() => setViewing(null)} onEdit={can("promotions.update") ? () => { setEditing(viewing); setShowForm(true); setViewing(null); } : undefined} />}
    </div>
  );
}

function FormCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="border border-border rounded-xl overflow-hidden">
      <header className="px-5 py-3 bg-app border-b border-border flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
      </header>
      <div className="p-5 space-y-4">{children}</div>
    </section>
  );
}

function PromotionForm({ promotion, currencySymbol, onClose, onSaved }: { promotion: Promotion | null; currencySymbol: string; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(promotion?.code || "");
  const [description, setDescription] = useState(promotion?.description || "");
  const [discountType, setDiscountType] = useState(promotion?.discount_type || "percentage");
  const [value, setValue] = useState(promotion?.value?.toString() || "");
  const [minQty, setMinQty] = useState(promotion?.min_qty?.toString() || "0");
  const [minAmount, setMinAmount] = useState(promotion?.min_amount?.toString() || "0");
  const [validFrom, setValidFrom] = useState(promotion?.valid_from || "");
  const [validTo, setValidTo] = useState(promotion?.valid_to || "");
  const [maxUses, setMaxUses] = useState(promotion?.max_uses?.toString() || "0");
  const [isActive, setIsActive] = useState(promotion?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (validFrom && validTo && validTo < validFrom) {
      addToast("Valid To must be after Valid From", "error");
      return;
    }
    setSaving(true);
    try {
      const body = {
        code: code.trim().toUpperCase(),
        description,
        discount_type: discountType,
        value: parseFloat(value) || 0,
        min_qty: parseInt(minQty) || 0,
        min_amount: parseFloat(minAmount) || 0,
        valid_from: validFrom || null,
        valid_to: validTo || null,
        max_uses: parseInt(maxUses) || 0,
        is_active: isActive,
      };
      if (promotion) {
        await api.put(`/promotions/${promotion.id}`, body);
        addToast("Promotion updated", "success");
      } else {
        await api.post("/promotions", body);
        addToast("Promotion created", "success");
      }
      onSaved();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Error saving promotion"), "error");
    }
    setSaving(false);
  };

  return (
    <SlideOver
      open
      onClose={onClose}
      wide
      ariaLabel={promotion ? "Edit Promotion" : "Add Promotion"}
      title={promotion ? "Edit Promotion" : "Add Promotion"}
      actions={
        <button type="submit" form="promotion-form" disabled={saving || !code.trim()} className="btn-primary">
          {saving ? "Saving..." : promotion ? "Update" : "Create"}
        </button>
      }
    >
      <form id="promotion-form" onSubmit={handleSubmit} className="space-y-5">
        <FormCard icon={<BadgePercent size={16} className="text-primary shrink-0" />} title="Code & Description">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Code *</label>
            <input className="input font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. SAVE20" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Description</label>
            <TextArea rows={2} value={description} onChange={setDescription} placeholder="What this promotion offers" />
          </div>
        </FormCard>

        <FormCard icon={<Percent size={16} className="text-primary shrink-0" />} title="Discount">
          <div>
            <label className="block text-sm font-medium text-ink mb-2">Discount Type *</label>
            <div className="grid grid-cols-2 gap-3">
              <label className={`flex items-center gap-2 text-sm border rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${discountType === "percentage" ? "border-primary bg-primary-soft dark:bg-primary/10" : "border-border hover:bg-app"}`}>
                <input type="radio" name="discount_type" value="percentage" checked={discountType === "percentage"} onChange={() => setDiscountType("percentage")} className="border-border-strong" />
                Percentage (%)
              </label>
              <label className={`flex items-center gap-2 text-sm border rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${discountType === "fixed" ? "border-primary bg-primary-soft dark:bg-primary/10" : "border-border hover:bg-app"}`}>
                <input type="radio" name="discount_type" value="fixed" checked={discountType === "fixed"} onChange={() => setDiscountType("fixed")} className="border-border-strong" />
                Fixed ({currencySymbol})
              </label>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">{discountType === "percentage" ? "Discount Value (%) *" : `Discount Amount (${currencySymbol}) *`}</label>
            <input type="number" step="0.01" min="0" max={discountType === "percentage" ? "100" : undefined} className="input" value={value} onChange={(e) => setValue(e.target.value)} required />
          </div>
        </FormCard>

        <FormCard icon={<Layers size={16} className="text-primary shrink-0" />} title="Minimums">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Min Qty <span className="text-faint font-normal">(0 = no minimum)</span></label>
            <input type="number" min="0" className="input" value={minQty} onChange={(e) => setMinQty(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Min Amount <span className="text-faint font-normal">(0 = no minimum)</span></label>
            <input type="number" step="0.01" min="0" className="input" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
          </div>
        </FormCard>

        <FormCard icon={<CalendarRange size={16} className="text-primary shrink-0" />} title="Validity & Usage">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Valid From</label>
              <DatePicker value={validFrom} onChange={setValidFrom} ariaLabel="Valid From" />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Valid To</label>
              <DatePicker value={validTo} onChange={setValidTo} ariaLabel="Valid To" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Max Uses <span className="text-faint font-normal">(0 = unlimited)</span></label>
            <input type="number" min="0" className="input" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
          </div>
        </FormCard>

        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input type="checkbox" className="rounded border-border-strong" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active
        </label>
      </form>
    </SlideOver>
  );
}

function DetailStat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-app p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-faint">{label}</p>
      <p className="text-sm font-semibold text-ink mt-0.5 truncate" title={typeof children === "string" ? children : undefined}>{children}</p>
    </div>
  );
}

function PromotionDetail({ promotion, currencySymbol, onClose, onEdit }: { promotion: Promotion; currencySymbol: string; onClose: () => void; onEdit?: () => void }) {
  const formatDate = useDateFormat();
  const discountLabel = promotion.discount_type === "percentage" ? `${promotion.value}%` : formatCurrency(promotion.value, currencySymbol);
  const validity = [promotion.valid_from, promotion.valid_to].filter(Boolean).join(" → ") || "—";
  const unlimited = promotion.max_uses <= 0;
  const usedPct = unlimited ? 0 : Math.min(Math.round((promotion.used_count / promotion.max_uses) * 100), 100);
  const exhausted = !unlimited && promotion.used_count >= promotion.max_uses;

  return (
    <SlideOver open onClose={onClose} title={promotion.code} wide ariaLabel={promotion.code}>
      <div className="space-y-5">
        <div className="border border-border rounded-xl overflow-hidden bg-white dark:bg-app">
          <div className="border-b border-border px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:bg-primary/15 dark:text-primary flex items-center justify-center shrink-0">
                  <BadgePercent size={22} />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-widest text-faint">Promotion</p>
                  <h3 className="text-xl font-bold text-ink mt-0.5 truncate">{promotion.code}</h3>
                  {promotion.description && <p className="text-sm text-muted mt-1">{promotion.description}</p>}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <span className={`badge ${promotion.is_active ? "badge-success" : "badge-neutral"}`}>
                  {promotion.is_active ? "Active" : "Inactive"}
                </span>
                {exhausted && <span className="badge badge-danger">Exhausted</span>}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-6 py-5">
            <DetailStat label="Discount">
              <span className="inline-flex items-center gap-1">
                {promotion.discount_type === "percentage" ? <Percent size={14} className="text-faint shrink-0" /> : <Coins size={14} className="text-faint shrink-0" />}
                {discountLabel}
              </span>
            </DetailStat>
            <DetailStat label="Type">{promotion.discount_type === "percentage" ? "Percentage" : "Fixed Amount"}</DetailStat>
            <DetailStat label="Minim. qty / amt">
              {promotion.min_qty > 0 && promotion.min_amount > 0
                ? `${promotion.min_qty} · ${formatCurrency(promotion.min_amount, currencySymbol)}`
                : promotion.min_qty > 0
                  ? `${promotion.min_qty} units`
                  : promotion.min_amount > 0
                    ? formatCurrency(promotion.min_amount, currencySymbol)
                    : "None"}
            </DetailStat>
            <DetailStat label="Updated">{promotion.updated_at ? formatDate(promotion.updated_at) : "—"}</DetailStat>
          </div>
        </div>

        <div className="border border-border rounded-xl overflow-hidden bg-white dark:bg-app">
          <div className="grid grid-cols-2 divide-x divide-border">
            <div className="px-6 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-faint mb-1">Usage</p>
              <p className="text-sm font-semibold text-ink inline-flex items-center gap-1.5">
                <Clock size={14} className="text-faint shrink-0" />
                {unlimited ? `${promotion.used_count} used` : `${promotion.used_count} / ${promotion.max_uses}`}
              </p>
            </div>
            <div className="px-6 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-faint mb-1">Validity</p>
              <p className="text-sm font-semibold text-ink inline-flex items-center gap-1.5 truncate">
                <CalendarRange size={14} className="text-faint shrink-0" />
                <span className="truncate">{validity}</span>
              </p>
            </div>
          </div>
          {!unlimited && (
            <div className="border-t border-border px-6 py-4">
              <div className="flex items-center justify-between text-xs text-muted mb-2">
                <span className="font-medium">Redemption</span>
                <span className="tabular-nums">{usedPct}% used</span>
              </div>
              <div className="h-2 rounded-full bg-subtle overflow-hidden" role="progressbar" aria-valuenow={promotion.used_count} aria-valuemin={0} aria-valuemax={promotion.max_uses} aria-label={`${promotion.code} redemption`}>
                <div className={`h-full rounded-full ${exhausted ? "bg-red-500" : usedPct >= 80 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${usedPct}%` }} />
              </div>
            </div>
          )}
        </div>

        {onEdit && (
          <div className="flex justify-end pt-2 border-t border-border">
            <button type="button" onClick={onEdit} className="btn-primary inline-flex items-center gap-2">
              <Pencil size={16} /> Edit Promotion
            </button>
          </div>
        )}
      </div>
    </SlideOver>
  );
}
