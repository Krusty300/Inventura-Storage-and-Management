import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search, Pin, PinOff, CheckCircle2, Circle, Trash2, Edit3, Clock,
  AlertTriangle, Tag as TagIcon, Link as LinkIcon, StickyNote, ListTodo, Bell,
  LayoutGrid, List, Columns3, X as XIcon, User as UserIcon, Image as ImageIcon,
  Copy, Archive, ArchiveRestore, BookTemplate, ChevronUp, ChevronDown,
} from "lucide-react";
import Markdown from "react-markdown";
import api from "../api/client";
import type { Note, NoteTag, NoteTemplate, User, PaginatedResponse } from "../types";
import Modal from "../components/Modal";
import SlideOver from "../components/SlideOver";
import NoteTemplateForm from "../components/NoteTemplateForm";
import Pagination from "../components/Pagination";
import Skeleton from "../components/Skeleton";
import ErrorState from "../components/ErrorState";
import EmptyState from "../components/EmptyState";
import ConfirmDialog from "../components/ConfirmDialog";
import EntitySearchInput from "../components/EntitySearchInput";
import { LINKABLE_ENTITIES, getEntityTypeLabel, getEntityTypeIcon } from "../utils/linkableEntities";
import { useDebounce } from "../hooks/useDebounce";
import { usePageSize } from "../hooks/usePageSize";
import { useBulkSelection } from "../hooks/useBulkSelection";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useDateFormat } from "../hooks/useDateFormat";
import { daysUntil, parseLocalDate } from "../utils/date";
import { errorMessage } from "../utils/errors";

type NoteForm = {
  title: string;
  body: string;
  category: string;
  priority: string;
  is_pinned: boolean;
  due_date: string;
  recurrence: string;
  assigned_to_id: number | null;
  tag_ids: number[];
  image_url?: string;
  links: { entity_type: string; entity_id: number; entity_label: string }[];
};

type ViewMode = "list" | "card" | "kanban";

const EMPTY_FORM: NoteForm = { title: "", body: "", category: "note", priority: "normal", is_pinned: false, due_date: "", recurrence: "none", assigned_to_id: null, tag_ids: [], links: [] };

