export function withTimeout(
  promise,
  timeoutMs,
  timeoutMessage = "Request timeout",
) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const response = await withTimeout(
    fetch(url, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.headers ?? {}),
      },
    }),
    timeoutMs,
    `Timeout fetching ${url}`,
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return response.json();
}

export async function fetchText(url, options = {}, timeoutMs = 15000) {
  const response = await withTimeout(
    fetch(url, {
      ...options,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent":
          "Mozilla/5.0 (compatible; HunterMCP/1.0; +https://github.com/pedrohlucena/hunter)",
        ...(options.headers ?? {}),
      },
    }),
    timeoutMs,
    `Timeout fetching ${url}`,
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return response.text();
}

export function stripHtml(text) {
  return String(text ?? "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function tokenize(text) {
  return normalizeText(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function keywordOverlapScore(haystack, keywords) {
  if (!keywords?.length) return 55;

  const tokens = new Set(tokenize(haystack));
  const hits = keywords.filter((k) => tokens.has(normalizeText(k))).length;
  const ratio = hits / Math.max(1, keywords.length);
  return Math.round(30 + ratio * 70);
}
