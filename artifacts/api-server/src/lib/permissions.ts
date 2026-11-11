import { db } from "@workspace/db";
import { rolePermissionsTable, userPermissionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Role } from "./roles";

export const PERMISSION_KEYS = [
  "canViewChats",
  "canSendMessages",
  "canViewReports",
  "canManageCustomers",
  "canManageSettings",
  "canMonitorChats",
  "canWhisper",
  "canTakeover",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];
export type EffectivePermissions = Record<PermissionKey, boolean>;

const ADMIN_DEFAULTS: EffectivePermissions = {
  canViewChats: true,
  canSendMessages: true,
  canViewReports: true,
  canManageCustomers: true,
  canManageSettings: true,
  canMonitorChats: true,
  canWhisper: true,
  canTakeover: true,
};

const SUPERVISOR_DEFAULTS: EffectivePermissions = {
  canViewChats: true,
  canSendMessages: true,
  canViewReports: true,
  canManageCustomers: true,
  canManageSettings: false,
  canMonitorChats: true,
  canWhisper: true,
  canTakeover: true,
};

const AGENT_DEFAULTS: EffectivePermissions = {
  canViewChats: true,
  canSendMessages: true,
  canViewReports: false,
  canManageCustomers: true,
  canManageSettings: false,
  canMonitorChats: false,
  canWhisper: false,
  canTakeover: false,
};

export const ROLE_DEFAULTS: Record<Role, EffectivePermissions> = {
  admin: ADMIN_DEFAULTS,
  supervisor: SUPERVISOR_DEFAULTS,
  agent: AGENT_DEFAULTS,
};

// Supervision powers only ever apply to leads; an agent can never be granted
// them (an agent must not read other agents' chats or whisper threads).
const LEAD_ONLY: PermissionKey[] = ["canMonitorChats", "canWhisper", "canTakeover"];

let roleCache: Map<string, EffectivePermissions> | null = null;
let roleCacheAt = 0;
const CACHE_TTL_MS = 30_000;

function pick(row: Record<string, unknown>, fallback: EffectivePermissions): EffectivePermissions {
  const out = { ...fallback };
  for (const k of PERMISSION_KEYS) if (typeof row[k] === "boolean") out[k] = row[k] as boolean;
  return out;
}

async function loadRolePermissions(): Promise<Map<string, EffectivePermissions>> {
  const now = Date.now();
  if (roleCache && now - roleCacheAt < CACHE_TTL_MS) return roleCache;

  const rows = await db.select().from(rolePermissionsTable);
  const map = new Map<string, EffectivePermissions>();
  for (const row of rows) {
    const role = row.role as Role;
    map.set(role, pick(row as unknown as Record<string, unknown>, ROLE_DEFAULTS[role] ?? AGENT_DEFAULTS));
  }
  roleCache = map;
  roleCacheAt = now;
  return map;
}

export function invalidatePermissionCache() {
  roleCache = null;
}

export async function getEffectivePermissions(userId: number, role: Role | string): Promise<EffectivePermissions> {
  const roleMap = await loadRolePermissions();
  if (role === "admin") {
    // Admins can't lock themselves out of settings or supervision.
    const rolePerms = roleMap.get("admin") ?? ADMIN_DEFAULTS;
    return { ...rolePerms, canManageSettings: true, canMonitorChats: true, canWhisper: true, canTakeover: true };
  }

  const r: Role = role === "supervisor" ? "supervisor" : "agent";
  const base = roleMap.get(r) ?? ROLE_DEFAULTS[r];

  const [override] = await db.select().from(userPermissionsTable).where(eq(userPermissionsTable.userId, userId));

  const merged = override ? pick(override as unknown as Record<string, unknown>, base) : { ...base };
  if (r === "agent") for (const k of LEAD_ONLY) merged[k] = false;
  return merged;
}

export async function hasPermission(userId: number, role: Role | string, key: PermissionKey): Promise<boolean> {
  const perms = await getEffectivePermissions(userId, role);
  return perms[key];
}
