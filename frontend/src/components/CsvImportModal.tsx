import { useState, useRef } from "react";
import { Upload, FileText, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import api from "../api/client";
import Modal from "./Modal";
import { useToast } from "../context/ToastContext";
import { errorMessage } from "../utils/errors";

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
      const { data } = await api.post("/products/import-csv", form);
      setResult(data);
      if (data.created > 0) addToast(`${data.created} products imported`, "success");
    } catch (err: unknown) {
      addToast(errorMessage(err, "Import failed"), "error");
    }
    setImporting(false);
  };

  return (
    <Modal open onClose={onClose} title="Import Products from CSV" wide>
      <div className="border border-border rounded-lg overflow-hidden bg-white dark:bg-app">
        <div className="border-b border-border px-6 py-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">CSV Import</p>
          <h3 className="text-lg font-bold text-ink mt-0.5 tracking-tight">Import Products from CSV</h3>
          <p className="text-sm text-muted">Upload a CSV of products to create them in bulk.</p>
        </div>
        <div className="p-6">
          {!result ? (
            <>
              <div
                className="border-2 border-dashed border-border-strong rounded-lg p-8 text-center cursor-pointer hover:border-indigo-400"
                onClick={() => inputRef.current?.click()}
              >
                {file ? (
                  <div className="flex items-center justify-center gap-2 text-indigo-600 dark:text-indigo-400">
                    <FileText size={24} />
                    <span className="font-medium">{file.name}</span>
                  </div>
                ) : (
                  <div className="text-muted">
                    <Upload size={32} className="mx-auto mb-2" />
                    <p>Click to select a CSV file</p>
                    <p className="text-xs mt-1">Headers: sku, name, description, unit_price, cost_price, quantity, reorder_level, location, barcode, parent_sku, attributes</p>
                    <p className="text-xs mt-1 text-faint">Set parent_sku + attributes (JSON like {"{\"Color\":\"Blue\"}"}) to create variants.</p>
                  </div>
                )}
              </div>
              <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              <div className="flex justify-end gap-3 pt-4 border-t border-border mt-5">
                <button onClick={onClose} className="btn-secondary">Cancel</button>
                <button onClick={handleImport} disabled={!file || importing} className="btn-primary">
                  {importing ? "Importing..." : "Import"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex gap-4">
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400"><CheckCircle size={20} /><span className="font-medium">{result.created} created</span></div>
                {result.skipped > 0 && <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400"><AlertTriangle size={20} /><span className="font-medium">{result.skipped} skipped (duplicate SKUs)</span></div>}
              </div>
              {result.errors.length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center gap-2 text-red-600 dark:text-red-400 mb-2"><XCircle size={20} /><span className="font-medium">{result.errors.length} errors</span></div>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {result.errors.map((e, i) => <p key={i} className="text-sm text-red-600 dark:text-red-400">{e}</p>)}
                  </div>
                </div>
              )}
              <div className="flex justify-end pt-4 border-t border-border mt-5">
                <button onClick={() => { onImported(); onClose(); }} className="btn-primary">Done</button>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
