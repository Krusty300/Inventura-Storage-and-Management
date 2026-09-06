import { useState } from "react";
import { CheckSquare, Square } from "lucide-react";
import api from "../api/client";
import type { User } from "../types";
import Modal from "./Modal";
import { useToast } from "../context/ToastContext";
import { permissionGroups } from "../utils/permissions";
import { errorMessage } from "../utils/errors";

interface Props {
  user: User;
  onClose: () => void;
  onSaved: () => void;
}

export default function PermissionsEditor({ user, onClose, onSaved }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set(user.permissions ?? []));
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  const groups = permissionGroups();

  const toggle = (perm: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) next.delete(perm);
      else next.add(perm);
      return next;
    });
  };

  const setGroup = (permissions: string[], checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const perm of permissions) {
        if (checked) next.add(perm);
        else next.delete(perm);
      }
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/users/${user.id}`, { permissions: [...selected] });
      addToast(`Permissions updated for ${user.username}`, "success");
      onSaved();
    } catch (err: unknown) {
      addToast(errorMessage(err, "Failed to update permissions"), "error");
    }
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title={`Permissions — ${user.username}`} xwide ariaLabel="Edit permissions">
      <div className="space-y-4">
        <p className="text-sm text-muted">
          These permissions <strong>replace</strong> the worker role's default set. Leave everything unchecked to
          fall back to the role defaults. Admins always hold every permission.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[60vh] overflow-auto pr-1">
          {groups.map((group) => {
            const allChecked = group.permissions.every((p) => selected.has(p));
            return (
              <fieldset key={group.resource} className="border border-border rounded-lg p-3">
                <legend className="px-1 text-sm font-semibold text-ink">{group.label}</legend>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-faint">
                    {group.permissions.filter((p) => selected.has(p)).length}/{group.permissions.length} selected
                  </span>
                  <button
                    type="button"
                    className="text-xs text-primary dark:text-primary hover:underline inline-flex items-center gap-1"
                    onClick={() => setGroup(group.permissions, !allChecked)}
                  >
                    {allChecked ? <Square size={12} /> : <CheckSquare size={12} />}
                    {allChecked ? "Clear" : "Select all"}
                  </button>
                </div>
                <div className="space-y-1.5" role="group" aria-label={group.label}>
                  {group.permissions.map((perm) => (
                    <label key={perm} className="flex items-center gap-2 text-sm text-muted cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selected.has(perm)}
                        onChange={() => toggle(perm)}
                        className="accent-primary"
                        aria-label={perm}
                      />
                      {perm}
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </div>
        <div className="flex justify-end gap-3 pt-2 border-t border-border">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="button" onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? "Saving..." : "Save Permissions"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
