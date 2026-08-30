interface AxiosLike { response?: { data?: Record<string, unknown> } }

function isAxiosLike(err: unknown): err is AxiosLike {
  return typeof err === "object" && err !== null && "response" in err;
}

function extractDetail(err: unknown): unknown {
  if (isAxiosLike(err)) return err.response?.data?.detail;
  return undefined;
}

export function errorMessage(err: unknown, fallback: string): string {
  const detail = extractDetail(err);
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d: unknown) => {
    if (typeof d === "object" && d !== null && "msg" in d) return (d as { msg: string }).msg;
    return JSON.stringify(d);
  }).join("; ");
  return fallback;
}
