export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

export function isAbsoluteUrl(input: string): boolean {
  // 不用 URL.parse：它只在 Node 22.1+/Chrome 126+ 可用。
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function buildUrl(baseUrl: string | undefined, path: string): string {
  if (isAbsoluteUrl(path)) return path;
  if (!baseUrl)
    throw new Error(`baseUrl is required when path is not absolute: ${path}`);
  if (/^\/\/[^/]/.test(path))
    throw new Error(`protocol-relative URL is not supported: ${path}`);
  const base = baseUrl.replace(/\/+$/, "");
  const tail = path.replace(/^\/+/, "");
  return `${base}/${tail}`;
}

export function buildQuery(url: string, query: Record<string, string>): string {
  if (!query || Object.keys(query).length === 0) return url;
  const q = new URLSearchParams(query).toString();
  if (!url.includes("?")) return `${url}?${q}`;
  if (url.endsWith("?")) return `${url}${q}`;
  return `${url}&${q}`;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    function onAbort() {
      clearTimeout(timer);
      reject(signal!.reason);
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function mergeSignals(
  list: (AbortSignal | undefined)[],
): AbortSignal | undefined {
  const valid = list.filter((s): s is AbortSignal => s != null);
  if (valid.length === 0) return undefined;
  if (valid.length === 1) return valid[0];
  return AbortSignal.any(valid);
}
