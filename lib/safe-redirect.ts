const BASE_ORIGIN = "https://redirect.invalid";
const DEFAULT_PATH = "/dashboard";

function validatedPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 2048) return null;
  let decoded = value;
  // Inspect nested encoding as well: downstream URL/router decoding must never
  // turn a return path into a protocol-relative URL or a backslash authority.
  for (let depth = 0; depth < 5; depth++) {
    if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.includes("\\") || /%2f|%5c/i.test(decoded)
      || Array.from(decoded).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return null;
    let next: string;
    try { next = decodeURIComponent(decoded); } catch { return null; }
    if (next === decoded) break;
    if (depth === 4) return null;
    decoded = next;
  }
  try {
    const parsed = new URL(value, BASE_ORIGIN), decodedUrl = new URL(decoded, BASE_ORIGIN);
    if (parsed.origin !== BASE_ORIGIN || decodedUrl.origin !== BASE_ORIGIN
      || parsed.pathname.startsWith("//") || decodedUrl.pathname.startsWith("//")
      || /^\/session(?:\/|$)/i.test(decodedUrl.pathname)) return null;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch { return null; }
}

/** A validated application return path; even a caller-supplied fallback is checked. */
export function safeRedirectPath(value: unknown, fallback = DEFAULT_PATH): string {
  return validatedPath(value) || validatedPath(fallback) || DEFAULT_PATH;
}
