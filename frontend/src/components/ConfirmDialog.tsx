import type { ReactNode } from "react";
import Modal from "./Modal";

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmClass?: string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

export default function ConfirmDialog({ open, title, message, confirmLabel = "Delete", confirmClass = "btn-danger", onConfirm, onCancel, children }: Props) {
  return (
    <Modal open={open} onClose={onCancel} title={title} breadcrumb="">
      <div className="space-y-4">
        <p className="text-sm text-muted whitespace-pre-line">{message}</p>
        {children}
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="btn-secondary text-sm px-3 py-1.5">Cancel</button>
          <button onClick={onConfirm} className={`text-sm px-3 py-1.5 ${confirmClass}`}>{confirmLabel}</button>
        </div>
      </div>
    </Modal>
  );
}
