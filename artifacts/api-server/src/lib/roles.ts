/** User roles. Supervisors (team leaders) sit between agents and admins. */
export type Role = "admin" | "supervisor" | "agent";

export const ROLES: readonly Role[] = ["admin", "supervisor", "agent"];

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

/** Admins and supervisors may see and steer every conversation. */
export function isLead(role: string | undefined | null): boolean {
  return role === "admin" || role === "supervisor";
}
