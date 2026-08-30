import { downloadBlob } from "./download";

const DANGEROUS_PREFIXES = ["=", "+", "-", "@", "\t", "\r", "\n"];

function escapeCell(value: string | number): string {
  const str = String(value);
  let escaped = str.replace(/"/g, '""');
  if (DANGEROUS_PREFIXES.some((p) => escaped.startsWith(p))) {
    escaped = `'${escaped}`;
  }
  return `"${escaped}"`;
}

export function exportCSV(headers: string[], rows: (string | number)[][], filename: string) {
  const csv = "\uFEFF" + [headers.map(escapeCell).join(","), ...rows.map((r) => r.map(escapeCell).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `${filename}.csv`);
}
