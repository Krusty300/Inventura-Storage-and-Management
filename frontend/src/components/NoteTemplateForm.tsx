import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import type { NoteTemplate } from "../types";
import SlideOver from "./SlideOver";
import { useToast } from "../context/ToastContext";
import { errorMessage } from "../utils/errors";

interface Props {
  template?: NoteTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}

const EMPTY_FORM = { name: "", category: "note", priority: "normal", body: "", recurrence: "none" };

export default function NoteTemplateForm({ template, onClose, onSaved }: Props) {
  const [form, setForm] = useState(
    template
      ? { name: template.name, category: template.category, priority: template.priority, body: template.body, recurrence: template.recurrence }
      : EMPTY_FORM
  );
  const queryClient = useQueryClient();
  const { addToast } = useToast();

  const isEdit = !!template;

  const mutation = useMutation({
    mutationFn: (data: typeof form) =>
      isEdit
        ? api.put(`/notes/templates/${template.id}`, data)
        : api.post("/notes/templates", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["note-templates"] });
      addToast(isEdit ? "Template updated" : "Template created", "success");
      onSaved();
    },
    onError: (err) => addToast(errorMessage(err, "Failed to save template"), "error"),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    mutation.mutate(form);
  };

  return (
    <SlideOver open onClose={onClose} title={isEdit ? "Edit Template" : "New Template"} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-muted mb-1">Name *</label>
          <input className="input w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Weekly stock check" autoFocus />
        </div>
        <div>
          <label className="block text-sm font-medium text-muted mb-1">Body</label>
          <textarea className="input w-full h-28 resize-y" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Default content when using this template..." />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-muted mb-1">Category</label>
            <select className="select w-full" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="note">Note</option>
              <option value="reminder">Reminder</option>
              <option value="todo">Todo</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-muted mb-1">Priority</label>
            <select className="select w-full" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-muted mb-1">Recurrence</label>
          <select className="select w-full" value={form.recurrence} onChange={(e) => setForm({ ...form, recurrence: e.target.value })}>
            <option value="none">None</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" className="btn-primary" disabled={!form.name.trim() || mutation.isPending}>
            {mutation.isPending ? "Saving..." : isEdit ? "Save Changes" : "Create Template"}
          </button>
        </div>
      </form>
    </SlideOver>
  );
}
