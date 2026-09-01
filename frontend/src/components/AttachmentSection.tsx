import { useEffect, useRef, useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Download,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  Paperclip,
  Presentation,
  Trash2,
  Upload,
} from "lucide-react";
import api from "../api/client";
import { useToast } from "../context/ToastContext";
import { useDateTimeFormat } from "../hooks/useDateTimeFormat";
import type { Attachment, AttachmentDocument } from "../types";
import { errorMessage } from "../utils/errors";
import { downloadBlob } from "../utils/download";
import ConfirmDialog from "./ConfirmDialog";
import Modal from "./Modal";
import Skeleton from "./Skeleton";

interface Props {
  entityType: string;
  entityId: number;
  canEdit?: boolean;
}

// Maps an attachment entity type to the react-query prefix of its owning page so
// that existing realtime/already-invalidated queries (e.g. ["products"]) also
// invalidate this section via prefix matching.
const ENTITY_PREFIX: Record<string, string> = {
  product: "products",
  order: "orders",
  quality_check: "quality-checks",
  customer: "customers",
  supplier: "suppliers",
  receipt: "receipts",
  dashboard: "dashboard",
};

// Accepted file extensions, mirrors the backend ALLOWED_EXTENSIONS.
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.gif,.webp,.svg,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.md";

function formatSize(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function previewKind(contentType: string): "image" | "pdf" | "text" | null {
  if (contentType.startsWith("image/")) return "image";
  if (contentType === "application/pdf") return "pdf";
  if (
    contentType === "text/plain" ||
    contentType === "text/csv" ||
    contentType === "text/markdown"
  ) {
    return "text";
  }
  return null;
}

function fileKindIcon(contentType: string) {
  if (contentType.startsWith("image/")) return FileImage;
  if (
    contentType.includes("spreadsheet") ||
    contentType.includes("ms-excel")
  ) {
    return FileSpreadsheet;
  }
  if (contentType.includes("presentation") || contentType.includes("powerpoint")) {
    return Presentation;
  }
  if (contentType.includes("pdf") || contentType.startsWith("text/") || contentType.includes("msword")) {
    return FileText;
  }
  return File;
}

async function fetchBlob(url: string): Promise<{ blob: Blob; filename: string }> {
  // att.url is absolute-to-origin ("/api/attachments/entry/{id}/download"). The axios
  // client already prefixes baseURL="/api", so strip any leading "/api" to avoid a
  // doubled "/api/api/..." prefix that causes a 404.
  const path = url.startsWith("/api/") ? url.slice("/api".length) || "/" : url;
  const { data, headers } = await api.get<Blob>(path, { responseType: "blob" });
  let filename = `document-${Date.now()}`;
  const disposition = (headers["content-disposition"] as string | undefined) ?? "";
  const match = disposition.match(/filename\*?=(?:UTF-8''|")([^";]+)/i) || disposition.match(/filename="([^"]+)"/i);
  if (match && match[1]) {
    try {
      filename = decodeURIComponent(match[1]);
    } catch {
      filename = match[1];
    }
  }
  return { blob: data, filename };
}

