import { useEffect, useState } from "react";
import api from "../api/client";
import type { Category } from "../types";
import { useToast } from "../context/ToastContext";
import Modal from "./Modal";

interface Props {
  category: Category | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function CategoryForm({ category, onClose, onSaved }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  useEffect(() => {
    if (category) {
      setName(category.name);
      setDescription(category.description);
    }
  }, [category]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (category) {
        await api.put(`/categories/${category.id}`, { name, description });
        addToast("Category updated", "success");
      } else {
        await api.post("/categories", { name, description });
        addToast("Category created", "success");
      }
      onSaved();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Error saving category", "error");
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title={category ? "Edit Category" : "Add Category"}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Name *</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Description</label>
          <textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? "Saving..." : category ? "Update" : "Create"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
