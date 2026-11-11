import { Router } from "express";
import { db } from "@workspace/db";
import { rolePermissionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { invalidatePermissionCache, PERMISSION_KEYS, ROLE_DEFAULTS } from "../lib/permissions";
import { isRole } from "../lib/roles";
import { logAudit } from "../lib/audit";
import type { AuthRequest } from "../middlewares/auth";

const router = Router();

router.get("/role-permissions", requireAuth, async (_req, res) => {
  const rows = await db.select().from(rolePermissionsTable);
  // Roles without a stored row (e.g. a newly introduced "supervisor") report
  // their built-in defaults so the settings screen always lists every role.
  const out = (["admin", "supervisor", "agent"] as const).map(
    (role) => rows.find((r) => r.role === role) ?? { role, ...ROLE_DEFAULTS[role], updatedAt: null },
  );
  res.json(out);
});

router.put(
  "/role-permissions/:role",
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res) => {
    const role = req.params.role;
    if (!isRole(role)) {
      res.status(400).json({ error: "role must be admin, supervisor or agent" });
      return;
    }

    const updates: Record<string, boolean> = {};
    for (const key of PERMISSION_KEYS) {
      const v = (req.body ?? {})[key];
      if (typeof v === "boolean") updates[key] = v;
    }

    // Admins always retain manageSettings — guard against accidental lockout.
    if (role === "admin") updates["canManageSettings"] = true;
    // Agents can never monitor, whisper or take over.
    if (role === "agent") for (const k of ["canMonitorChats", "canWhisper", "canTakeover"]) updates[k] = false;
    void logAudit({ actorId: req.user?.id, action: "permissions.role_changed", entityType: "role", details: { role, ...updates } });

    const [existing] = await db
      .select()
      .from(rolePermissionsTable)
      .where(eq(rolePermissionsTable.role, role));

    if (!existing) {
      const [row] = await db
        .insert(rolePermissionsTable)
        .values({ ...ROLE_DEFAULTS[role], role, ...updates, updatedAt: new Date() })
        .returning();
      invalidatePermissionCache();
      res.json(row);
      return;
    }

    const [row] = await db
      .update(rolePermissionsTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(rolePermissionsTable.role, role))
      .returning();
    invalidatePermissionCache();
    res.json(row);
  },
);

export default router;