const CATEGORY_ICONS: Record<string, typeof StickyNote> = { note: StickyNote, reminder: Bell, todo: ListTodo };
const PRIORITY_COLORS: Record<string, string> = { low: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400", normal: "bg-gray-100 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400", high: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400", urgent: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400 ring-1 ring-red-300 dark:ring-red-500/40" };
const CATEGORY_COLORS: Record<string, string> = { note: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400", reminder: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400", todo: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400" };
const KANBAN_COLUMNS: { key: string; label: string; icon: typeof StickyNote }[] = [
  { key: "note", label: "Notes", icon: StickyNote },
  { key: "reminder", label: "Reminders", icon: Bell },
  { key: "todo", label: "Todos", icon: ListTodo },
];

function priorityBadge(p: string) {
  const cls = PRIORITY_COLORS[p] || PRIORITY_COLORS.normal;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{p}</span>;
}

function categoryBadge(c: string) {
  const cls = CATEGORY_COLORS[c] || CATEGORY_COLORS.note;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{c}</span>;
}

function isOverdue(dueDate: string | null, isCompleted: boolean) {
  if (!dueDate || isCompleted) return false;
  return parseLocalDate(dueDate) < new Date();
}

function isDueSoon(dueDate: string | null, isCompleted: boolean) {
  if (!dueDate || isCompleted) return false;
  const days = daysUntil(dueDate);
  return days >= 0 && days <= 2;
}

export default function Notes() {
  const formatDate = useDateFormat();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("");
  const [completedFilter, setCompletedFilter] = useState<"all" | "active" | "completed" | "archived">("all");
  const [sortField, setSortField] = useState("created_at");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [tagFilter, setTagFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [dueDateFrom, setDueDateFrom] = useState("");
  const [dueDateTo, setDueDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [showForm, setShowForm] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [viewingNote, setViewingNote] = useState<Note | null>(null);
  const [form, setForm] = useState<NoteForm>(EMPTY_FORM);
  const [showTagManager, setShowTagManager] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#6366f1");
  const [confirmDelete, setConfirmDelete] = useState<Note | null>(null);
  const [draggedNote, setDraggedNote] = useState<Note | null>(null);
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [confirmTagDelete, setConfirmTagDelete] = useState<NoteTag | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [templateEditTarget, setTemplateEditTarget] = useState<NoteTemplate | null>(null);
  const [linkEntityFilter, setLinkEntityFilter] = useState("product");
  const imagePreviewUrl = useMemo(() => editImageFile ? URL.createObjectURL(editImageFile) : null, [editImageFile]);
  useEffect(() => { return () => { if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl); }; }, [imagePreviewUrl]);

  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { addToast } = useToast();
  const debouncedSearch = useDebounce(search, 300);
  const { pageSize, setPageSize } = usePageSize();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasFilters = !!debouncedSearch || !!category || !!priority || completedFilter !== "all" || !!tagFilter || !!assigneeFilter || !!dueDateFrom || !!dueDateTo;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["notes", debouncedSearch, category, priority, completedFilter, sortField, sortOrder, tagFilter, assigneeFilter, dueDateFrom, dueDateTo, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string | number | boolean> = { skip: (page - 1) * pageSize, limit: pageSize, sort: sortField, order: sortOrder };
      if (debouncedSearch) params.search = debouncedSearch;
      if (category) params.category = category;
      if (priority) params.priority = priority;
      if (tagFilter) params.tag_id = tagFilter;
      if (assigneeFilter) params.assigned_to = assigneeFilter;
      if (dueDateFrom) params.due_after = dueDateFrom;
      if (dueDateTo) params.due_before = dueDateTo;
      if (completedFilter === "archived") params.is_archived = true;
      else if (completedFilter === "active") { params.is_completed = false; params.is_archived = false; }
      else if (completedFilter === "completed") { params.is_completed = true; params.is_archived = false; }
      else params.is_archived = false;
      const { data } = await api.get("/notes", { params });
      return data as PaginatedResponse<Note>;
    },
  });

  const { data: tags = [] } = useQuery({
    queryKey: ["note-tags"],
    queryFn: async () => { const { data } = await api.get("/notes/tags"); return data as NoteTag[]; },
  });

  const { data: users = [] } = useQuery({
    queryKey: ["assignable-users"],
    queryFn: async () => { const { data } = await api.get("/notes/assignable-users"); return data as User[]; },
  });

  const { data: templates = [] } = useQuery({
    queryKey: ["note-templates"],
    queryFn: async () => { const { data } = await api.get("/notes/templates"); return data as NoteTemplate[]; },
  });

  const notes = data?.items || [];
  const pinnedNotes = notes.filter((n) => n.is_pinned && !n.is_completed);
  const unpinnedNotes = notes.filter((n) => !n.is_pinned && !n.is_completed);
  const completedNotes = notes.filter((n) => n.is_completed);

  const { data: kanbanData, isLoading: kanbanLoading } = useQuery({
    queryKey: ["notes-kanban"],
    queryFn: async () => {
      const { data } = await api.get("/notes", { params: { skip: 0, limit: 500, is_completed: false, is_archived: false } });
      return (data.items || []) as Note[];
    },
    enabled: viewMode === "kanban",
  });
  const kanbanNotes = kanbanData ?? (viewMode === "kanban" ? [] : notes);

  const { selectedIds, toggleSelect, clearSelection } = useBulkSelection(notes);

  const createMutation = useMutation({
    mutationFn: (payload: NoteForm) => {
      const body: Record<string, unknown> = { title: payload.title, body: payload.body, category: payload.category, priority: payload.priority, is_pinned: payload.is_pinned, recurrence: payload.recurrence, tag_ids: payload.tag_ids, links: payload.links };
      if (payload.due_date) body.due_date = payload.due_date;
      if (payload.assigned_to_id) body.assigned_to_id = payload.assigned_to_id;
      return api.post("/notes", body);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["notes"] }); queryClient.invalidateQueries({ queryKey: ["notes-kanban"] }); setShowForm(false); setForm(EMPTY_FORM); addToast("Note created", "success"); },
    onError: (err) => addToast(errorMessage(err, "Failed to create note"), "error"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<NoteForm> }) => {
      const body: Record<string, unknown> = {};
      if (payload.title !== undefined) body.title = payload.title;
      if (payload.body !== undefined) body.body = payload.body;
      if (payload.category !== undefined) body.category = payload.category;
      if (payload.priority !== undefined) body.priority = payload.priority;
      if (payload.is_pinned !== undefined) body.is_pinned = payload.is_pinned;
      if (payload.recurrence !== undefined) body.recurrence = payload.recurrence;
      if (payload.tag_ids !== undefined) body.tag_ids = payload.tag_ids;
      if ("due_date" in payload) body.due_date = payload.due_date || null;
      if ("assigned_to_id" in payload) body.assigned_to_id = payload.assigned_to_id;
      if ("image_url" in payload) body.image_url = payload.image_url;
      return api.put(`/notes/${id}`, body);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["notes"] }); queryClient.invalidateQueries({ queryKey: ["notes-kanban"] }); setShowForm(false); setEditingNote(null); setForm(EMPTY_FORM); addToast("Note updated", "success"); },
    onError: (err) => addToast(errorMessage(err, "Failed to update note"), "error"),
  });

  const completeMutation = useMutation({
    mutationFn: (id: number) => api.patch(`/notes/${id}/complete`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["notes"] }); queryClient.invalidateQueries({ queryKey: ["notes-kanban"] }); },
    onError: (err) => addToast(errorMessage(err, "Failed to update note"), "error"),
  });

  const pinMutation = useMutation({
    mutationFn: (id: number) => api.patch(`/notes/${id}/pin`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["notes"] }); queryClient.invalidateQueries({ queryKey: ["notes-kanban"] }); },
    onError: (err) => addToast(errorMessage(err, "Failed to update note"), "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/notes/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["notes"] }); queryClient.invalidateQueries({ queryKey: ["notes-kanban"] }); setConfirmDelete(null); setViewingNote(null); addToast("Note deleted", "success"); },
    onError: (err) => addToast(errorMessage(err, "Failed to delete note"), "error"),
  });

  const assignMutation = useMutation({
    mutationFn: ({ noteId, userId }: { noteId: number; userId: number | null }) => api.post(`/notes/${noteId}/assign`, { assigned_to_id: userId }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["notes"] }); queryClient.invalidateQueries({ queryKey: ["notes-kanban"] }); addToast("Note reassigned", "success"); },
    onError: (err) => addToast(errorMessage(err, "Failed to assign note"), "error"),
  });



  const createTagMutation = useMutation({
    mutationFn: () => api.post("/notes/tags", { name: newTagName, color: newTagColor }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["note-tags"] }); setNewTagName(""); setNewTagColor("#6366f1"); addToast("Tag created", "success"); },
    onError: (err) => addToast(errorMessage(err, "Failed to create tag"), "error"),
  });

  const deleteTagMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/notes/tags/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["note-tags"] }),
    onError: (err) => addToast(errorMessage(err, "Failed to delete tag"), "error"),
  });

  const uploadImageMutation = useMutation({
    mutationFn: ({ noteId, file }: { noteId: number; file: File }) => {
      const fd = new FormData();
      fd.append("file", file);
      return api.post(`/notes/${noteId}/upload-image`, fd);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["notes"] }); queryClient.invalidateQueries({ queryKey: ["notes-kanban"] }); setEditImageFile(null); addToast("Image uploaded", "success"); },
    onError: (err) => addToast(errorMessage(err, "Failed to upload image"), "error"),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: number) => api.patch(`/notes/${id}/archive`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["notes"] }); queryClient.invalidateQueries({ queryKey: ["notes-kanban"] }); addToast("Note archived", "success"); },
    onError: (err) => addToast(errorMessage(err, "Failed to archive note"), "error"),
  });

  const bulkArchiveMutation = useMutation({
    mutationFn: ({ ids, archive }: { ids: number[]; archive: boolean }) => api.post("/notes/bulk-archive", { ids, archive }),
    onSuccess: (_, vars) => { queryClient.invalidateQueries({ queryKey: ["notes"] }); queryClient.invalidateQueries({ queryKey: ["notes-kanban"] }); clearSelection(); addToast(`${vars.ids.length} note${vars.ids.length === 1 ? "" : "s"} ${vars.archive ? "archived" : "unarchived"}`, "success"); },
    onError: (err) => addToast(errorMessage(err, "Failed to update notes"), "error"),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => api.post("/notes/bulk-delete", { ids, archive: false }),
    onSuccess: (_, ids) => { queryClient.invalidateQueries({ queryKey: ["notes"] }); queryClient.invalidateQueries({ queryKey: ["notes-kanban"] }); clearSelection(); addToast(`${ids.length} note${ids.length === 1 ? "" : "s"} deleted`, "success"); },
    onError: (err) => addToast(errorMessage(err, "Failed to delete notes"), "error"),
  });

  const bulkCompleteMutation = useMutation({
    mutationFn: ({ ids, is_completed }: { ids: number[]; is_completed: boolean }) => api.post("/notes/bulk-update", { ids, is_completed }),
    onSuccess: (_, vars) => { queryClient.invalidateQueries({ queryKey: ["notes"] }); queryClient.invalidateQueries({ queryKey: ["notes-kanban"] }); clearSelection(); addToast(`${vars.ids.length} note${vars.ids.length === 1 ? "" : "s"} ${vars.is_completed ? "completed" : "uncompleted"}`, "success"); },
    onError: (err) => addToast(errorMessage(err, "Failed to update notes"), "error"),
  });

  const bulkPriorityMutation = useMutation({
    mutationFn: ({ ids, priority }: { ids: number[]; priority: string }) => api.post("/notes/bulk-update", { ids, priority }),
    onSuccess: (_, vars) => { queryClient.invalidateQueries({ queryKey: ["notes"] }); queryClient.invalidateQueries({ queryKey: ["notes-kanban"] }); clearSelection(); addToast(`${vars.ids.length} note${vars.ids.length === 1 ? "" : "s"} priority updated`, "success"); },
    onError: (err) => addToast(errorMessage(err, "Failed to update notes"), "error"),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: number) => api.post(`/notes/${id}/duplicate`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["notes"] }); queryClient.invalidateQueries({ queryKey: ["notes-kanban"] }); addToast("Note duplicated", "success"); },
    onError: (err) => addToast(errorMessage(err, "Failed to duplicate note"), "error"),
  });

  const createTemplateMutation = useMutation({
    mutationFn: (note: Note) => api.post("/notes/templates", { name: note.title, category: note.category, priority: note.priority, body: note.body, recurrence: note.recurrence }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["note-templates"] }); addToast("Template saved", "success"); },
    onError: (err) => addToast(errorMessage(err, "Failed to save template"), "error"),
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/notes/templates/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["note-templates"] }),
    onError: (err) => addToast(errorMessage(err, "Failed to delete template"), "error"),
  });

  const addLinkMutation = useMutation({
    mutationFn: ({ noteId, entity_type, entity_id, entity_label }: { noteId: number; entity_type: string; entity_id: number; entity_label: string }) => api.post(`/notes/${noteId}/links`, { entity_type, entity_id, entity_label }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["notes"] }); queryClient.invalidateQueries({ queryKey: ["notes-kanban"] }); addToast("Link added", "success"); },
    onError: (err) => addToast(errorMessage(err, "Failed to add link"), "error"),
  });

  const removeLinkMutation = useMutation({
    mutationFn: ({ noteId, linkId }: { noteId: number; linkId: number }) => api.delete(`/notes/${noteId}/links/${linkId}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["notes"] }); queryClient.invalidateQueries({ queryKey: ["notes-kanban"] }); addToast("Link removed", "success"); },
    onError: (err) => addToast(errorMessage(err, "Failed to remove link"), "error"),
  });

  const openEdit = useCallback((note: Note) => {
    setEditingNote(note);
    setForm({ title: note.title, body: note.body, category: note.category, priority: note.priority, is_pinned: note.is_pinned, due_date: note.due_date ? note.due_date.slice(0, 16) : "", recurrence: note.recurrence, assigned_to_id: note.assigned_to_id, tag_ids: note.tags.map((t) => t.id), links: note.links.map((l) => ({ entity_type: l.entity_type, entity_id: l.entity_id, entity_label: l.entity_label })) });
    setEditImageFile(null);
    setShowForm(true);
  }, []);

  const openCreate = useCallback(() => {
    setEditingNote(null);
    setForm(EMPTY_FORM);
    setEditImageFile(null);
    setShowForm(true);
  }, []);

  const openDetail = useCallback((note: Note) => {
    setViewingNote(note);
  }, []);

  useEffect(() => {
    if (!viewingNote) return;
    const fresh = notes.find((n) => n.id === viewingNote.id);
    if (fresh && fresh !== viewingNote) setViewingNote(fresh);
  }, [notes, viewingNote]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "n") { e.preventDefault(); openCreate(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "d") { e.preventDefault(); if (viewingNote) { duplicateMutation.mutate(viewingNote.id); } }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openCreate, viewingNote]);

  const handleFormSubmit = async () => {
    if (!form.title.trim()) { addToast("Title is required", "error"); return; }
    if (editingNote) {
      updateMutation.mutate({ id: editingNote.id, payload: form }, {
        onSuccess: () => {
          if (editImageFile) {
            uploadImageMutation.mutate({ noteId: editingNote.id, file: editImageFile });
          }
        },
      });
    } else {
      try {
        const { data } = await createMutation.mutateAsync(form);
        if (editImageFile && data?.id) {
          uploadImageMutation.mutate({ noteId: data.id, file: editImageFile });
        }
      } catch {
        // error toast already shown by onError
      }
    }
  };

  const handleDragStart = (e: React.DragEvent, note: Note) => {
    setDraggedNote(note);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(note.id));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, targetCategory: string) => {
    e.preventDefault();
    if (draggedNote && draggedNote.category !== targetCategory) {
      updateMutation.mutate({ id: draggedNote.id, payload: { category: targetCategory } });
    }
    setDraggedNote(null);
  };

  const tabClasses = (active: boolean) => `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${active ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400" : "text-muted hover:text-ink hover:bg-subtle"}`;
  const viewBtnClass = (active: boolean) => `p-1.5 rounded transition-colors ${active ? "bg-surface text-indigo-600 dark:text-indigo-400 shadow-sm" : "text-muted hover:text-ink"}`;

  const renderNoteActions = (note: Note) => (
    <div className="flex items-center gap-1 shrink-0">
      <button onClick={(e) => { e.stopPropagation(); pinMutation.mutate(note.id); }} className="p-1.5 text-muted hover:text-ink rounded transition-colors" aria-label={note.is_pinned ? "Unpin note" : "Pin note"} title={note.is_pinned ? "Unpin" : "Pin"}>
        {note.is_pinned ? <PinOff size={16} /> : <Pin size={16} />}
      </button>
      {can("notes.update") && (
        <button onClick={(e) => { e.stopPropagation(); openEdit(note); }} className="p-1.5 text-muted hover:text-ink rounded transition-colors" aria-label="Edit note" title="Edit"><Edit3 size={16} /></button>
      )}
      {can("notes.delete") && (
        <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(note); }} className="p-1.5 text-muted hover:text-red-500 rounded transition-colors" aria-label="Delete note" title="Delete"><Trash2 size={16} /></button>
      )}
    </div>
  );

  const renderNoteRow = (note: Note) => {
    const CatIcon = CATEGORY_ICONS[note.category] || StickyNote;
    const overdue = isOverdue(note.due_date, note.is_completed);
    const dueSoon = isDueSoon(note.due_date, note.is_completed);
    return (
      <div key={note.id} className={`flex items-start gap-3 p-4 border-b border-border hover:bg-subtle/60 hover:border-indigo-100 dark:hover:border-indigo-500/20 transition-[background-color,border-color,opacity] duration-150 ${note.is_completed ? "opacity-60 border-l-2 border-l-emerald-400 dark:border-l-emerald-500" : ""} ${note.is_pinned && !note.is_completed ? "border-l-2 border-l-indigo-400 dark:border-l-indigo-500" : ""}`}>
        <div className="flex items-center gap-2 mt-0.5">
          <input type="checkbox" className="rounded border-border-strong" checked={selectedIds.has(note.id)} onChange={() => toggleSelect(note.id)} aria-label={`Select note: ${note.title}`} />
          <button onClick={() => completeMutation.mutate(note.id)} className="shrink-0 text-muted hover:text-emerald-500 transition-colors" aria-label={note.is_completed ? "Mark incomplete" : "Mark complete"}>
            {note.is_completed ? <CheckCircle2 size={20} className="text-emerald-500" /> : <Circle size={20} />}
          </button>
        </div>
        {note.image_url && (
          <img src={note.image_url} alt="" className="w-10 h-10 rounded object-cover shrink-0" loading="lazy" />
        )}
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openDetail(note)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(note); } }} aria-label={`View note: ${note.title}`}>
          <div className="flex items-center gap-2 flex-wrap">
            <CatIcon size={14} className="text-muted shrink-0" />
            <span className={`font-medium text-ink ${note.is_completed ? "line-through" : ""}`}>{note.title}</span>
            {categoryBadge(note.category)}
            {note.priority !== "normal" && priorityBadge(note.priority)}
            {overdue && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400"><AlertTriangle size={12} />Overdue</span>}
            {dueSoon && !overdue && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400"><Clock size={12} />Due soon</span>}
          </div>
          {note.body && <p className="text-sm text-muted mt-1 line-clamp-2">{note.body}</p>}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            {note.due_date && <span className="text-xs text-muted">Due: {formatDate(note.due_date)}</span>}
            {note.tags.map((t) => (
              <span key={t.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: t.color + "20", color: t.color }}>{t.name}</span>
            ))}
            {note.links.length > 0 && <span className="inline-flex items-center gap-1 text-xs text-muted"><LinkIcon size={12} />{note.links.length} linked</span>}
            {note.assigned_to_name && <span className="text-xs text-muted">@{note.assigned_to_name}</span>}
          </div>
        </div>
        {renderNoteActions(note)}
      </div>
    );
  };

  const renderNoteCard = (note: Note) => {
    const CatIcon = CATEGORY_ICONS[note.category] || StickyNote;
    const overdue = isOverdue(note.due_date, note.is_completed);
    const dueSoon = isDueSoon(note.due_date, note.is_completed);
    return (
      <div key={note.id} className={`card p-4 cursor-pointer hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-500/30 transition-[box-shadow,transform,opacity] duration-150 ${note.is_completed ? "opacity-60 border-l-2 border-l-emerald-400 dark:border-l-emerald-500" : ""} ${draggedNote?.id === note.id ? "opacity-50 scale-[0.98]" : ""}`} draggable={viewMode === "kanban"} onDragStart={(e) => handleDragStart(e, note)} onClick={() => openDetail(note)}>
        {note.image_url && (
          <div className="mb-3 -mx-4 -mt-4 overflow-hidden rounded-t-lg">
            <img src={note.image_url} alt={note.title} className="w-full h-32 object-cover" loading="lazy" />
          </div>
        )}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <CatIcon size={14} className="text-muted shrink-0" />
            <span className={`font-medium text-ink text-sm truncate ${note.is_completed ? "line-through" : ""}`}>{note.title}</span>
          </div>
          <button onClick={(e) => { e.stopPropagation(); completeMutation.mutate(note.id); }} className="shrink-0 text-muted hover:text-emerald-500 transition-colors" aria-label={note.is_completed ? "Mark incomplete" : "Mark complete"}>
            {note.is_completed ? <CheckCircle2 size={18} className="text-emerald-500" /> : <Circle size={18} />}
          </button>
        </div>
        {note.body && <p className="text-xs text-muted line-clamp-2 mb-2">{note.body}</p>}
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          {categoryBadge(note.category)}
          {note.priority !== "normal" && priorityBadge(note.priority)}
          {overdue && <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400"><AlertTriangle size={10} />Overdue</span>}
          {dueSoon && !overdue && <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400"><Clock size={10} />Due soon</span>}
        </div>
        {note.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {note.tags.map((t) => (
              <span key={t.id} className="px-1.5 py-0.5 rounded-full text-[10px] font-medium" style={{ backgroundColor: t.color + "20", color: t.color }}>{t.name}</span>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between text-[11px] text-muted pt-2 border-t border-border">
          <div className="flex items-center gap-2">
            {note.due_date && <span>Due: {formatDate(note.due_date)}</span>}
            {note.assigned_to_name && <span className="flex items-center gap-0.5"><UserIcon size={10} />@{note.assigned_to_name}</span>}
          </div>
          {renderNoteActions(note)}
        </div>
      </div>
    );
  };

  const renderKanbanBoard = () => {
    const allActive = kanbanNotes;
    return (
      <div className="flex gap-4 overflow-x-auto pb-4 min-h-[400px]">
        {KANBAN_COLUMNS.map((col) => {
          const colNotes = allActive.filter((n) => n.category === col.key);
          const ColIcon = col.icon;
          return (
            <div key={col.key} className="flex-1 min-w-[280px]" onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, col.key)}>
              <div className="flex items-center gap-2 px-3 py-2.5 mb-3 rounded-lg bg-subtle border border-border">
                <ColIcon size={14} className="text-muted" />
                <span className="text-sm font-semibold text-ink">{col.label}</span>
                <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-border text-xs font-medium text-muted">{colNotes.length}</span>
              </div>
              <div className="p-2 rounded-lg border-2 border-dashed border-transparent hover:border-border transition-colors">
                {colNotes.length === 0 ? (
                  <div className="border-2 border-dashed border-border rounded-lg p-6 text-center text-xs text-faint bg-subtle/30">Drop notes here</div>
                ) : (
                  <div className="space-y-3">{colNotes.map((note) => renderNoteCard(note))}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderEmptyState = () => {
    if (hasFilters) {
      return (
        <EmptyState
          title="No matching notes"
          message="Try adjusting your search or filters to find what you're looking for."
          icon={<Search size={48} />}
          actionLabel="Clear filters"
          onAction={() => { setSearch(""); setCategory(""); setPriority(""); setCompletedFilter("all"); setTagFilter(""); setAssigneeFilter(""); setDueDateFrom(""); setDueDateTo(""); setPage(1); clearSelection(); }}
        />
      );
    }
    return (
      <EmptyState
        title="No notes yet"
        message="Create your first note to get started"
        icon={<StickyNote size={48} />}
        actionLabel={can("notes.create") ? "New Note" : undefined}
        onAction={can("notes.create") ? openCreate : undefined}
      />
    );
  };

  const renderKanbanSkeleton = () => (
    <div className="flex gap-4 overflow-x-auto pb-4 min-h-[400px]">
      {KANBAN_COLUMNS.map((col) => {
        const ColIcon = col.icon;
        return (
          <div key={col.key} className="flex-1 min-w-[280px]">
            <div className="flex items-center gap-2 px-3 py-2.5 mb-3 rounded-lg bg-subtle border border-border">
              <ColIcon size={14} className="text-muted" />
              <span className="text-sm font-semibold text-ink">{col.label}</span>
              <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-border text-xs font-medium text-muted animate-pulse">—</span>
            </div>
            <div className="space-y-3 p-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-4 w-4 rounded bg-subtle-strong animate-pulse" />
                    <div className="h-4 bg-subtle-strong rounded animate-pulse flex-1" />
                  </div>
                  <div className="h-3 bg-subtle-strong rounded animate-pulse w-3/4 mb-2" />
                  <div className="flex items-center gap-2 pt-2 border-t border-border">
                    <div className="h-3 w-16 bg-subtle-strong rounded animate-pulse" />
                    <div className="h-3 w-20 bg-subtle-strong rounded animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderContent = () => {
    if (isLoading) {
      if (viewMode === "card") {
        return <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-lg" />)}</div>;
      }
      return <div className="p-4 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>;
    }
    if (isError) {
      return <ErrorState title="Failed to load notes" message="Something went wrong while fetching notes." variant="block" onRetry={() => queryClient.invalidateQueries({ queryKey: ["notes"] })} />;
    }
    if (viewMode === "kanban") {
      if (kanbanLoading || !kanbanData) {
        return renderKanbanSkeleton();
      }
      if (kanbanNotes.length === 0) {
        return renderEmptyState();
      }
      return renderKanbanBoard();
    }
    if (notes.length === 0) {
      return renderEmptyState();
    }
    if (viewMode === "card") {
      return (
        <div className="p-4">
          {pinnedNotes.length > 0 && (
            <div className="mb-4">
              <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-3 flex items-center gap-1"><Pin size={12} />Pinned</div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{pinnedNotes.map(renderNoteCard)}</div>
            </div>
          )}
          {unpinnedNotes.length > 0 && (
            <div className="mb-4">
              {pinnedNotes.length > 0 && <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Other</div>}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{unpinnedNotes.map(renderNoteCard)}</div>
            </div>
          )}
          {completedNotes.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-3 flex items-center gap-1"><CheckCircle2 size={12} />Completed ({completedNotes.length})</div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{completedNotes.map(renderNoteCard)}</div>
            </div>
          )}
        </div>
      );
    }
    return (
      <div>
        {pinnedNotes.length > 0 && (
          <div>
            <div className="px-4 py-2 bg-subtle/50 text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1"><Pin size={12} />Pinned</div>
            {pinnedNotes.map(renderNoteRow)}
          </div>
        )}
        {unpinnedNotes.length > 0 && (
          <div>
            {pinnedNotes.length > 0 && <div className="px-4 py-2 bg-subtle/50 text-xs font-semibold text-muted uppercase tracking-wider">Other</div>}
            {unpinnedNotes.map(renderNoteRow)}
          </div>
        )}
        {completedNotes.length > 0 && (
          <div>
            <div className="px-4 py-2 bg-subtle/50 text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1"><CheckCircle2 size={12} />Completed ({completedNotes.length})</div>
            {completedNotes.map(renderNoteRow)}
          </div>
        )}
      </div>
    );
  };

  const renderDetailPanel = () => {
    if (!viewingNote) return null;
    const CatIcon = CATEGORY_ICONS[viewingNote.category] || StickyNote;
    return (
      <SlideOver open={!!viewingNote} title={viewingNote.title} onClose={() => setViewingNote(null)} wide>
        <div className="space-y-6">
          {viewingNote.image_url && (
            <div className="-mx-6 -mt-6 overflow-hidden">
              <img src={viewingNote.image_url} alt={viewingNote.title} className="w-full h-48 object-cover" loading="lazy" />
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <CatIcon size={16} className="text-muted" />
            {categoryBadge(viewingNote.category)}
            {priorityBadge(viewingNote.priority)}
            {viewingNote.is_completed && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400"><CheckCircle2 size={12} />Completed</span>}
            {isOverdue(viewingNote.due_date, viewingNote.is_completed) && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400"><AlertTriangle size={12} />Overdue</span>}
          </div>

          {viewingNote.body && <div className="prose prose-sm dark:prose-invert max-w-none text-ink leading-relaxed"><Markdown>{viewingNote.body}</Markdown></div>}

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted uppercase tracking-wider">Details</div>
              {viewingNote.due_date && <div><span className="text-muted">Due:</span> <span className="text-ink">{formatDate(viewingNote.due_date)}</span></div>}
              {viewingNote.recurrence !== "none" && <div><span className="text-muted">Recurs:</span> <span className="text-ink capitalize">{viewingNote.recurrence}</span></div>}
              <div><span className="text-muted">Created:</span> <span className="text-ink">{formatDate(viewingNote.created_at)}</span></div>
              <div><span className="text-muted">Updated:</span> <span className="text-ink">{formatDate(viewingNote.updated_at)}</span></div>
            </div>
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted uppercase tracking-wider">Assignment</div>
              <div>
                <label className="text-xs text-muted block mb-1">Assigned to</label>
                <select className="select w-full text-sm" value={viewingNote.assigned_to_id ?? ""} onChange={(e) => assignMutation.mutate({ noteId: viewingNote.id, userId: e.target.value ? Number(e.target.value) : null })} aria-label="Assign note to user">
                  <option value="">Unassigned</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
                </select>
              </div>
              <div className="text-xs text-muted">By: @{viewingNote.username}</div>
            </div>
          </div>

          {viewingNote.tags.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted uppercase tracking-wider mb-2">Tags</div>
              <div className="flex flex-wrap gap-2">
                {viewingNote.tags.map((t) => (
                  <span key={t.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: t.color + "20", color: t.color }}>{t.name}</span>
                ))}
              </div>
            </div>
          )}

          <div>
              <div className="text-xs font-medium text-muted uppercase tracking-wider mb-2">Linked entities</div>
              <div className="space-y-1">
                {viewingNote.links.map((l) => {
                  const EntityIcon = getEntityTypeIcon(l.entity_type);
                  return (
                    <div key={l.id} className="text-sm text-muted flex items-center gap-1.5 group">
                      <EntityIcon size={12} className="shrink-0" />
                      <span className="text-ink font-medium">{l.entity_label || getEntityTypeLabel(l.entity_type)}</span>
                      <span className="text-faint">#{l.entity_id}</span>
                      {can("notes.update") && (
                        <button onClick={() => removeLinkMutation.mutate({ noteId: viewingNote.id, linkId: l.id })} className="ml-auto p-0.5 text-muted hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity" aria-label="Remove link"><XIcon size={12} /></button>
                      )}
                    </div>
                  );
                })}
              </div>
              {can("notes.update") && (
                <div className="mt-2 space-y-2">
                  <select className="select text-sm w-40" value={linkEntityFilter} onChange={(e) => setLinkEntityFilter(e.target.value)}>
                    {LINKABLE_ENTITIES.map((t) => <option key={t.entity_type} value={t.entity_type}>{t.label}</option>)}
                  </select>
                  <EntitySearchInput
                    entityType={linkEntityFilter}
                    excludeIds={viewingNote.links.map((l) => ({ entity_type: l.entity_type, entity_id: l.entity_id }))}
                    onSelect={(sel) => addLinkMutation.mutate({ noteId: viewingNote.id, ...sel })}
                    placeholder={`Search ${getEntityTypeLabel(linkEntityFilter).toLowerCase()}s...`}
                    disabled={addLinkMutation.isPending}
                  />
                </div>
              )}
            </div>

          <div className="flex flex-wrap justify-end gap-2 pt-4 border-t border-border">
            {!viewingNote.is_completed && <button onClick={() => { completeMutation.mutate(viewingNote.id); setViewingNote(null); }} className="btn-secondary text-sm"><CheckCircle2 size={16} className="mr-1" />Complete</button>}
            {can("notes.update") && <button onClick={() => { archiveMutation.mutate(viewingNote.id); setViewingNote(null); }} className="btn-secondary text-sm">{viewingNote.is_archived ? <><ArchiveRestore size={16} className="mr-1" />Unarchive</> : <><Archive size={16} className="mr-1" />Archive</>}</button>}
            {can("notes.create") && <button onClick={() => { duplicateMutation.mutate(viewingNote.id); }} className="btn-secondary text-sm"><Copy size={16} className="mr-1" />Duplicate</button>}
            {can("notes.update") && <button onClick={() => { setViewingNote(null); openEdit(viewingNote); }} className="btn-secondary text-sm"><Edit3 size={16} className="mr-1" />Edit</button>}
            {can("notes.delete") && <button onClick={() => { setConfirmDelete(viewingNote); }} className="btn-danger text-sm"><Trash2 size={16} className="mr-1" />Delete</button>}
          </div>
        </div>
      </SlideOver>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-ink">Notes</h1>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-subtle p-0.5">
            {(["all", "active", "completed", "archived"] as const).map((f) => (
              <button key={f} onClick={() => { setCompletedFilter(f); setPage(1); clearSelection(); }} className={tabClasses(completedFilter === f)}>
                {f === "all" ? "All" : f === "active" ? "Active" : f === "completed" ? "Done" : "Archived"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="View mode" className="flex items-center gap-1 rounded-lg border border-border bg-subtle p-0.5">
            <button onClick={() => setViewMode("list")} className={viewBtnClass(viewMode === "list")} title="List view" aria-label="List view"><List size={16} /></button>
            <button onClick={() => setViewMode("card")} className={viewBtnClass(viewMode === "card")} title="Card view" aria-label="Card view"><LayoutGrid size={16} /></button>
            <button onClick={() => setViewMode("kanban")} className={viewBtnClass(viewMode === "kanban")} title="Kanban view" aria-label="Kanban view"><Columns3 size={16} /></button>
          </div>
          {can("notes.create") && (
            <button onClick={() => setShowTagManager(true)} className="btn-secondary text-sm px-3 py-1.5" aria-label="Manage tags" title="Manage tags"><TagIcon size={16} /></button>
          )}
          {can("notes.create") && (
            <button onClick={() => setShowTemplateManager(true)} className="btn-secondary text-sm px-3 py-1.5" aria-label="Templates" title="Templates"><BookTemplate size={16} /></button>
          )}
          {can("notes.create") && (
            <button onClick={openCreate} className="btn-primary">New Note</button>
          )}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input className="input pl-10" placeholder="Search notes..." aria-label="Search notes" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <select className="select w-40" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} aria-label="Filter by category">
          <option value="">All categories</option>
          <option value="note">Notes</option>
          <option value="reminder">Reminders</option>
          <option value="todo">Todos</option>
        </select>
        <select className="select w-40" value={priority} onChange={(e) => { setPriority(e.target.value); setPage(1); }} aria-label="Filter by priority">
          <option value="">All priorities</option>
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
        <select className="select w-40" value={tagFilter} onChange={(e) => { setTagFilter(e.target.value); setPage(1); }} aria-label="Filter by tag">
          <option value="">All tags</option>
          {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select className="select w-40" value={assigneeFilter} onChange={(e) => { setAssigneeFilter(e.target.value); setPage(1); }} aria-label="Filter by assignee">
          <option value="">All assignees</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
        </select>
        <input type="date" className="input w-40" value={dueDateFrom} onChange={(e) => { setDueDateFrom(e.target.value); setPage(1); }} aria-label="Due after" title="Due after" />
        <input type="date" className="input w-40" value={dueDateTo} onChange={(e) => { setDueDateTo(e.target.value); setPage(1); }} aria-label="Due before" title="Due before" />
      </div>

      {viewMode === "list" && (
        <div className="flex gap-2 items-center text-sm">
          <span className="text-muted">Sort by:</span>
          {[
            { key: "created_at", label: "Created" },
            { key: "updated_at", label: "Updated" },
            { key: "due_date", label: "Due date" },
            { key: "title", label: "Title" },
            { key: "priority", label: "Priority" },
          ].map((s) => (
            <button
              key={s.key}
              onClick={() => { if (sortField === s.key) setSortOrder(sortOrder === "asc" ? "desc" : "asc"); else { setSortField(s.key); setSortOrder(s.key === "due_date" ? "asc" : "desc"); } }}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${sortField === s.key ? "bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-400" : "text-muted hover:text-ink hover:bg-subtle"}`}
            >
              {s.label}
              {sortField === s.key && (sortOrder === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
            </button>
          ))}
        </div>
      )}

      {selectedIds.size > 0 && can("notes.update") && (
        <div className="flex items-center gap-3 px-4 py-3 bg-indigo-50 dark:bg-indigo-500/10 rounded-lg border border-indigo-200 dark:border-indigo-500/30 flex-wrap">
          <span className="text-sm font-medium text-indigo-700 dark:text-indigo-400">{selectedIds.size} selected</span>
          <button onClick={() => bulkArchiveMutation.mutate({ ids: Array.from(selectedIds), archive: completedFilter !== "archived" })} className="btn-primary text-sm px-3 py-1.5" disabled={bulkArchiveMutation.isPending}>
            {completedFilter === "archived" ? "Unarchive" : "Archive"}
          </button>
          <button onClick={() => bulkCompleteMutation.mutate({ ids: Array.from(selectedIds), is_completed: true })} className="btn-secondary text-sm px-3 py-1.5" disabled={bulkCompleteMutation.isPending}>
            Complete
          </button>
          <select className="select !py-1.5 text-xs w-32" value="" onChange={(e) => { if (e.target.value) { bulkPriorityMutation.mutate({ ids: Array.from(selectedIds), priority: e.target.value }); e.target.value = ""; } }} aria-label="Set priority">
            <option value="">Set priority...</option>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
          {can("notes.delete") && (
            <button onClick={() => setConfirmBulkDelete(true)} className="text-sm px-3 py-1.5 text-red-600 dark:text-red-400 hover:text-red-800 font-medium" disabled={bulkDeleteMutation.isPending}>
              Delete
            </button>
          )}
          <button onClick={clearSelection} className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:text-indigo-400 underline ml-auto">
            Clear
          </button>
        </div>
      )}

      <div className={viewMode === "kanban" ? "" : "card overflow-hidden p-0"}>
        {renderContent()}
      </div>

      {data && viewMode !== "kanban" && <Pagination page={page} totalPages={data.pages} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />}

      <Modal open={showForm} title={editingNote ? "Edit Note" : "New Note"} onClose={() => { setShowForm(false); setEditingNote(null); setForm(EMPTY_FORM); }} wide>
          <div className="space-y-4">
            {!editingNote && templates.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Start from template</label>
                <select className="select w-full" value="" onChange={(e) => {
                  const t = templates.find((tpl) => tpl.id === Number(e.target.value));
                  if (t) setForm({ title: t.name, body: t.body, category: t.category, priority: t.priority, is_pinned: false, due_date: "", recurrence: t.recurrence, assigned_to_id: null, tag_ids: [], links: [] });
                }}>
                  <option value="">Choose a template...</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.category} / {t.priority})</option>)}
                </select>
              </div>
            )}
            {editingNote?.image_url && !editImageFile && (
              <div className="relative group">
                <img src={editingNote.image_url} alt="Note image" className="w-full h-40 object-cover rounded-lg" />
                <button onClick={async () => { if (editingNote) { await api.put(`/notes/${editingNote.id}`, { image_url: "" }); queryClient.invalidateQueries({ queryKey: ["notes"] }); queryClient.invalidateQueries({ queryKey: ["notes-kanban"] }); setEditingNote({ ...editingNote, image_url: "" }); addToast("Image removed", "success"); } }} className="absolute top-2 right-2 p-1.5 bg-black/50 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity" aria-label="Remove image">
                  <XIcon size={14} />
                </button>
              </div>
            )}
            {editImageFile && (
              <div className="relative">
                <img src={imagePreviewUrl!} alt="Preview" className="w-full h-40 object-cover rounded-lg" />
                <button onClick={() => setEditImageFile(null)} className="absolute top-2 right-2 p-1.5 bg-black/50 rounded-full text-white" aria-label="Remove image"><XIcon size={14} /></button>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Title *</label>
              <input className="input w-full" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Note title" autoFocus />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Body</label>
              <textarea className="input w-full h-28 resize-y" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Add details..." />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Image</label>
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setEditImageFile(f); }} />
              <button onClick={() => fileInputRef.current?.click()} className="btn-secondary text-sm flex items-center gap-1.5" type="button"><ImageIcon size={14} />Choose image</button>
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
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Due Date</label>
                <input type="datetime-local" className="input w-full" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
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
            </div>
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Assign to</label>
              <select className="select w-full" value={form.assigned_to_id ?? ""} onChange={(e) => setForm({ ...form, assigned_to_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Unassigned</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted mb-2">Tags</label>
              <div className="flex flex-wrap gap-2">
                {tags.map((t) => {
                  const selected = form.tag_ids.includes(t.id);
                  return (
                    <button key={t.id} type="button" onClick={() => setForm({ ...form, tag_ids: selected ? form.tag_ids.filter((id) => id !== t.id) : [...form.tag_ids, t.id] })} className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${selected ? "border-current" : "border-border hover:border-current"}`} style={{ color: t.color, backgroundColor: selected ? t.color + "15" : "transparent" }}>
                      {t.name}
                    </button>
                  );
                })}
                {tags.length === 0 && <span className="text-xs text-muted">No tags created yet</span>}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted mb-2">Linked Entities</label>
              <div className="space-y-2">
                {form.links.map((link, idx) => {
                  const EntityIcon = getEntityTypeIcon(link.entity_type);
                  return (
                    <div key={idx} className="flex items-center gap-2 text-sm bg-subtle rounded-lg px-3 py-2">
                      <EntityIcon size={14} className="text-muted shrink-0" />
                      <span className="text-ink font-medium">{link.entity_label || getEntityTypeLabel(link.entity_type)}</span>
                      <span className="text-muted">#{link.entity_id}</span>
                      <button type="button" onClick={() => setForm({ ...form, links: form.links.filter((_, i) => i !== idx) })} className="ml-auto p-0.5 text-muted hover:text-red-500 transition-colors" aria-label="Remove link"><XIcon size={14} /></button>
                    </div>
                  );
                })}
                <div className="flex gap-2 items-center">
                  <select className="select text-sm w-40" value={linkEntityFilter} onChange={(e) => setLinkEntityFilter(e.target.value)}>
                    {LINKABLE_ENTITIES.map((t) => <option key={t.entity_type} value={t.entity_type}>{t.label}</option>)}
                  </select>
                  <div className="flex-1">
                    <EntitySearchInput
                      entityType={linkEntityFilter}
                      excludeIds={form.links.map((l) => ({ entity_type: l.entity_type, entity_id: l.entity_id }))}
                      onSelect={(sel) => {
                        if (!form.links.some((l) => l.entity_type === sel.entity_type && l.entity_id === sel.entity_id)) {
                          setForm({ ...form, links: [...form.links, sel] });
                        }
                      }}
                      placeholder={`Search ${getEntityTypeLabel(linkEntityFilter).toLowerCase()}s...`}
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => { setShowForm(false); setEditingNote(null); setForm(EMPTY_FORM); }} className="btn-secondary">Cancel</button>
              {editingNote && can("notes.create") && <button onClick={() => { createTemplateMutation.mutate(editingNote); }} className="btn-secondary text-sm" disabled={createTemplateMutation.isPending}>Save Template</button>}
              <button onClick={handleFormSubmit} className="btn-primary" disabled={createMutation.isPending || updateMutation.isPending}>{editingNote ? "Save Changes" : "Create Note"}</button>
            </div>
          </div>
        </Modal>

      <Modal open={!!showTagManager} title="Manage Tags" onClose={() => setShowTagManager(false)}>
          <div className="space-y-5">
            <div className="flex gap-3 items-center">
              <input className="input flex-1" placeholder="New tag name" value={newTagName} onChange={(e) => setNewTagName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newTagName.trim()) createTagMutation.mutate(); }} />
              <input type="color" className="w-10 h-10 rounded-lg border border-border-strong cursor-pointer" value={newTagColor} onChange={(e) => setNewTagColor(e.target.value)} aria-label="Tag color" />
              <button onClick={() => { if (newTagName.trim()) createTagMutation.mutate(); }} className="btn-primary text-sm px-4 py-2" disabled={!newTagName.trim()}>Add</button>
            </div>
            <div className="space-y-1.5">
              {tags.map((t) => (
                <div key={t.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-subtle transition-colors">
                  <span className="flex items-center gap-2.5 text-sm"><span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />{t.name}</span>
                  <button onClick={() => setConfirmTagDelete(t)} className="p-1 text-muted hover:text-red-500 transition-colors" aria-label={`Delete tag ${t.name}`}><Trash2 size={14} /></button>
                </div>
              ))}
              {tags.length === 0 && <p className="text-sm text-muted text-center py-6">No tags yet. Create one above.</p>}
            </div>
          </div>
        </Modal>

      <Modal open={!!showTemplateManager} title="Note Templates" onClose={() => setShowTemplateManager(false)}>
          <div className="space-y-5">
            {can("notes.create") && (
              <button onClick={() => { setShowTemplateManager(false); setTemplateEditTarget(null); setShowTemplateForm(true); }} className="btn-primary text-sm w-full">New Template</button>
            )}
            <div className="space-y-1.5">
              {templates.map((t) => (
                <div key={t.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-subtle transition-colors">
                  <div className="flex items-center gap-2.5 text-sm min-w-0">
                    <StickyNote size={14} className="text-muted shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium text-ink truncate">{t.name}</div>
                      <div className="text-xs text-muted">{t.category} / {t.priority}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => { setTemplateEditTarget(t); setShowTemplateManager(false); setShowTemplateForm(true); }} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline px-2 py-1">Edit</button>
                    <button onClick={() => {
                      setForm({ title: t.name, body: t.body, category: t.category, priority: t.priority, is_pinned: false, due_date: "", recurrence: t.recurrence, assigned_to_id: null, tag_ids: [], links: [] });
                      setEditingNote(null);
                      setShowTemplateManager(false);
                      setShowForm(true);
                    }} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline px-2 py-1">Use</button>
                    <button onClick={() => deleteTemplateMutation.mutate(t.id)} className="p-1 text-muted hover:text-red-500 transition-colors" aria-label={`Delete template ${t.name}`}><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
              {templates.length === 0 && <p className="text-sm text-muted text-center py-6">No templates yet. Create one with the button above.</p>}
            </div>
          </div>
        </Modal>

      {renderDetailPanel()}

      <ConfirmDialog
        open={!!confirmTagDelete}
        title="Delete Tag"
        message={`Are you sure you want to delete the tag "${confirmTagDelete?.name}"? It will be removed from all notes.`}
        confirmLabel="Delete"
        onConfirm={() => { if (confirmTagDelete) deleteTagMutation.mutate(confirmTagDelete.id); setConfirmTagDelete(null); }}
        onCancel={() => setConfirmTagDelete(null)}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete Note"
        message={`Are you sure you want to delete "${confirmDelete?.title}"? This action cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
        onCancel={() => setConfirmDelete(null)}
      />

      <ConfirmDialog
        open={confirmBulkDelete}
        title="Delete Notes"
        message={`Are you sure you want to delete ${selectedIds.size} note(s)? This action cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => { bulkDeleteMutation.mutate(Array.from(selectedIds)); setConfirmBulkDelete(false); }}
        onCancel={() => setConfirmBulkDelete(false)}
      />

      {showTemplateForm && (
        <NoteTemplateForm
          template={templateEditTarget}
          onClose={() => { setShowTemplateForm(false); setTemplateEditTarget(null); }}
          onSaved={() => { setShowTemplateForm(false); setTemplateEditTarget(null); }}
        />
      )}
    </div>
  );
}
