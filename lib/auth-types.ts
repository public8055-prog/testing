import type { UserRole } from "./roles";
export type AccountUser = { id: string; email: string; name: string; role: UserRole; email_verified?: number };
