import Modal from "./Modal";
import type { Category } from "../types";

interface Props {
  category: Category;
  onClose: () => void;
}

export default function CategoryDetail({ category, onClose }: Props) {
  return (
    <Modal open onClose={onClose} title={category.name}>
      <div className="space-y-4 text-sm">
        <div>
          <span className="text-muted">Description:</span>
          <p className="font-medium mt-1">{category.description || "—"}</p>
        </div>
        <div>
          <span className="text-muted">Created:</span>
          <p className="font-medium mt-1">{new Date(category.created_at).toLocaleDateString()}</p>
        </div>
      </div>
    </Modal>
  );
}
