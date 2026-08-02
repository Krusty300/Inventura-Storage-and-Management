import Modal from "./Modal";
import { PackagePlus } from "lucide-react";
import type { Product } from "../types";
import { parseLocalDate } from "../utils/date";
import { formatCurrency } from "../utils/currency";
import { useSettings } from "../hooks/useSettings";
import { hasVariants } from "../utils/variants";

interface Props {
  product: Product;
  onClose: () => void;
  onAddVariant?: (product: Product) => void;
}

export default function ProductDetail({ product, onClose, onAddVariant }: Props) {
  const { data: settings } = useSettings();
  const currencySymbol = settings?.currency_symbol || "$";
  const totalQty = hasVariants(product) ? product.total_quantity : product.quantity;
  const qty = hasVariants(product) ? product.total_quantity : product.quantity;

  return (
    <Modal open onClose={onClose} title={product.display_name} wide>
      <div className="space-y-4">
        {product.image_url && (
          <div className="flex justify-center">
            <img src={product.image_url} alt={product.display_name} className="w-48 h-48 rounded-lg object-cover border" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">SKU:</span>
            <p className="font-medium">{product.sku}</p>
          </div>
          <div>
            <span className="text-gray-500">Barcode:</span>
            <p className="font-medium">{product.barcode || "—"}</p>
          </div>
          <div>
            <span className="text-gray-500">Category:</span>
            <p className="font-medium">{product.category_name || "—"}</p>
          </div>
          <div>
            <span className="text-gray-500">Supplier:</span>
            <p className="font-medium">{product.supplier_name || "—"}</p>
          </div>
          <div>
            <span className="text-gray-500">Unit Price:</span>
            <p className="font-medium">{formatCurrency(product.unit_price, currencySymbol)}</p>
          </div>
          <div>
            <span className="text-gray-500">Cost Price:</span>
            <p className="font-medium">{formatCurrency(product.cost_price, currencySymbol)}</p>
          </div>
          <div>
            <span className="text-gray-500">{hasVariants(product) ? "Total Quantity:" : "Quantity:"}</span>
            <p className={`font-medium ${qty <= product.reorder_level ? "text-red-600" : ""}`}>{totalQty}</p>
          </div>
          <div>
            <span className="text-gray-500">Reorder Level:</span>
            <p className="font-medium">{product.reorder_level}</p>
          </div>
          <div>
            <span className="text-gray-500">Location:</span>
            <p className="font-medium">{product.location || "—"}</p>
          </div>
          <div>
            <span className="text-gray-500">Batch Number:</span>
            <p className="font-medium">{product.batch_number || "—"}</p>
          </div>
          <div>
            <span className="text-gray-500">Expiry Date:</span>
            <p className="font-medium">{product.expiry_date ? parseLocalDate(product.expiry_date).toLocaleDateString() : "—"}</p>
          </div>
          <div>
            <span className="text-gray-500">Status:</span>
            <p className="font-medium">{product.is_active ? "Active" : "Inactive"}</p>
          </div>
          {product.is_serialized && (
            <div>
              <span className="text-gray-500">Tracking:</span>
              <p className="font-medium"><span className="badge bg-indigo-50 text-indigo-700 border border-indigo-200">Serialized</span></p>
            </div>
          )}
        </div>

        {!product.is_variant && onAddVariant && (
          <div>
            <button onClick={() => onAddVariant(product)} className="btn-secondary w-full inline-flex items-center justify-center gap-2">
              <PackagePlus size={16} /> Add Variant
            </button>
          </div>
        )}

        {product.is_variant && (
          <div>
            <span className="text-sm text-gray-500">Variant of:</span>
            <p className="text-sm font-medium mt-1">{product.name}</p>
          </div>
        )}

        {product.is_variant && product.attributes && Object.keys(product.attributes).length > 0 && (
          <div>
            <span className="text-sm text-gray-500">Attributes:</span>
            <div className="flex flex-wrap gap-2 mt-1">
              {Object.entries(product.attributes).map(([k, v]) => (
                <span key={k} className="badge bg-gray-100 text-gray-700 border border-gray-200">{k}: {v}</span>
              ))}
            </div>
          </div>
        )}

        {hasVariants(product) && (
          <div>
            <span className="text-sm text-gray-500">Variants ({product.variants.length}):</span>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm border rounded-lg">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-3 py-2 font-medium text-gray-600">SKU</th>
                    <th className="px-3 py-2 font-medium text-gray-600">Attributes</th>
                    <th className="px-3 py-2 font-medium text-gray-600">Price</th>
                    <th className="px-3 py-2 font-medium text-gray-600">Qty</th>
                    <th className="px-3 py-2 font-medium text-gray-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {product.variants.map((v) => (
                    <tr key={v.id}>
                      <td className="px-3 py-2 font-medium">{v.sku}</td>
                      <td className="px-3 py-2 text-gray-600">{v.variant_label || "—"}</td>
                      <td className="px-3 py-2">{formatCurrency(v.unit_price, currencySymbol)}</td>
                      <td className="px-3 py-2"><span className={v.quantity <= v.reorder_level ? "text-red-600 font-medium" : ""}>{v.quantity}</span></td>
                      <td className="px-3 py-2"><span className={`badge ${v.is_active ? "badge-success" : "badge-danger"}`}>{v.is_active ? "Active" : "Inactive"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {product.description && (
          <div>
            <span className="text-sm text-gray-500">Description:</span>
            <p className="text-sm mt-1">{product.description}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
