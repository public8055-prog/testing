export const USER_ROLES = ["SUPER_ADMIN", "ADMIN", "PROVIDER", "CUSTOMER"] as const;
export type UserRole = typeof USER_ROLES[number];
/** Existing lowercase records remain valid until an ordinary authenticated write normalizes them. */
export const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN", "super_admin", "superadmin", "admin"] as const;
export const SUPER_ADMIN_ROLES = ["SUPER_ADMIN", "super_admin", "superadmin"] as const;
export function canonicalRole(value: unknown): UserRole {
  const role = typeof value === "string" ? value.trim().toUpperCase().replaceAll("-", "_") : "";
  if (role === "SUPERADMIN" || role === "SUPER_ADMIN") return "SUPER_ADMIN";
  if (role === "ADMIN" || role === "PROVIDER") return role;
  return "CUSTOMER";
}
export function isAdminRole(value: unknown) { const role = canonicalRole(value); return role === "SUPER_ADMIN" || role === "ADMIN"; }
export function isSuperAdminRole(value: unknown) { return canonicalRole(value) === "SUPER_ADMIN"; }
export function isAccountActive(user: Record<string, unknown> | null | undefined, state?: Record<string, unknown> | null) {
  if (!user || state && Number(state.active) !== 1) return false;
  return user.active !== false && user.active !== 0 && user.disabled !== true && !user.deleted && !user.deleted_at
    && !["disabled", "inactive", "deleted", "suspended"].includes(String(user.status || "").toLowerCase());
}
