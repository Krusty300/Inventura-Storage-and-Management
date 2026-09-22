export function downloadBlob(data: Blob, filename: string) {
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function printBlob(data: Blob) {
  const url = URL.createObjectURL(data);
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (w) w.focus();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
