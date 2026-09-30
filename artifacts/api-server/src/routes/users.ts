import { Router } from "express";
import bcrypt from "bcryptjs";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable, passwordResetTokensTable } from "@workspace/db";
import { requireAuth, requireAdmin, AuthRequest } from "../middlewares/auth";
import { drainQueue } from "../lib/assignment";
import { newResetToken, validatePassword } from "../lib/passwords";
import type { Server as IOServer } from "socket.io";

const router = Router();

const publicUserCols = {
  id: usersTable.id,
  name: usersTable.name,
  displayName: usersTable.displayName,
  email: usersTable.email,
  role: usersTable.role,
  status: usersTable.status,
  isActive: usersTable.isActive,
  mustChangePassword: usersTable.mustChangePassword,
  createdAt: usersTable.createdAt,
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESET_TTL_MS = 60 * 60 * 1000;

async function emailTaken(email: string, exceptId?: number): Promise<boolean> {
  const conds = [sql`lower(${usersTable.email}) = ${email.toLowerCase()}`];
  if (exceptId !== undefined) conds.push(ne(usersTable.id, exceptId));
  const [row] = await db.select({ id: usersTable.id }).from(usersTable).where(and(...conds)).limit(1);
  return !!row;
}

async function activeAdminCount(exceptId?: number): Promise<number> {
  const conds = [eq(usersTable.role, "admin"), eq(usersTable.isActive, true)];
  if (exceptId !== undefined) conds.push(ne(usersTable.id, exceptId));
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(usersTable)
    .where(and(...conds));
  return n;
}

router.get("/users", requireAuth, async (req: AuthRequest, res) => {
  const rows = await db.select(publicUserCols).from(usersTable).orderBy(usersTable.createdAt);
  // Agents only need names (assignment pickers); emails stay admin-only.
  if (req.user?.role !== "admin") {
    res.json(rows.map((u) => ({ ...u, email: "" })));
    return;
  }
  res.json(rows);
});

router.post("/users", requireAuth, requireAdmin, async (req, res) => {
  const { name, displayName, email, password, role } = req.body ?? {};
  if (typeof name !== "string" || !name.trim() || typeof email !== "string" || !email.trim()) {
    res.status(400).json({ error: "Full name and email are required" });
    return;
  }
  const cleanEmail = email.trim().toLowerCase();
  if (!EMAIL_RE.test(cleanEmail)) {
    res.status(400).json({ error: "Enter a valid email address" });
    return;
  }
  if (role !== "admin" && role !== "agent") {
    res.status(400).json({ error: "Role must be admin or agent" });
    return;
  }
  const bad = validatePassword(password);
  if (bad) {
    res.status(400).json({ error: bad });
    return;
  }
  if (await emailTaken(cleanEmail)) {
    res.status(409).json({ error: "A user with this email already exists" });
    return;
  }
  const [user] = await db
    .insert(usersTable)
    .values({
      name: name.trim(),
      displayName: typeof displayName === "string" && displayName.trim() ? displayName.trim() : null,
      email: cleanEmail,
      passwordHash: await bcrypt.hash(password, 10),
      role,
      // An admin-chosen password is temporary: the user picks their own at first login.
      mustChangePassword: true,
    })
    .returning(publicUserCols);
  res.status(201).json(user);
});

// IMPORTANT: must come before /users/:id so "me" isn't parsed as an id
router.patch("/users/me/status", requireAuth, async (req: AuthRequest, res) => {
  const { status } = req.body ?? {};
  if (!["available", "busy", "offline"].includes(status)) {
    res.status(400).json({ error: "status must be 'available' | 'busy' | 'offline'" });
    return;
  }
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [user] = await db
    .update(usersTable)
    .set({ status })
    .where(eq(usersTable.id, req.user.id))
    .returning(publicUserCols);

  // Going back online → try to pull queued chats to this agent (and others).
  if (status === "available") {
    const io = req.app.get("io") as IOServer | undefined;
    void drainQueue(io);
  }

  res.json(user);
});

router.get("/users/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const [user] = await db.select(publicUserCols).from(usersTable).where(eq(usersTable.id, id));
  if (!user) { res.status(404).json({ error: "Not found" }); return; }
  res.json(user);
});