export default function AttachmentSection({ entityType, entityId, canEdit = true }: Props) {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const formatDateTime = useDateTimeFormat();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docKey, setDocKey] = useState("");
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Attachment | null>(null);
  const [dragging, setDragging] = useState(false);

  const prefix = ENTITY_PREFIX[entityType] ?? "attachments";
  const queryKey = [prefix, entityId, "attachments"];

  const { data: documents = [] as AttachmentDocument[], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data } = await api.get(`/attachments/${entityType}/${entityId}`);
      return data as AttachmentDocument[];
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const uploadMutation = useMutation({
    mutationFn: ({ file, key }: { file: File; key: string }) => {
      const fd = new FormData();
      fd.append("file", file);
      if (key) fd.append("doc_key", key);
      return api.post(`/attachments/${entityType}/${entityId}`, fd);
    },
    onSuccess: () => {
      addToast("Document uploaded", "success");
      setDocKey("");
      invalidate();
    },
    onError: (err) => addToast(errorMessage(err, "Failed to upload document"), "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/attachments/entry/${id}`),
    onSuccess: () => {
      addToast("Document deleted", "success");
      invalidate();
    },
    onError: (err) => addToast(errorMessage(err, "Failed to delete document"), "error"),
  });

  const uploadFiles = (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    for (const file of arr) {
      uploadMutation.mutate({ file, key: docKey });
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    uploadFiles(e.dataTransfer.files);
  };

  // Revoke preview object URLs on unmount / change / close.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const openPreview = async (att: Attachment) => {
    setPreview(att);
    setPreviewUrl(null);
    setPreviewText(null);
    const kind = previewKind(att.content_type);
    if (!kind) return;
    try {
      const { blob } = await fetchBlob(att.url);
      if (kind === "text") {
        setPreviewText(await blob.text());
      } else {
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
      }
    } catch {
      addToast(errorMessage(new Error(), "Failed to preview document"), "error");
      setPreview(null);
    }
  };

  const handleDownload = async (att: Attachment) => {
    try {
      const { blob, filename } = await fetchBlob(att.url);
      downloadBlob(blob, filename);
    } catch {
      addToast(errorMessage(new Error(), "Failed to download document"), "error");
    }
  };

  return (
    <div className="border border-border rounded-lg">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="font-semibold flex items-center gap-2">
          <Paperclip size={16} />
          Attachments
        </h3>
        <span className="text-xs text-muted">{documents.length} document{documents.length === 1 ? "" : "s"}</span>
      </div>

      <div className="p-4 space-y-3">
        {canEdit && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="input flex-1 min-w-[160px]"
                placeholder="Document name (optional)"
                value={docKey}
                onChange={(e) => setDocKey(e.target.value)}
              />
              <button
                className="btn-secondary flex items-center gap-1.5"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isPending}
              >
                <Upload size={16} />
                {uploadMutation.isPending ? "Uploading..." : "Upload"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => {
                  uploadFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            <div
              role="button"
              tabIndex={0}
              aria-label="Drag and drop documents to upload, or click to browse"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragging(false);
              }}
              onDrop={onDrop}
              className={`border-2 border-dashed rounded-lg px-4 py-6 text-center text-sm transition-colors cursor-pointer select-none ${
                dragging
                  ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                  : "border-border text-muted hover:border-indigo-300 hover:bg-app"
              }`}
            >
              <div className="flex items-center justify-center gap-2 mb-1">
                <Upload size={18} />
                <span className="font-medium text-ink">Drag & drop documents here</span>
              </div>
              <p className="text-xs text-faint">or click to browse · PDF, images, Office docs, text (max 20 MB each)</p>
            </div>
          </>
        )}

        {isLoading ? (
          <div className="divide-y divide-border" aria-busy="true" aria-label="Loading attachments">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-3">
                <Skeleton variant="text" className="h-5 w-5 rounded" />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <Skeleton variant="text" className="h-3.5 w-1/2" />
                  <Skeleton variant="text" className="h-3 w-2/3" />
                </div>
                <Skeleton variant="text" className="h-6 w-16 rounded" />
                <Skeleton variant="text" className="h-6 w-10 rounded" />
              </div>
            ))}
          </div>
        ) : documents.length === 0 ? (
          <p className="text-sm text-muted py-2">No documents attached yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {documents.map((doc) => {
              const Icon = fileKindIcon(doc.current.content_type);
              const isOpen = expanded === doc.doc_key;
              return (
                <li key={doc.doc_key} className="py-2">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="text-muted hover:text-ink"
                      onClick={() => setExpanded(isOpen ? null : doc.doc_key)}
                      aria-label="Toggle version history"
                    >
                      {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <Icon size={18} className="text-muted shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{doc.doc_key}</p>
                      <p className="text-xs text-muted">
                        v{doc.version} · {formatSize(doc.current.size)} · {doc.username || "—"} ·{" "}
                        {formatDateTime(doc.current.created_at)}
                      </p>
                    </div>
                    {previewKind(doc.current.content_type) && (
                      <button
                        className="btn-secondary px-2.5 py-1 text-xs"
                        onClick={() => openPreview(doc.current)}
                      >
                        Preview
                      </button>
                    )}
                    <button
                      className="btn-secondary px-2 py-1 text-xs inline-flex items-center"
                      onClick={() => handleDownload(doc.current)}
                      aria-label={`Download ${doc.doc_key}`}
                    >
                      <Download size={14} />
                    </button>
                    {canEdit && (
                      <button
                        className="text-muted hover:text-ink flex items-center"
                        onClick={() => setToDelete(doc.current)}
                        aria-label={`Delete ${doc.doc_key}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>

                  {isOpen && doc.versions.length > 1 && (
                    <ul className="ml-8 mt-2 space-y-1 border-l border-border pl-3">
                      {[...doc.versions]
                        .sort((a, b) => b.version - a.version)
                        .map((v) => (
                          <li key={v.id} className="flex items-center gap-2 text-xs text-muted flex-wrap">
                            <span className="font-medium text-ink">v{v.version}</span>
                            <span className="truncate">{formatSize(v.size)}</span>
                            <span className="truncate">{v.username || "—"}</span>
                            <span className="truncate">{formatDateTime(v.created_at)}</span>
                            {previewKind(v.content_type) ? (
                              <button className="underline hover:text-ink" onClick={() => openPreview(v)}>
                                Preview
                              </button>
                            ) : null}
                            <button className="underline hover:text-ink" onClick={() => handleDownload(v)}>
                              Download
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete attachment"
        message={`Delete "${toDelete?.doc_key}" (v${toDelete?.version})? This removes this version permanently.`}
        onConfirm={() => {
          if (toDelete) deleteMutation.mutate(toDelete.id);
          setToDelete(null);
        }}
        onCancel={() => setToDelete(null)}
      />

      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.original_filename || "Preview"} wide>
        {preview && (
          <div>
            {previewKind(preview.content_type) === "image" && previewUrl && (
              <img src={previewUrl} alt={preview.original_filename} className="max-h-[70vh] mx-auto rounded-lg" />
            )}
            {previewKind(preview.content_type) === "pdf" && previewUrl && (
              <iframe src={previewUrl} title={preview.original_filename} className="w-full h-[70vh] rounded-lg" />
            )}
            {previewKind(preview.content_type) === "text" && (
              previewText === null ? (
                <div className="bg-app rounded-lg p-4 space-y-2 max-h-[70vh] overflow-auto" aria-busy="true" aria-label="Loading document preview">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} variant="text" className="h-3.5" />
                  ))}
                </div>
              ) : (
                <pre className="whitespace-pre-wrap break-words bg-app rounded-lg p-4 text-xs text-ink max-h-[70vh] overflow-auto">
                  {previewText}
                </pre>
              )
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => handleDownload(preview)}>
                <Download size={16} className="inline mr-1" />
                Download
              </button>
              <button className="btn-primary" onClick={() => setPreview(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
