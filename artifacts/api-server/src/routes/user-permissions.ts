import { Router } from "express";
import { db } from "@workspace/db";
import { userPermissionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin, AuthRequest } from "../middlewares/auth";
import { getEffectivePermissions, invalidatePermissionCache, PERMISSION_KEYS } from "../lib/permissions";
import { usersTable } from "@workspace/db";
import { logAudit } from "../lib/audit";

const router = Router();

const PERM_KEYS = PERMISSION_KEYS;

router.get("/users/:id/permissions", requireAuth, requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  // Always the user's real role (a client-supplied role would misreport).
  const [u] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  if (!u) { res.status(404).json({ error: "Not found" }); return; }
  const role = u.role;
  const effective = await getEffectivePermissions(userId, role);
  const [override] = await db
    .select()
    .from(userPermissionsTable)
    .where(eq(userPermissionsTable.userId, userId));
  res.json({ userId, role, effective, override: override ?? null });
});

router.put("/users/:id/permissions", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const userId = Number(req.params.id);
  const body = req.body ?? {};
  const patch: Record<string, boolean | null> = {};

  for (const key of PERM_KEYS) {
    if (body[key] === null) patch[key] = null;
    else if (typeof body[key] === "boolean") patch[key] = body[key];
  }

  void logAudit({ actorId: req.user?.id, action: "permissions.user_changed", entityType: "user", entityId: userId, details: patch });

  const [existing] = await db
    .select()
    .from(userPermissionsTable)
    .where(eq(userPermissionsTable.userId, userId));

  if (existing) {
    const [row] = await db
      .update(userPermissionsTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(userPermissionsTable.userId, userId))
      .returning();
    invalidatePermissionCache();
    res.json(row);
    return;
  }

  const [row] = await db
    .insert(userPermissionsTable)
    .values({ userId, ...patch })
    .returning();
  invalidatePermissionCache();
  res.json(row);
});

router.get("/me/permissions", requireAuth, async (req: AuthRequest, res) => {
  const perms = await getEffectivePermissions(req.user!.id, req.user!.role);
  res.json(perms);
});

export default router;
