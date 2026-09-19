import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, ShoppingBag, Package } from "lucide-react";
import api from "../../api/client";
import { useDebounce } from "../../hooks/useDebounce";
import { usePageSize } from "../../hooks/usePageSize";
import { formatCurrency } from "../../utils/currency";
import { onImageError, getPlaceholder } from "../../utils/placeholders";
import { entityImageUrl } from "../../utils/images";
import Pagination from "../../components/Pagination";
import EmptyState from "../../components/EmptyState";
import { errorMessage } from "../../utils/errors";
import type { CatalogProduct, CustomerPortalMe, PaginatedResponse } from "../../types";

export default function CustomerCatalog() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
  const debouncedSearch = useDebounce(search, 300);

  const { data: me } = useQuery({
    queryKey: ["customer", "me"],
    queryFn: async () => (await api.get("/customer/me")).data as CustomerPortalMe,
  });
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["customer", "catalog", debouncedSearch, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string> = {
        skip: String((page - 1) * pageSize),
        limit: String(pageSize),
      };
      if (debouncedSearch) params.search = debouncedSearch;
      const { data } = await api.get("/customer/products", { params });
      return data as PaginatedResponse<CatalogProduct>;
    },
  });
  const currencySymbol = me?.currency_symbol || "$";

  if (isError) {
    return (
      <div role="alert" className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
        {errorMessage(error, "Failed to load catalog")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-primary-soft text-primary-strong dark:text-primary shrink-0">
            <ShoppingBag size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-ink">Product Catalog</h1>
            <p className="text-sm text-muted mt-1 truncate">Browse the products we have available at your price.</p>
          </div>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
        <input
          className="input pl-10"
          placeholder="Search products..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          aria-label="Search products"
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card p-4 space-y-3">
              <div className="aspect-square rounded-lg bg-subtle-strong animate-pulse" />
              <div className="h-3 w-1/2 bg-subtle-strong rounded animate-pulse" />
              <div className="h-4 w-3/4 bg-subtle-strong rounded animate-pulse" />
            </div>
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon={<Package size={24} />}
          title={search ? "No matching products" : "Catalog is empty"}
          message={search ? "Try adjusting your search." : "Products will appear here when they become available."}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {data.items.map((p) => (
              <div key={p.id} className="card overflow-hidden flex flex-col">
                <div className="aspect-square bg-subtle-strong overflow-hidden">
                  <img
                    src={p.image_url ? entityImageUrl(p.image_url) : getPlaceholder()}
                    alt={p.name}
                    onError={onImageError}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="p-4 flex flex-col gap-1.5 flex-1">
                  <p className="text-xs text-faint uppercase tracking-wide">{p.category_name || "Uncategorized"}</p>
                  <h3 className="font-semibold text-ink leading-snug">{p.name}</h3>
                  {p.sku && <p className="text-xs text-faint">SKU: {p.sku}</p>}
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-lg font-bold text-ink">{formatCurrency(p.price, currencySymbol)}</span>
                    <span className={`badge ${p.in_stock ? "badge-success" : "badge-neutral"}`}>{p.in_stock ? "In stock" : "Out of stock"}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <Pagination
            page={page}
            totalPages={data?.pages || 1}
            onPageChange={setPage}
            pageSize={pageSize}
            onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
          />
        </>
      )}
    </div>
  );
}