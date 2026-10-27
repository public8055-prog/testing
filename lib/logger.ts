type Field = string | number | boolean | null;
export function logEvent(level: "info" | "warn" | "error", event: string, fields: Record<string, Field> = {}) {
  // Callers supply only operational metadata, never headers, bodies, identifiers or secrets.
  const output = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields });
  if (level === "error") console.error(output); else if (level === "warn") console.warn(output); else console.log(output);
}
