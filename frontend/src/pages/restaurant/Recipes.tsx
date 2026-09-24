import { useMemo, useState } from "react";
import { ChefHat, Layers, Plus, Pencil, Search, Trash2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../api/client";
import type { RestaurantRecipeRow } from "../../types";
import SlideOver from "../../components/SlideOver";
import Skeleton from "../../components/Skeleton";
import EmptyState from "../../components/EmptyState";
import ErrorState from "../../components/ErrorState";
import FittedSelect from "../../components/FittedSelect";
import TextArea from "../../components/TextArea";
import ConfirmDialog from "../../components/ConfirmDialog";
import { useDebounce } from "../../hooks/useDebounce";
import { useSelectableProducts } from "../../hooks/useSelectableProducts";
import { productLabel } from "../../utils/variants";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useSettings } from "../../hooks/useSettings";
import { formatCurrency } from "../../utils/currency";
import { errorMessage } from "../../utils/errors";

function marginClass(marginPct: number): string {
  if (marginPct <= 0) return "badge-danger";
  if (marginPct < 30) return "badge-warning";
  return "badge-success";
}

function RecipeForm({ row, onClose, onSaved }: { row: RestaurantRecipeRow; onClose: () => void; onSaved: () => void }) {
  const components = useSelectableProducts();
  const { addToast } = useToast();
  const hasRecipe = !!row.recipe_id;
  const [name, setName] = useState(row.recipe_name || row.name);
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [rows, setRows] = useState<{ product_id: string; quantity: string }[]>(
    row.components.map((c) => ({ product_id: String(c.product_id), quantity: String(c.quantity) })) || [{ product_id: "", quantity: "1" }],
  );
  const [saving, setSaving] = useState(false);

  const setRow = (idx: number, key: string, value: string) => {
    setRows(rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const items = rows
      .filter((r) => r.product_id)
      .map((r) => ({ product_id: Number(r.product_id), quantity: parseInt(r.quantity) || 1 }));
    if (items.length === 0) {
      addToast("Add at least one ingredient", "error");
      return;
    }
    setSaving(true);
    try {
      const payload = { product_id: row.product_id, name: name.trim(), description: description.trim(), is_active: isActive, items };
      if (hasRecipe) {
        await api.put(`/boms/${row.recipe_id}`, payload);
        addToast("Recipe updated", "success");
      } else {
        await api.post("/boms", payload);
        addToast(`Recipe for '${row.name}' created`, "success");
      }
      onSaved();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Error saving recipe"), "error");
    }
    setSaving(false);
  };

  return (
    <SlideOver open onClose={onClose} title={`${hasRecipe ? "Edit" : "New"} recipe · ${row.name}`} wide>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Menu item</label>
            <input className="input bg-app/60" value={row.name} disabled aria-label="Menu item" />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Recipe name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Recipe name" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">Description</label>
          <TextArea rows={2} value={description} onChange={setDescription} />
        </div>

        <div className="border border-border rounded-xl overflow-hidden bg-app/50">
          <div className="bg-app px-4 py-2.5 flex items-center justify-between border-b border-border">
            <span className="text-sm font-medium text-ink flex items-center gap-2">
              <Layers size={15} className="text-faint" />
              Ingredients
              {rows.length > 0 && (
                <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-primary-soft text-primary-strong dark:text-primary text-xs font-semibold">{rows.length}</span>
              )}
            </span>
            <button type="button" onClick={() => setRows([...rows, { product_id: "", quantity: "1" }])} className="btn-secondary text-xs py-1 px-2">
              <Plus size={14} className="inline mr-0.5" />Add Ingredient
            </button>
          </div>
          <div className="divide-y divide-border max-h-[40vh] overflow-auto bg-surface">
            {rows.map((r, idx) => (
              <div key={idx} className="p-4 grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-2 items-end">
                <div className="sm:col-span-8">
                  <label className="block text-xs font-medium text-muted mb-1">Ingredient</label>
                  <FittedSelect
                    ariaLabel="Ingredient product"
                    value={r.product_id}
                    onChange={(v) => setRow(idx, "product_id", v)}
                    options={[
                      { value: "", label: "Select..." },
                      ...components.filter((p) => p.id !== row.product_id).map((p) => ({ value: String(p.id), label: productLabel(p) })),
                    ]}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-muted mb-1">Qty</label>
                  <input type="number" min={1} className="input" value={r.quantity} onChange={(e) => setRow(idx, "quantity", e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <button type="button" onClick={() => setRows(rows.filter((_, i) => i !== idx))} className="p-2 text-faint hover:text-red-600 dark:text-red-400 transition-colors" aria-label="Remove ingredient">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" className="rounded" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} aria-label="Active" />
          Active
        </label>

        <div className="flex justify-end gap-3 pt-4 border-t border-border">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving..." : hasRecipe ? "Update recipe" : "Create recipe"}</button>
        </div>
      </form>
    </SlideOver>
  );
}

export default function Recipes() {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [editing, setEditing] = useState<RestaurantRecipeRow | null>(null);
  const [deleting, setDeleting] = useState<RestaurantRecipeRow | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["restaurant-recipes"],
    queryFn: async () => (await api.get("/restaurant/recipes")).data as RestaurantRecipeRow[],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/boms/${id}`),
    onSuccess: () => {
      addToast("Recipe deleted", "success");
      queryClient.invalidateQueries({ queryKey: ["restaurant-recipes"] });
    },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot delete recipe"), "error"),
    onSettled: () => setDeleting(null),
  });

  const rows = useMemo(() => {
    if (!data) return [];
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return data;
    return data.filter(
      (r) => r.name.toLowerCase().includes(q) || (r.sku ?? "").toLowerCase().includes(q) || (r.recipe_name ?? "").toLowerCase().includes(q),
    );
  }, [data, debouncedSearch]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["restaurant-recipes"] });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <ChefHat size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-ink tracking-tight">Menu Recipes</h1>
            <p className="text-sm text-muted mt-0.5">Cost, margin and ingredients for every menu item.</p>
          </div>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
        <input className="input pl-10" placeholder="Search by item, SKU, or recipe..." value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search recipes" />
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" role="grid" aria-label="Menu recipes">
            <thead>
              <tr className="bg-app text-left">
                <th scope="col" className="px-4 py-3 font-medium text-muted">Menu Item</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted text-right">Price</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted text-right">Recipe Cost</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted text-right">Margin</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted text-right">Margin %</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted text-center">Ingredients</th>
                <th scope="col" className="px-4 py-3 font-medium text-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <Skeleton rows={6} cols={7} />
              ) : isError ? (
                <ErrorState onRetry={refresh} />
              ) : rows.length === 0 ? (
                <EmptyState icon={<ChefHat size={48} />} title={search ? "No matching items" : "No menu items yet"} message={search ? `Nothing matched "${search}".` : "Add menu items to track their recipe costs."} />
              ) : rows.map((r) => (
                <tr key={r.product_id} className="hover:bg-app">
                  <td className="px-4 py-3 font-medium">
                    {r.name}
                    {r.has_recipe && <span className="block text-xs text-muted font-normal">{r.recipe_name || "Recipe"}</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(r.price, currencySymbol)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(r.recipe_cost, currencySymbol)}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${r.margin < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{formatCurrency(r.margin, currencySymbol)}</td>
                  <td className="px-4 py-3 text-center"><span className={`badge ${marginClass(r.margin_pct)}`}>{r.margin_pct}%</span></td>
                  <td className="px-4 py-3 text-center text-muted">{r.component_count}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {can("bom.update") && (
                        <button onClick={() => setEditing(r)} className="p-1 text-faint hover:text-indigo-600 dark:text-indigo-400" aria-label={r.has_recipe ? `Edit recipe for ${r.name}` : `Add recipe for ${r.name}`}>
                          {r.has_recipe ? <Pencil size={16} /> : <Plus size={16} />}
                        </button>
                      )}
                      {r.has_recipe && can("bom.delete") && (
                        <button onClick={() => setDeleting(r)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Delete recipe for ${r.name}`}>
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <RecipeForm
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete Recipe"
        message={`Disconnect the recipe for '${deleting?.name}'? Stock will no longer be deducted for this menu item.`}
        confirmLabel="Delete"
        onConfirm={() => { if (deleting?.recipe_id) deleteMutation.mutate(deleting.recipe_id); }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
