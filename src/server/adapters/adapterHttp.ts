export interface AdapterHttpOptions {
  label: string;
  timeoutMs: number;
  maximumBytes: number;
  init?: RequestInit;
}

export async function fetchAdapterText(url: URL | string, options: AdapterHttpOptions) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(url, { ...options.init, signal: controller.signal });
    if (!response.ok) throw new Error(`${options.label} failed: ${response.status}`);
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > options.maximumBytes) {
      throw new Error(`${options.label} response exceeded ${options.maximumBytes} bytes`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchAdapterJson(url: URL | string, options: AdapterHttpOptions) {
  return JSON.parse(await fetchAdapterText(url, options)) as unknown;
}
