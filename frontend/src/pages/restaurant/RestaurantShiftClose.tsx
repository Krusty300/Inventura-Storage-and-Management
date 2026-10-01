import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, ClipboardCheck, History, TriangleAlert } from "lucide-react";
import api from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useSettings } from "../../hooks/useSettings";
import { useDateTimeFormat } from "../../hooks/useDateTimeFormat";
import { formatCurrency } from "../../utils/currency";
import { errorMessage } from "../../utils/errors";
import { paymentLabel } from "../../utils/payments";
import EmptyState from "../../components/EmptyState";

interface ShiftPreview {
  period_start: string;
  period_end: string;
  ticket_count: number;
  total_sales: number;
  expected_cash: number;
  cash_tips: number;
  cash_sales: number;
  open_tickets: number;
  paying_tickets: number;
  payment_review_count: number;
  payment_review_amount: number;
  by_method: Record<string, { count: number; total: number; tips: number }>;
  open_prep_sessions: number;
  prep_session_count: number;
  prepped_qty: number;
  prep_sold_qty: number;
  prep_waste_qty: number;
  prep_variance_qty: number;
}

interface ShiftClose {
  id: number;
  username: string;
  period_start: string;
  period_end: string;
  ticket_count: number;
  total_sales: number;
  expected_cash: number;
  counted_cash: number;
  variance: number;
  cash_tips: number;
  cash_sales: number;
  opening_float: number;
  paid_in: number;
  paid_out: number;
  prep_session_count: number;
  prepped_qty: number;
  prep_sold_qty: number;
  prep_waste_qty: number;
  prep_variance_qty: number;
  notes: string;
  created_at: string;
}

