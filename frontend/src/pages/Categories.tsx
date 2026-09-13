import { useMemo, useState } from "react";
import Table from "../components/Table";
import { Pencil, Trash2, Eye, ChevronDown, ChevronRight, FolderOpen, Folder, FolderTree, Search } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import { PAGE_SIZE_PRODUCTS } from "../utils/constants";
import type { Category, CategoryTree, PaginatedResponse } from "../types";
import CategoryDetail from "../components/CategoryDetail";
import CategoryForm from "../components/CategoryForm";
import ConfirmDialog from "../components/ConfirmDialog";
import BulkActionBar from "../components/BulkActionBar";
import EntityBulkEditModal, { type BulkFieldConfig, type BulkFieldOption } from "../components/EntityBulkEditModal";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import { useDebounce } from "../hooks/useDebounce";
import { useBulkSelection } from "../hooks/useBulkSelection";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { exportCSV } from "../utils/csv";

import { usePageSize } from "../hooks/usePageSize";
import { errorMessage } from "../utils/errors";

export default function Categories() {
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search") ?? "");
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [viewing, setViewing] = useState<Category | null>(null);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [view, setView] = useState<"table" | "tree">("table");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { can } = useAuth();
  const debouncedSearch = useDebounce(search, 300);

  const { data: allCategories } = useQuery({
    queryKey: ["categories", "all"],
    queryFn: async () => {
      const { data } = await api.get("/categories", { params: { limit: PAGE_SIZE_PRODUCTS } });
      return (data as PaginatedResponse<Category>).items;
    },
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["categories", debouncedSearch, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = { skip: ((page - 1) * pageSize).toString(), limit: pageSize.toString() };
      if (debouncedSearch) params.search = debouncedSearch;
      const { data } = await api.get("/categories", { params });
      return data as PaginatedResponse<Category>;
    },
  });

  const { data: tree, isLoading: treeLoading } = useQuery({
    queryKey: ["categories", "tree"],
    queryFn: async () => {
      const { data } = await api.get("/categories/tree");
      return data as CategoryTree[];
    },
  });

  const q = search.trim().toLowerCase();

  const matches = (n: CategoryTree) =>
    n.name.toLowerCase().includes(q) ||
    (n.description || "").toLowerCase().includes(q);

  const filterTree = (nodes: CategoryTree[]): CategoryTree[] =>
    nodes
      .filter((n) => matches(n) || filterTree(n.subcategories || []).length > 0)
      .map((n) => ({ ...n, subcategories: filterTree(n.subcategories || []) }));

  const visibleTree = q ? filterTree(tree || []) : tree || [];
  const isSearching = q.length > 0;

  const allTreeIds = useMemo(() => {
    const ids: number[] = [];
    const walk = (nodes: CategoryTree[]) => (nodes || []).forEach((n) => { ids.push(n.id); walk(n.subcategories || []); });
    walk(tree || []);
    return ids;
  }, [tree]);

  const toggleTree = (id: number) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  const expandAll = () => setExpanded(new Set(allTreeIds));
  const collapseAll = () => setExpanded(new Set());

  const renderNode = (node: CategoryTree, depth: number, forceOpen: boolean) => {
    const hasChildren = (node.subcategories?.length || 0) > 0;
    const isOpen = forceOpen || expanded.has(node.id);
    return (
      <div key={node.id}>
        <div
          className="flex items-center gap-2 px-3 py-2 hover:bg-app border-b border-border"
          style={{ paddingLeft: `${depth * 24 + 12}px` }}
        >
          <button
            onClick={() => toggleTree(node.id)}
            disabled={!hasChildren}
            className="text-faint disabled:opacity-30"
            aria-label={isOpen ? "Collapse" : "Expand"}
          >
            {hasChildren ? (isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : <span className="inline-block w-4" />}
          </button>
          <span className="font-medium text-ink">{node.name}</span>
          <span className="text-sm text-muted truncate">{node.description}</span>
          <div className="ml-auto flex gap-2">
            <button onClick={() => setViewing(node)} className="p-1 text-faint hover:text-primary dark:text-primary" aria-label={`View ${node.name}`}><Eye size={16} /></button>
            <button onClick={() => { setEditing(node); setShowForm(true); }} className="p-1 text-faint hover:text-primary dark:text-primary" aria-label={`Edit ${node.name}`}><Pencil size={16} /></button>
            <button onClick={() => setDeleting(node)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Delete ${node.name}`}><Trash2 size={16} /></button>
          </div>
        </div>
        {isOpen && hasChildren && (node.subcategories || []).map((child) => renderNode(child, depth + 1, forceOpen))}
      </div>
    );
  };

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/categories/${id}`),
    onSuccess: () => {
      addToast("Category deleted", "success");
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (err: unknown) => {
      addToast(errorMessage(err, "Cannot delete category"), "error");
    },
  });

  const categories = data?.items || [];
  const { selectedIds, allSelected, toggleSelect, toggleSelectAll, clearSelection } = useBulkSelection(categories);

  const parentOptions: BulkFieldOption[] = [
    { value: "__none__", label: "No parent (top-level)" },
    ...(allCategories || [])
      .filter((c) => !selectedIds.has(c.id))
      .map((c) => ({ value: String(c.id), label: c.name })),
  ];

  const bulkFields: BulkFieldConfig[] = [
    { name: "description", label: "Description", type: "text" },
    { name: "parent_id", label: "Parent", type: "select", options: parentOptions, clearValue: "__none__", valueType: "number" },
  ];

  const handleExport = () => {
    exportCSV(
      ["Name", "Description"],
      categories.map((c) => [c.name, c.description]),
      "categories"
    );
    addToast("Categories exported to CSV", "success");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <FolderTree size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-ink">Categories</h1>
            <p className="text-sm text-muted mt-1">Organize products into categories and subcategories.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport} className="btn-secondary" aria-label="Export categories to CSV">
            Export
          </button>
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary">
            Add Category
          </button>
        </div>
      </div>

      {isError && <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">{errorMessage(error, "Failed to load categories")}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-2 items-center">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input className="input pl-10" placeholder="Search by name..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search categories" />
        </div>
        <div role="group" aria-label="View mode" className="flex items-center gap-1 rounded-lg border border-border bg-subtle p-0.5">
          <button
            onClick={() => setView("table")}
            className={`px-3 py-1 rounded-md text-sm transition-colors ${view === "table" ? "bg-surface text-primary dark:text-primary shadow-sm" : "text-muted hover:text-ink"}`}
          >
            Table
          </button>
          <button
            onClick={() => setView("tree")}
            className={`px-3 py-1 rounded-md text-sm transition-colors ${view === "tree" ? "bg-surface text-primary dark:text-primary shadow-sm" : "text-muted hover:text-ink"}`}
          >
            Tree
          </button>
        </div>
        {view === "tree" && (
          <>
            <button onClick={expandAll} className="btn-secondary inline-flex items-center gap-1 text-sm" aria-label="Expand all categories">
              <FolderOpen size={14} /> Expand all
            </button>
            <button onClick={collapseAll} className="btn-secondary inline-flex items-center gap-1 text-sm" aria-label="Collapse all categories">
              <Folder size={14} /> Collapse all
            </button>
          </>
        )}
      </div>

      {view === "table" && (
        <BulkActionBar count={selectedIds.size} canEdit={can("categories.bulk")} onEdit={() => setShowBulkEdit(true)} onClear={clearSelection} />
      )}

      {view === "table" ? (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
        <Table
          columns={[
            { key: 'select', header: <input type="checkbox" className="rounded border-border-strong" checked={allSelected} onChange={toggleSelectAll} aria-label="Select all categories" />, className: 'px-4 py-3' },
            { key: 'name', header: 'Name', className: 'px-4 py-3 font-medium text-muted' },
            { key: 'description', header: 'Description', className: 'px-4 py-3 font-medium text-muted' },
            { key: 'actions', header: 'Actions', className: 'px-4 py-3 font-medium text-muted' },
          ]}
          role="grid"
          aria-label="Categories table"
          loading={isLoading}
          skeletonRows={5}
          noData={categories.length === 0}
          empty={<EmptyState title="No categories" message="Create your first category to organize products." actionLabel="Add Category" onAction={() => { setEditing(null); setShowForm(true); }} />}
        >
          {categories.map((c) => (
              <tr key={c.id} className="hover:bg-app">
                <td className="px-4 py-3">
                  <input type="checkbox" className="rounded border-border-strong" checked={selectedIds.has(c.id)} onChange={() => toggleSelect(c.id)} aria-label={`Select ${c.name}`} />
                </td>
                <td className="px-4 py-3 font-medium">{c.name}</td>
                <td className="px-4 py-3 text-muted">{c.description}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => setViewing(c)} className="p-1 text-faint hover:text-primary dark:text-primary" aria-label={`View ${c.name}`}><Eye size={16} /></button>
                    <button onClick={() => { setEditing(c); setShowForm(true); }} className="p-1 text-faint hover:text-primary dark:text-primary" aria-label={`Edit ${c.name}`}><Pencil size={16} /></button>
                    <button onClick={() => setDeleting(c)} className="p-1 text-faint hover:text-red-600 dark:text-red-400" aria-label={`Delete ${c.name}`}><Trash2 size={16} /></button>
                  </div>
                </td>
              </tr>
            ))}
        </Table>
          </div>
        </div>
      ) : treeLoading ? (
        <Skeleton variant="rows" rows={5} cols={3} />
      ) : visibleTree.length === 0 ? (
        <EmptyState title={q ? "No matching categories" : "No categories"} message={q ? `Nothing matched "${search}".` : "Create your first category to organize products."} actionLabel={q ? undefined : "Add Category"} onAction={q ? undefined : () => { setEditing(null); setShowForm(true); }} />
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <div className="px-4 py-3 bg-app border-b text-sm text-muted">Category hierarchy</div>
            {visibleTree.map((node) => renderNode(node, 0, isSearching))}
          </div>
        </div>
      )}

      {view === "table" && (
        <Pagination page={page} totalPages={data?.pages || 1} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
      )}

      {showForm && (
        <CategoryForm
          category={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); queryClient.invalidateQueries({ queryKey: ["categories"] }); }}
        />
      )}

      {viewing && <CategoryDetail category={viewing} onClose={() => setViewing(null)} />}

      {showBulkEdit && (
        <EntityBulkEditModal
          ids={[...selectedIds]}
          entityLabel="Category"
          endpoint="/categories/bulk-edit"
          fields={bulkFields}
          onClose={() => setShowBulkEdit(false)}
          onSaved={() => {
            setShowBulkEdit(false);
            clearSelection();
            queryClient.invalidateQueries({ queryKey: ["categories"] });
            addToast("Categories updated", "success");
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete Category"
        message={`Are you sure you want to delete "${deleting?.name}"? This action cannot be undone.`}
        onConfirm={() => { deleteMutation.mutate(deleting!.id); setDeleting(null); }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
