import type { User } from "@workspace/api-client-react";

/** User as returned by the API (fields added after the OpenAPI codegen). */
export interface AppUser extends User {
  displayName?: string | null;
  isActive?: boolean;
  mustChangePassword?: boolean;
}

/** Name shown everywhere in the UI — never the email. */
export function userLabel(u?: { name?: string | null; displayName?: string | null } | null): string {
  return (u?.displayName?.trim() || u?.name?.trim() || "User");
}

export function roleLabel(role?: string | null): string {
  return role === "admin" ? "Administrator" : role === "agent" ? "Agent" : (role ?? "");
}

export function initials(name?: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
