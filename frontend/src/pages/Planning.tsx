import { useState } from "react";
import { Calculator, Factory, ShoppingCart } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { MRPItem, MRPPlan } from "../types";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import FittedSelect from "../components/FittedSelect";
import { useSelectableProducts } from "../hooks/useSelectableProducts";
import { productLabel } from "../utils/variants";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { errorMessage } from "../utils/errors";

export default function Planning() {
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("10");
  const [ran, setRan] = useState(false);
  const { can } = useAuth();

  const products = useSelectableProducts();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["mrp", productId, quantity],
    queryFn: async () => {
      const { data } = await api.get("/planning/mrp", {
        params: { product_id: Number(productId), quantity: Number(quantity) },
      });
      return data as MRPPlan;
    },
    enabled: ran && !!productId,
  });

  const handleRun = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId) return;
    setRan(true);
    refetch();
  };

  const actionBadge = (a: MRPItem["action"]) =>
    a === "manufacture" ? "badge-info" : a === "purchase" ? "badge-warning" : "badge-success";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <Calculator size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-ink">MRP Planning</h1>
            <p className="text-sm text-muted">Explode the BOM and net demand against stock and open work orders.</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleRun} className="card p-4 flex flex-wrap items-end gap-4">
        <div className="min-w-65 flex-1">
          <label className="block text-sm font-medium text-ink mb-1">Demand Product</label>
          <FittedSelect
            ariaLabel="Demand product"
            value={productId}
            onChange={setProductId}
            disabled={false}
            options={[
              { value: "", label: "Select product..." },
              ...products.filter((p) => !p.is_variant).sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: String(p.id), label: productLabel(p) })),
            ]}
          />
        </div>
        <div className="w-32">
          <label className="block text-sm font-medium text-ink mb-1">Quantity</label>
          <input type="number" min={1} className="input" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
        <button type="submit" disabled={!productId} className="btn-primary inline-flex items-center gap-2">
          <Calculator size={16} /> Run MRP
        </button>
      </form>

      {isLoading && <Skeleton variant="rows" rows={8} cols={6} />}
      {isError && <ErrorState variant="block" title="Failed to run MRP" onRetry={() => refetch()} />}
      {!isLoading && ran && data && data.items.length === 0 && (
        <EmptyState variant="block" title="No plan" message="This product has no active BOM to explode." />
      )}
      {!isLoading && ran && data && data.items.length > 0 && (
        <div className="card overflow-hidden p-0">
          <div className="px-4 py-3 bg-app border-b text-sm text-ink">
            Demand: <span className="font-medium">{data.demand_quantity} × {data.demand_product_name}</span>
            <span className="ml-3 text-faint">Shortages: <span className="font-medium text-ink">{data.items.filter((i) => i.net_requirement > 0).length}</span></span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted border-b bg-app">
                  <th className="px-3 py-2 font-medium">Level</th>
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium">Component Of</th>
                  <th className="px-3 py-2 font-medium text-right">Gross</th>
                  <th className="px-3 py-2 font-medium text-right">On Hand</th>
                  <th className="px-3 py-2 font-medium text-right">Scheduled</th>
                  <th className="px-3 py-2 font-medium text-right">Net</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium text-right">Suggested</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.items.map((item) => (
                  <tr key={`${item.product_id}-${item.level}`} className="hover:bg-app">
                    <td className="px-3 py-2 text-muted">{item.level}</td>
                    <td className="px-3 py-2 font-medium">{item.product_name}</td>
                    <td className="px-3 py-2 text-muted">{item.level === 1 ? "—" : item.component_of}</td>
                    <td className="px-3 py-2 text-right">{item.gross_requirement}</td>
                    <td className="px-3 py-2 text-right">{item.on_hand}</td>
                    <td className="px-3 py-2 text-right">{item.scheduled_receipts}</td>
                    <td className={`px-3 py-2 text-right font-medium ${item.net_requirement > 0 ? "text-red-600 dark:text-red-400" : "text-faint"}`}>{item.net_requirement}</td>
                    <td className="px-3 py-2">
                      <span className={`badge ${actionBadge(item.action)} capitalize`}>{item.action === "none" ? "covered" : item.action}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {item.action === "manufacture" && can("work_orders.create") ? (
                        <CreateWoButton item={item} />
                      ) : item.action === "purchase" ? (
                        <span className="inline-flex items-center gap-1 text-muted"><ShoppingCart size={14} /> purchase</span>
                      ) : (
                        <span className="text-faint">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function CreateWoButton({ item }: { item: MRPItem }) {
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();
  const { addToast } = useToast();

  const create = async () => {
    if (!item.bom_id) return;
    setSaving(true);
    try {
      await api.post("/work-orders", {
        product_id: item.product_id,
        quantity: item.suggested_quantity,
        bom_id: item.bom_id,
      });
      addToast(`Work order created for ${item.suggested_quantity} × ${item.product_name}`, "success");
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["mrp"] });
    } catch (err: unknown) {
      addToast(errorMessage(err, "Error creating work order"), "error");
    }
    setSaving(false);
  };

  return (
    <button onClick={create} disabled={saving} className="btn-secondary text-xs py-1 px-2 inline-flex items-center gap-1" title="Create planned work order">
      <Factory size={12} /> {saving ? "..." : "Create WO"}
    </button>
  );
}
