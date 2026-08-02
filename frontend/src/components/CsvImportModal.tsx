import { useState, useRef } from "react";
import { Upload, FileText, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import api from "../api/client";
import Modal from "./Modal";
import { useToast } from "../context/ToastContext";

interface Props {
  onClose: () => void;
  onImported: () => void;
}

interface ImportResult {
  created: number;
  skipped: number;
  errors: string[];
}

export default function CsvImportModal({ onClose, onImported }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useToast();

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await api.post("/products/import-csv", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResult(data);
      if (data.created > 0) addToast(`${data.created} products imported`, "success");
      if (data.created > 0) onImported();
    } catch (err: any) {
      addToast(err.response?.data?.detail || "Import failed", "error");
    }
    setImporting(false);
  };

  return (
    <Modal open onClose={onClose} title="Import Products from CSV" wide>
      <div className="space-y-4">
        {!result ? (
          <>
            <div
              className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-indigo-400"
              onClick={() => inputRef.current?.click()}
            >
              {file ? (
                <div className="flex items-center justify-center gap-2 text-indigo-600">
                  <FileText size={24} />
                  <span className="font-medium">{file.name}</span>
                </div>
              ) : (
                <div className="text-gray-500">
                  <Upload size={32} className="mx-auto mb-2" />
                  <p>Click to select a CSV file</p>
                  <p className="text-xs mt-1">Headers: sku, name, description, unit_price, cost_price, quantity, reorder_level, location, barcode, parent_sku, attributes</p>
                  <p className="text-xs mt-1 text-gray-400">Set parent_sku + attributes (JSON like {"{\"Color\":\"Blue\"}"}) to create variants.</p>
                </div>
              )}
            </div>
            <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <div className="flex justify-end gap-3">
              <button onClick={onClose} className="btn-secondary">Cancel</button>
              <button onClick={handleImport} disabled={!file || importing} className="btn-primary">
                {importing ? "Importing..." : "Import"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex gap-4">
              <div className="flex items-center gap-2 text-green-600"><CheckCircle size={20} /><span className="font-medium">{result.created} created</span></div>
              {result.skipped > 0 && <div className="flex items-center gap-2 text-yellow-600"><AlertTriangle size={20} /><span className="font-medium">{result.skipped} skipped (duplicate SKUs)</span></div>}
            </div>
            {result.errors.length > 0 && (
              <div>
                <div className="flex items-center gap-2 text-red-600 mb-2"><XCircle size={20} /><span className="font-medium">{result.errors.length} errors</span></div>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {result.errors.map((e, i) => <p key={i} className="text-sm text-red-600">{e}</p>)}
                </div>
              </div>
            )}
            <div className="flex justify-end">
              <button onClick={onClose} className="btn-primary">Done</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
