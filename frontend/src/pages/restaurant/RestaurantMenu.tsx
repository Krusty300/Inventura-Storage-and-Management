import { useState } from "react";
import { BookOpen, Pencil, Plus, Trash2, X } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../api/client";
import type { MenuItem, MenuModifierGroup, MenuSection, MenuSectionWithItems } from "../../types";
import EmptyState from "../../components/EmptyState";
import ConfirmDialog from "../../components/ConfirmDialog";
import FittedSelect from "../../components/FittedSelect";
import RestaurantMenuProductDetail from "../../components/restaurant/RestaurantMenuProductDetail";
import SlideOver from "../../components/SlideOver";
import { PanelCard, PanelField, PanelFooter, PanelHeader, PanelSection, panelLabel } from "../../components/Panel";
import { getPlaceholder, onImageError } from "../../utils/placeholders";
import { useToast } from "../../context/ToastContext";
import { useAuth } from "../../context/AuthContext";
import { useSettings } from "../../hooks/useSettings";
import { formatCurrency } from "../../utils/currency";
import { errorMessage } from "../../utils/errors";

const MENU_QUERIES = ["restaurant-menu", "restaurant-menu-sections", "menu-products", "products", "restaurant-ticket"];

export default function RestaurantMenu() {
  const { can } = useAuth();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const symbol = settings?.currency_symbol ?? "$";
  const [showSectionForm, setShowSectionForm] = useState(false);
  const [editingSection, setEditingSection] = useState<MenuSection | null>(null);
  const [deletingSection, setDeletingSection] = useState<MenuSection | null>(null);
  const [modifierItem, setModifierItem] = useState<MenuItem | null>(null);
  const [viewingProduct, setViewingProduct] = useState<MenuItem | null>(null);

  const invalidateMenu = () => {
    MENU_QUERIES.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
  };

  const { data: sections, isLoading: sectionsLoading, isError, error } = useQuery({
    queryKey: ["restaurant-menu-sections"],
    queryFn: async () => (await api.get("/restaurant/menu-sections")).data as MenuSection[],
  });

  const { data: menu, isLoading: menuLoading } = useQuery({
    queryKey: ["restaurant-menu"],
    queryFn: async () => (await api.get("/restaurant/menu")).data as MenuSectionWithItems[],
  });

  const deleteSection = useMutation({
    mutationFn: (id: number) => api.delete(`/restaurant/menu-sections/${id}`),
    onSuccess: () => { addToast("Section deleted", "success"); invalidateMenu(); },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot delete section"), "error"),
  });

  const assignSection = useMutation({
    mutationFn: ({ productId, sectionId }: { productId: number; sectionId: number | null }) =>
      api.put(`/products/${productId}`, { menu_section_id: sectionId }),
    onSuccess: () => { addToast("Menu item moved", "success"); invalidateMenu(); },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot move item"), "error"),
  });

  const loading = sectionsLoading || menuLoading;
  const sectionList = sections ?? [];
  const blocks = menu ?? [];
  const allItems = blocks.flatMap((b) => b.items);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-y-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <BookOpen size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-ink">Menu</h1>
            <p className="text-sm text-muted mt-1">Organize menu sections and build modifiers for each menu item.</p>
          </div>
        </div>
        {can("restaurant.create") && (
          <button onClick={() => { setEditingSection(null); setShowSectionForm(true); }} className="btn-primary">
            Add Section
          </button>
        )}
      </div>

      {isError && (
        <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {errorMessage(error, "Failed to load menu sections")}
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="card p-5 animate-pulse h-24" />)}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {sectionList.map((s) => (
              <div key={s.id} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink truncate">{s.name}</div>
                    <div className="text-xs text-muted mt-0.5">
                      {s.item_count} item{s.item_count === 1 ? "" : "s"}{!s.is_active && " · Hidden"}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {can("restaurant.update") && (
                      <button onClick={() => { setEditingSection(s); setShowSectionForm(true); }} className="p-1 text-faint hover:text-primary dark:text-primary" aria-label={`Edit ${s.name}`}>
                        <Pencil size={15} />
                      </button>
                    )}
                    {can("restaurant.delete") && (
                      <button onClick={() => setDeletingSection(s)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Delete ${s.name}`}>
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {can("restaurant.create") && (
              <button
                onClick={() => { setEditingSection(null); setShowSectionForm(true); }}
                className="card p-4 border-2 border-dashed border-border hover:border-primary text-center text-muted hover:text-primary transition min-h-[76px] flex items-center justify-center gap-1.5"
              >
                <Plus size={16} /> Add Section
              </button>
            )}
          </div>

          {allItems.length === 0 ? (
            <EmptyState
              variant="block"
              icon={<BookOpen size={48} />}
              title="No menu items yet"
              message="Mark products as menu items from the Products page, then organize them into sections here."
            />
          ) : (
            <div className="space-y-6">
              {blocks.map((block) => (
                <section key={block.id ?? "uncategorized"} className="card p-5">
                  <div className="flex items-baseline justify-between gap-2 mb-4">
                    <h2 className="font-semibold text-ink">{block.name}</h2>
                    <span className="text-xs text-muted">{block.item_count} item{block.item_count === 1 ? "" : "s"}</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {block.items.map((item) => (
                      <div
                        key={item.id}
                        className="card p-4 flex flex-col gap-3 cursor-pointer hover:bg-app transition"
                        onClick={() => setViewingProduct(item)}
                      >
                        <img
                          src={item.image || item.image_url || getPlaceholder()}
                          alt={item.display_name}
                          loading="lazy"
                          decoding="async"
                          onError={onImageError}
                          className="w-full h-24 rounded-lg object-cover bg-app"
                        />
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium text-ink truncate">{item.display_name}</div>
                            <div className="text-xs text-muted mt-0.5">{item.sku} · {formatCurrency(item.unit_price, symbol)}</div>
                          </div>
                          {can("restaurant.update") && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setModifierItem(item); }}
                              className="btn-secondary text-xs px-2.5 py-1 shrink-0"
                              aria-label={`Edit modifiers for ${item.display_name}`}
                            >
                              Modifiers
                            </button>
                          )}
                        </div>
                        {can("restaurant.update") && (
                          <div
                            className="flex items-center gap-2 text-xs text-muted"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="shrink-0">Section</span>
                            <FittedSelect
                              className="flex-1 min-w-0"
                              inputClassName="text-xs py-1"
                              maxWidth={260}
                              value={item.section_id ? String(item.section_id) : ""}
                              onChange={(v) =>
                                assignSection.mutate({
                                  productId: item.id,
                                  sectionId: v ? Number(v) : null,
                                })
                              }
                              ariaLabel={`Section for ${item.display_name}`}
                              options={[
                                { value: "", label: "Uncategorized" },
                                ...sectionList.map((s) => ({ value: String(s.id), label: s.name })),
                              ]}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {showSectionForm && (
        <SectionForm
          section={editingSection}
          onClose={() => { setShowSectionForm(false); setEditingSection(null); }}
          onSaved={() => { setShowSectionForm(false); setEditingSection(null); invalidateMenu(); }}
        />
      )}

      {modifierItem && (
        <ModifierEditor
          product={modifierItem}
          onClose={() => { setModifierItem(null); invalidateMenu(); }}
        />
      )}

      <RestaurantMenuProductDetail
        menuItem={viewingProduct}
        onClose={() => setViewingProduct(null)}
      />

      <ConfirmDialog
        open={!!deletingSection}
        title="Delete Section"
        message={`Delete section "${deletingSection?.name}"? Its menu items move to Uncategorized.`}
        onConfirm={() => { if (deletingSection) deleteSection.mutate(deletingSection.id); setDeletingSection(null); }}
        onCancel={() => setDeletingSection(null)}
      />
    </div>
  );
}

function SectionForm({ section, onClose, onSaved }: { section: MenuSection | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(section?.name ?? "");
  const [description, setDescription] = useState(section?.description ?? "");
  const [sortOrder, setSortOrder] = useState(section?.sort_order ?? 0);
  const [isActive, setIsActive] = useState(section?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { name: name.trim(), description, sort_order: sortOrder, is_active: isActive };
      if (section) {
        await api.put(`/restaurant/menu-sections/${section.id}`, payload);
        addToast(`Section "${payload.name}" updated`, "success");
      } else {
        await api.post("/restaurant/menu-sections", payload);
        addToast(`Section "${payload.name}" created`, "success");
      }
      onSaved();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to save section"), "error");
    }
    setSaving(false);
  };

  return (
    <SlideOver
      open
      onClose={onClose}
      title={section ? `Edit Section: ${section.name}` : "New Menu Section"}
      breadcrumb={section ? `Edit ${section.name}` : "New menu section"}
    >
      <PanelCard>
        <PanelHeader
          eyebrow={section ? "Edit Section" : "New Section"}
          title={section ? section.name : "New menu section"}
        />
        <form id="section-form" onSubmit={handleSubmit} className="space-y-0">
          <PanelSection label="Section Details">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <PanelField label="Name *" htmlFor="section-name">
                <input id="section-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Starters, Mains, Drinks" maxLength={100} />
              </PanelField>
              <PanelField label="Sort order" htmlFor="section-sort">
                <input id="section-sort" className="input" type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(Math.max(0, parseInt(e.target.value) || 0))} />
              </PanelField>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <PanelField label="Description" htmlFor="section-desc">
                <input id="section-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Shown on menus (optional)" />
              </PanelField>
              <div className="flex items-end gap-2 pb-1">
                <input type="checkbox" className="rounded border-border-strong" id="section-active" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                <label htmlFor="section-active" className="text-sm text-ink">Active</label>
              </div>
            </div>
          </PanelSection>
          <PanelFooter>
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving || !name.trim()} className="btn-primary">{saving ? "Saving..." : section ? "Update" : "Create"}</button>
          </PanelFooter>
        </form>
      </PanelCard>
    </SlideOver>
  );
}

interface OptionRow {
  id?: number;
  name: string;
  price_delta: string;
}

function ModifierEditor({ product, onClose }: { product: MenuItem; onClose: () => void }) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const symbol = settings?.currency_symbol ?? "$";
  const [saving, setSaving] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [form, setForm] = useState<{ name: string; min_select: number; max_select: number; is_required: boolean; options: OptionRow[] }>({
    name: "", min_select: 0, max_select: 1, is_required: false, options: [{ name: "", price_delta: "0" }],
  });
  const [deletingGroup, setDeletingGroup] = useState<MenuModifierGroup | null>(null);

  const { data: groups, isLoading } = useQuery({
    queryKey: ["restaurant-modifier-groups", product.id],
    queryFn: async () => (await api.get(`/restaurant/menu-items/${product.id}/modifiers`)).data as MenuModifierGroup[],
  });

  const invalidateGroups = () => {
    queryClient.invalidateQueries({ queryKey: ["restaurant-modifier-groups", product.id] });
    queryClient.invalidateQueries({ queryKey: ["restaurant-menu"] });
    queryClient.invalidateQueries({ queryKey: ["menu-products"] });
    queryClient.invalidateQueries({ queryKey: ["restaurant-menu-sections"] });
  };

  const deleteGroup = useMutation({
    mutationFn: (id: number) => api.delete(`/restaurant/menu-modifier-groups/${id}`),
    onSuccess: () => { addToast("Modifier group deleted", "success"); invalidateGroups(); },
    onError: (err: unknown) => addToast(errorMessage(err, "Cannot delete group"), "error"),
  });

  const resetForm = () => {
    setEditingGroupId(null);
    setForm({ name: "", min_select: 0, max_select: 1, is_required: false, options: [{ name: "", price_delta: "0" }] });
  };

  const startEdit = (group: MenuModifierGroup) => {
    setEditingGroupId(group.id);
    setForm({
      name: group.name,
      min_select: group.min_select,
      max_select: group.max_select,
      is_required: group.is_required,
      options: group.options.map((o) => ({ id: o.id, name: o.name, price_delta: String(o.price_delta) })),
    });
  };

  const saveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanOptions = form.options.filter((o) => o.name.trim());
    if (!form.name.trim()) {
      addToast("Group name is required", "error");
      return;
    }
    if (cleanOptions.length === 0) {
      addToast("Add at least one option", "error");
      return;
    }
    if (form.max_select < Math.max(form.min_select, form.is_required ? 1 : 0)) {
      addToast("Max selections must cover min selections", "error");
      return;
    }
    setSaving(true);
    try {
      const groupPayload = {
        name: form.name.trim(),
        min_select: form.is_required ? Math.max(form.min_select, 1) : form.min_select,
        max_select: form.max_select,
        is_required: form.is_required,
      };
      if (editingGroupId === null) {
        await api.post(`/restaurant/menu-items/${product.id}/modifiers`, {
          ...groupPayload,
          options: cleanOptions.map((o, i) => ({ name: o.name.trim(), price_delta: parseFloat(o.price_delta) || 0, sort_order: i })),
        });
        addToast("Modifier group added", "success");
      } else {
        await api.put(`/restaurant/menu-modifier-groups/${editingGroupId}`, groupPayload);
        const original = groups?.find((g) => g.id === editingGroupId);
        const originalIds = new Set((original?.options ?? []).map((o) => o.id));
        const keptIds = new Set(cleanOptions.filter((o) => o.id).map((o) => o.id as number));
        for (const opt of cleanOptions) {
          const payload = { name: opt.name.trim(), price_delta: parseFloat(opt.price_delta) || 0, sort_order: cleanOptions.indexOf(opt) };
          if (opt.id) {
            await api.put(`/restaurant/menu-modifier-groups/${editingGroupId}/options/${opt.id}`, payload);
          } else {
            await api.post(`/restaurant/menu-modifier-groups/${editingGroupId}/options`, payload);
          }
        }
        for (const id of originalIds) {
          if (!keptIds.has(id)) {
            await api.delete(`/restaurant/menu-modifier-groups/${editingGroupId}/options/${id}`);
          }
        }
        addToast("Modifier group updated", "success");
      }
      resetForm();
      invalidateGroups();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to save modifier group"), "error");
    }
    setSaving(false);
  };

  const groupList = groups ?? [];

  return (
    <SlideOver
      open
      onClose={onClose}
      title={`Modifiers: ${product.display_name}`}
      breadcrumb={`Modifiers for ${product.display_name}`}
    >
      <PanelCard>
        <PanelHeader
          eyebrow="Modifiers"
          title={product.display_name}
          subtitle="Groups and the options guests can add"
        />
        <PanelSection label="Modifier Groups">
          {isLoading ? (
            <div className="card p-4 animate-pulse h-16" />
          ) : groupList.length === 0 && editingGroupId === null ? (
            <p className="text-sm text-muted">No modifiers yet — add a group like “Extras”, “Size”, or “Sides”.</p>
          ) : (
            <div className="space-y-4">
              {groupList.map((group) => (
                <div key={group.id} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-ink">{group.name}</div>
                    <div className="text-xs text-muted mt-0.5 flex gap-2 flex-wrap">
                      <span>Select {group.min_select}–{group.max_select}</span>
                      {group.is_required && <span className="badge badge-warning text-[10px]">Required</span>}
                      {!group.is_active && <span className="badge badge-neutral text-[10px]">Hidden</span>}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => startEdit(group)} className="p-1 text-faint hover:text-primary dark:text-primary" aria-label={`Edit ${group.name}`}>
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => setDeletingGroup(group)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Delete ${group.name}`}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                <ul className="mt-3 space-y-1">
                    {group.options.map((o) => (
                      <li key={o.id} className="flex justify-between text-sm text-muted">
                        <span>{o.name}{!o.is_active && " (hidden)"}</span>
                        <span className="tabular-nums">{o.price_delta >= 0 ? "+" : "-"}{formatCurrency(Math.abs(o.price_delta), symbol)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </PanelSection>

        <form onSubmit={saveGroup} className="space-y-0">
          <PanelSection label={editingGroupId === null ? "Add Modifier Group" : "Edit Modifier Group"}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <PanelField label="Group name *" htmlFor="group-name">
                <input id="group-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Extras, Size, Sides" maxLength={100} />
              </PanelField>
              <div className="grid grid-cols-2 gap-4">
                <PanelField label="Min" htmlFor="group-min">
                  <input id="group-min" className="input" type="number" min={0} max={99} value={form.min_select} onChange={(e) => setForm({ ...form, min_select: Math.max(0, parseInt(e.target.value) || 0) })} />
                </PanelField>
                <PanelField label="Max" htmlFor="group-max">
                  <input id="group-max" className="input" type="number" min={1} max={99} value={form.max_select} onChange={(e) => setForm({ ...form, max_select: Math.max(1, parseInt(e.target.value) || 1) })} />
                </PanelField>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-4">
              <input type="checkbox" className="rounded border-border-strong" id="group-required" checked={form.is_required} onChange={(e) => setForm({ ...form, is_required: e.target.checked })} />
              <label htmlFor="group-required" className="text-sm text-ink">Required</label>
            </div>
            <div className="space-y-2 mt-4">
              <span className={panelLabel}>Options *</span>
              {form.options.map((opt, i) => (
                <div key={opt.id ?? i} className="flex gap-2">
                  <input
                    className="input flex-1"
                    value={opt.name}
                    placeholder="Option name"
                    maxLength={100}
                    aria-label={`Option ${i + 1} name`}
                    onChange={(e) => {
                      const options = [...form.options];
                      options[i] = { ...opt, name: e.target.value };
                      setForm({ ...form, options });
                    }}
                  />
                  <input
                    className="input w-24"
                    type="number"
                    step="0.01"
                    value={opt.price_delta}
                    placeholder="0.00"
                    aria-label={`Option ${i + 1} price delta`}
                    onChange={(e) => {
                      const options = [...form.options];
                      options[i] = { ...opt, price_delta: e.target.value };
                      setForm({ ...form, options });
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, options: form.options.filter((_, j) => j !== i) })}
                    className="p-1 text-faint hover:text-red-600 dark:text-red-400"
                    aria-label={`Remove option ${i + 1}`}
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setForm({ ...form, options: [...form.options, { name: "", price_delta: "0" }] })}
                className="text-sm text-primary dark:text-primary font-medium flex items-center gap-1"
              >
                <Plus size={14} /> Add option
              </button>
            </div>
          </PanelSection>
          <PanelFooter>
            {editingGroupId !== null && (
              <button type="button" onClick={resetForm} className="btn-secondary">Cancel edit</button>
            )}
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Saving..." : editingGroupId === null ? "Add Group" : "Save Group"}
            </button>
          </PanelFooter>
        </form>
      </PanelCard>

      <ConfirmDialog
        open={!!deletingGroup}
        title="Delete Modifier Group"
        message={`Delete "${deletingGroup?.name}" and all its options?`}
        onConfirm={() => { if (deletingGroup) deleteGroup.mutate(deletingGroup.id); setDeletingGroup(null); }}
        onCancel={() => setDeletingGroup(null)}
      />
    </SlideOver>
  );
}