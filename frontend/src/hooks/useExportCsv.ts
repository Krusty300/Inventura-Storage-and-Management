import { useState } from "react";
import api from "../api/client";
import { downloadBlob } from "../utils/download";
import { useToast } from "../context/ToastContext";

export function useExportCsv() {
  const [exporting, setExporting] = useState<string | null>(null);
  const { addToast } = useToast();

  const exportCsv = async (path: string, filename: string, label?: string, params?: Record<string, string>) => {
    setExporting(filename);
    try {
      const { data } = await api.get(path, { params, responseType: "blob" });
      downloadBlob(data, filename);
      addToast(`${label || filename} exported to CSV`, "success");
    } catch {
      addToast(`Failed to export ${label || filename}`, "error");
    } finally {
      setExporting(null);
    }
  };

  return { exportCsv, exporting };
}