export default function RestaurantShiftClose() {
  const { can } = useAuth();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const symbol = settings?.currency_symbol ?? "$";
  const formatDateTime = useDateTimeFormat();

  const [counted, setCounted] = useState("");
  const [openingFloat, setOpeningFloat] = useState("");
  const [paidIn, setPaidIn] = useState("");
  const [paidOut, setPaidOut] = useState("");
  const [notes, setNotes] = useState("");

  const { data: preview, isLoading, isError, error } = useQuery<ShiftPreview>({
    queryKey: ["restaurant-shift-preview"],
    queryFn: async () => (await api.get("/restaurant/shifts/preview")).data,
  });

  const { data: history } = useQuery<ShiftClose[]>({
    queryKey: ["restaurant-shifts"],
    queryFn: async () => (await api.get("/restaurant/shifts")).data,
  });

  const closeMutation = useMutation({
    mutationFn: async () => {
      const value = Number(counted);
      if (!Number.isFinite(value) || value < 0) throw new Error("Enter the counted cash amount");
      return (await api.post("/restaurant/shifts/close", {
        counted_cash: value,
        opening_float: Number(openingFloat) || 0,
        paid_in: Number(paidIn) || 0,
        paid_out: Number(paidOut) || 0,
        notes: notes.trim(),
      })).data as ShiftClose;
    },
    onSuccess: (row) => {
      addToast(
        row.variance === 0
          ? "Drawer balanced"
          : `Drawer closed with ${formatCurrency(row.variance, symbol, 2)} variance`,
        row.variance === 0 ? "success" : "info",
      );
      setCounted("");
      setOpeningFloat("");
      setPaidIn("");
      setPaidOut("");
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["restaurant-shift-preview"] });
      queryClient.invalidateQueries({ queryKey: ["restaurant-shifts"] });
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot close shift"), "error"),
  });

  const countedValue = Number(counted);
  // Mirror of the server formula: float + pay-in - pay-out + cash sales + tips.
  const expectedCash = preview
    ? Math.round(
        ((preview.cash_sales || 0) + (preview.cash_tips || 0)
          + (Number(openingFloat) || 0) + (Number(paidIn) || 0) - (Number(paidOut) || 0)) * 100,
      ) / 100
    : 0;
  const variance = counted.trim() !== "" && Number.isFinite(countedValue)
    ? Math.round((countedValue - expectedCash) * 100) / 100
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 min-w-0">
        <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
          <ClipboardCheck size={22} strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-ink">Shift Close</h1>
          <p className="text-sm text-muted mt-1">Reconcile the cash drawer for your shift.</p>
        </div>
      </div>

      {isError && (
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {errorMessage(error, "Failed to load shift summary")}
        </div>
      )}

      {isLoading ? (
        <div className="card animate-pulse h-40" />
      ) : !preview ? (
        <div className="card p-6">
          <EmptyState variant="table" icon={<ClipboardCheck size={48} />} title="No shift data" message="Settled tickets in your shift will appear here." />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="card">
              <div className="flex items-center gap-2 text-muted text-xs"><Banknote size={16} />Expected cash</div>
              <p className="text-xl font-bold mt-1">{formatCurrency(expectedCash, symbol, 2)}</p>
              <p className="text-xs text-faint mt-1">Since {formatDateTime(preview.period_start)}</p>
            </div>
            <div className="card">
              <div className="text-muted text-xs">Tickets settled</div>
              <p className="text-xl font-bold mt-1">{preview.ticket_count}</p>
              <p className="text-xs text-faint mt-1">{formatCurrency(preview.total_sales, symbol, 2)} sales</p>
            </div>
            <div className="card">
              <div className="text-muted text-xs">Cash tips</div>
              <p className="text-xl font-bold mt-1">{formatCurrency(preview.cash_tips, symbol, 2)}</p>
            </div>
            <div className="card">
              <div className="text-muted text-xs">Still open</div>
              <p className="text-xl font-bold mt-1">{preview.open_tickets + preview.paying_tickets}</p>
              <p className="text-xs text-faint mt-1">{preview.paying_tickets} awaiting payment</p>
            </div>
          </div>

          {preview.payment_review_count > 0 && (
            <div className="flex items-start gap-2 text-sm bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 px-4 py-3 rounded-lg border border-amber-200 dark:border-amber-500/20">
              <TriangleAlert size={16} className="mt-0.5 shrink-0" />
              <span>
                {preview.payment_review_count} mobile-money payment{preview.payment_review_count === 1 ? "" : "s"} came in
                at the wrong figure — {formatCurrency(preview.payment_review_amount, symbol, 2)} received. These are
                flagged on their sales; refund or write off the difference before signing off.
              </span>
            </div>
          )}

          {(preview.paying_tickets > 0 || preview.open_tickets > 0) && (
            <div className="flex items-start gap-2 text-sm bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 px-4 py-3 rounded-lg border border-amber-200 dark:border-amber-500/20">
              <TriangleAlert size={16} className="mt-0.5 shrink-0" />
              <span>
                {preview.paying_tickets} ticket{preview.paying_tickets === 1 ? "" : "s"} still awaiting mobile-money confirmation
                {preview.open_tickets > 0 && ` and ${preview.open_tickets} open`} — these are not part of the drawer yet.
              </span>
            </div>
          )}

          <div className="card">
            <h2 className="text-lg font-semibold mb-1">Count the drawer</h2>
            <p className="text-sm text-muted mb-3">
              Expected = {formatCurrency(preview.cash_sales || 0, symbol, 2)} cash sales
              + {formatCurrency(preview.cash_tips || 0, symbol, 2)} tips
              + float + pay-ins − pay-outs. The shift window is set by the server.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className="block">
                <span className="text-sm text-muted">Opening float</span>
                <input
                  className="input mt-1"
                  type="number"
                  min={0}
                  step="0.01"
                  value={openingFloat}
                  onChange={(e) => setOpeningFloat(e.target.value)}
                  placeholder="0.00"
                  aria-label="Opening float"
                />
              </label>
              <label className="block">
                <span className="text-sm text-muted">Paid in</span>
                <input
                  className="input mt-1"
                  type="number"
                  min={0}
                  step="0.01"
                  value={paidIn}
                  onChange={(e) => setPaidIn(e.target.value)}
                  placeholder="0.00"
                  aria-label="Cash paid in"
                />
              </label>
              <label className="block">
                <span className="text-sm text-muted">Paid out</span>
                <input
                  className="input mt-1"
                  type="number"
                  min={0}
                  step="0.01"
                  value={paidOut}
                  onChange={(e) => setPaidOut(e.target.value)}
                  placeholder="0.00"
                  aria-label="Cash paid out"
                />
              </label>
              <label className="block">
                <span className="text-sm text-muted">Counted cash</span>
                <input
                  className="input mt-1"
                  type="number"
                  min={0}
                  step="0.01"
                  value={counted}
                  onChange={(e) => setCounted(e.target.value)}
                  aria-label="Counted cash"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-sm text-muted">Notes</span>
                <input
                  className="input mt-1"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={300}
                  placeholder="Optional"
                  aria-label="Shift notes"
                />
              </label>
            </div>
            {variance !== null && (
              <p className={`mt-3 text-sm font-medium ${variance === 0 ? "text-emerald-600 dark:text-emerald-400" : variance < 0 ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
                Variance: {formatCurrency(variance, symbol, 2)}
              </p>
            )}
            <p className="mt-3 text-sm text-muted">
              Expected = {formatCurrency(preview.cash_sales || 0, symbol, 2)} cash sales
              + {formatCurrency(preview.cash_tips || 0, symbol, 2)} tips
              + float + pay-ins − pay-outs. The shift window is set by the server.
            </p>
            {can("restaurant.update") && (
              <button
                onClick={() => closeMutation.mutate()}
                disabled={closeMutation.isPending || counted.trim() === ""}
                className="btn-primary mt-4"
              >
                {closeMutation.isPending ? "Closing…" : "Close shift"}
              </button>
            )}
          </div>

          {preview.open_prep_sessions > 0 && (
            <div className="flex items-start gap-2 text-sm bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 px-4 py-3 rounded-lg border border-amber-200 dark:border-amber-500/20">
              <TriangleAlert size={16} className="mt-0.5 shrink-0" />
              <span>
                {preview.open_prep_sessions} prep session{preview.open_prep_sessions === 1 ? " is" : "s are"} still open. Count and close
                them so the batch is reconciled before you close the shift.
              </span>
            </div>
          )}

          {(preview.prep_session_count > 0 || preview.open_prep_sessions > 0) && (
            <div className="card">
              <h2 className="text-lg font-semibold mb-1">Prep this shift</h2>
              <p className="text-sm text-muted mb-3">
                Food loss is tracked separately from cash. A prepped plate that never reaches a guest shows up here, not in the drawer.
              </p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-muted">Sessions closed</p>
                  <p className="text-xl font-bold">{preview.prep_session_count}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Prepped / sold</p>
                  <p className="text-xl font-bold">{preview.prepped_qty} / {preview.prep_sold_qty}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Waste</p>
                  <p className="text-xl font-bold">{preview.prep_waste_qty}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Variance</p>
                  <p className={`text-xl font-bold ${preview.prep_variance_qty === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                    {preview.prep_variance_qty}
                  </p>
                </div>
              </div>
            </div>
          )}

          {Object.keys(preview.by_method).length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold mb-3">Payments this shift</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-app text-left">
                      <th scope="col" className="px-4 py-2 font-medium text-muted">Method</th>
                      <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Tickets</th>
                      <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Total</th>
                      <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Tips</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {Object.entries(preview.by_method).map(([method, row]) => (
                      <tr key={method}>
                        <td className="px-4 py-2">{paymentLabel(method)}</td>
                        <td className="px-4 py-2 text-right">{row.count}</td>
                        <td className="px-4 py-2 text-right">{formatCurrency(row.total, symbol, 2)}</td>
                        <td className="px-4 py-2 text-right">{formatCurrency(row.tips, symbol, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      <div className="card">
        <h2 className="text-lg font-semibold mb-3">Recent closes</h2>
        {(history ?? []).length === 0 ? (
          <EmptyState
            compact
            icon={<History size={20} />}
            title="No shifts closed yet"
            message="Your first cash-drawer close will be listed here with its drawer and prep variance."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-app text-left">
                  <th scope="col" className="px-4 py-2 font-medium text-muted">Closed</th>
                  <th scope="col" className="px-4 py-2 font-medium text-muted">Server</th>
                  <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Expected</th>
                  <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Counted</th>
                      <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Variance</th>
                      <th scope="col" className="px-4 py-2 font-medium text-muted text-right">Prep variance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(history ?? []).map((h) => (
                      <tr key={h.id}>
                        <td className="px-4 py-2">{formatDateTime(h.created_at)}</td>
                        <td className="px-4 py-2">{h.username}</td>
                        <td className="px-4 py-2 text-right">{formatCurrency(h.expected_cash, symbol, 2)}</td>
                        <td className="px-4 py-2 text-right">{formatCurrency(h.counted_cash, symbol, 2)}</td>
                        <td className={`px-4 py-2 text-right ${h.variance === 0 ? "text-emerald-600 dark:text-emerald-400" : h.variance < 0 ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
                          {formatCurrency(h.variance, symbol, 2)}
                        </td>
                        <td className={`px-4 py-2 text-right ${h.prep_variance_qty === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                          {h.prep_variance_qty}
                          {h.prep_session_count > 0 && (
                            <span className="block text-xs text-faint">{h.prep_session_count} session(s)</span>
                          )}
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