router.put("/users/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, displayName, email, role, password } = req.body ?? {};
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "Full name cannot be empty" });
      return;
    }
    updates.name = name.trim();
  }
  if (displayName !== undefined) {
    updates.displayName = typeof displayName === "string" && displayName.trim() ? displayName.trim() : null;
  }
  if (email !== undefined) {
    const e = String(email).trim().toLowerCase();
    if (!EMAIL_RE.test(e)) { res.status(400).json({ error: "Enter a valid email address" }); return; }
    if (e !== existing.email.toLowerCase() && (await emailTaken(e, id))) {
      res.status(409).json({ error: "A user with this email already exists" });
      return;
    }
    updates.email = e;
  }
  if (role !== undefined) {
    if (role !== "admin" && role !== "agent") {
      res.status(400).json({ error: "Role must be admin or agent" });
      return;
    }
    if (role !== existing.role && existing.role === "admin" && (await activeAdminCount(id)) === 0) {
      res.status(400).json({ error: "You cannot remove the last active administrator" });
      return;
    }
    updates.role = role;
  }
  if (password) {
    const bad = validatePassword(password);
    if (bad) { res.status(400).json({ error: bad }); return; }
    updates.passwordHash = await bcrypt.hash(password, 10);
    // Admin-set password is temporary unless the admin is changing their own.
    updates.mustChangePassword = req.user?.id !== id;
  }
  if (Object.keys(updates).length === 0) {
    const [same] = await db.select(publicUserCols).from(usersTable).where(eq(usersTable.id, id));
    res.json(same);
    return;
  }
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning(publicUserCols);
  res.json(user);
});

// Activate / deactivate (soft — keeps the user's conversations and history).
router.patch("/users/:id/active", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const { isActive } = req.body ?? {};
  if (!Number.isInteger(id) || typeof isActive !== "boolean") {
    res.status(400).json({ error: "isActive (boolean) is required" });
    return;
  }
  if (req.user?.id === id && !isActive) {
    res.status(400).json({ error: "You cannot deactivate your own account" });
    return;
  }
  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!target) { res.status(404).json({ error: "Not found" }); return; }
  if (!isActive && target.role === "admin" && (await activeAdminCount(id)) === 0) {
    res.status(400).json({ error: "You cannot deactivate the last active administrator" });
    return;
  }
  const [user] = await db
    .update(usersTable)
    .set(isActive ? { isActive: true } : { isActive: false, status: "offline" })
    .where(eq(usersTable.id, id))
    .returning(publicUserCols);
  // An agent leaving the pool frees their chats for redistribution.
  if (!isActive) {
    const io = req.app.get("io") as IOServer | undefined;
    void drainQueue(io);
  }
  res.json(user);
});

// Admin issues a one-time reset link (valid 1 hour). The token is returned
// ONCE in this response and only its hash is stored; it is never logged.
router.post("/users/:id/reset-link", requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const [target] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, id));
  if (!target) { res.status(404).json({ error: "Not found" }); return; }
  const { token, hash } = newResetToken();
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);
  await db.insert(passwordResetTokensTable).values({ userId: id, tokenHash: hash, expiresAt });
  res.json({ token, expiresAt });
});

router.delete("/users/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (req.user?.id === id) {
    res.status(400).json({ error: "Cannot delete yourself" });
    return;
  }
  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!target) { res.status(404).json({ error: "Not found" }); return; }
  if (target.role === "admin" && (await activeAdminCount(id)) === 0) {
    res.status(400).json({ error: "You cannot delete the last active administrator" });
    return;
  }
  try {
    await db.delete(usersTable).where(eq(usersTable.id, id));
  } catch {
    // Users referenced by conversations/messages cannot be deleted — deactivate instead.
    res.status(409).json({ error: "This user has conversation history and cannot be deleted. Deactivate them instead." });
    return;
  }
  res.status(204).send();
});

export default router;
