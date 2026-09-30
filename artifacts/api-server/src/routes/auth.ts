import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable, passwordResetTokensTable } from "@workspace/db";
import { requireAuth, AuthRequest, JWT_SECRET } from "../middlewares/auth";
import { hit, clear } from "../lib/rate-limit";
import { hashToken, validatePassword } from "../lib/passwords";

const router = Router();

function safeUser<T extends { passwordHash: string }>(u: T) {
  const { passwordHash: _omit, ...rest } = u;
  return rest;
}

router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body ?? {};

  if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  // Case-insensitive match: "Ahmed@x.com" and "ahmed@x.com" are one account.
  const login = email.trim().toLowerCase();
  const key = `login:${login}:${req.ip}`;
  if (!hit(key, 10, 15 * 60_000)) {
    res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(sql`lower(${usersTable.email}) = ${login}`)
    .limit(1);
  // Same response for unknown user / wrong password (no account probing).
  const valid = user ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!user || !valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  if (!user.isActive) {
    res.status(403).json({ error: "This account has been deactivated. Contact your administrator." });
    return;
  }

  clear(key);
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, user: safeUser(user) });
});

router.get("/auth/me", requireAuth, (req: AuthRequest, res) => {
  res.json(safeUser(req.user!));
});

// Logged-in user changes their own password (also used for forced change).
router.post("/auth/change-password", requireAuth, async (req: AuthRequest, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  const user = req.user!;
  if (!hit(`chpw:${user.id}`, 10, 15 * 60_000)) {
    res.status(429).json({ error: "Too many attempts. Try again later." });
    return;
  }
  if (typeof currentPassword !== "string" || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    res.status(400).json({ error: "Current password is incorrect" });
    return;
  }
  const bad = validatePassword(newPassword);
  if (bad) {
    res.status(400).json({ error: bad });
    return;
  }
  if (newPassword === currentPassword) {
    res.status(400).json({ error: "New password must be different" });
    return;
  }
  await db
    .update(usersTable)
    .set({ passwordHash: await bcrypt.hash(newPassword, 10), mustChangePassword: false })
    .where(eq(usersTable.id, user.id));
  res.json({ ok: true });
});

// Public: consume a one-time reset token issued by an administrator.
router.post("/auth/reset-password", async (req, res) => {
  const { token, newPassword } = req.body ?? {};
  if (!hit(`reset:${req.ip}`, 20, 15 * 60_000)) {
    res.status(429).json({ error: "Too many attempts. Try again later." });
    return;
  }
  if (typeof token !== "string" || token.length < 20) {
    res.status(400).json({ error: "Invalid or expired reset link" });
    return;
  }
  const bad = validatePassword(newPassword);
  if (bad) {
    res.status(400).json({ error: bad });
    return;
  }
  const tokenHash = hashToken(token);
  const passwordHash = await bcrypt.hash(newPassword, 10);

  // Atomic single-use: only one request can flip usedAt from NULL.
  const ok = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(passwordResetTokensTable)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(passwordResetTokensTable.tokenHash, tokenHash),
          isNull(passwordResetTokensTable.usedAt),
          gt(passwordResetTokensTable.expiresAt, new Date()),
        ),
      )
      .returning({ userId: passwordResetTokensTable.userId });
    if (!row) return false;
    await tx
      .update(usersTable)
      .set({ passwordHash, mustChangePassword: false })
      .where(eq(usersTable.id, row.userId));
    // Invalidate any other outstanding links for this user.
    await tx
      .update(passwordResetTokensTable)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokensTable.userId, row.userId), isNull(passwordResetTokensTable.usedAt)));
    return true;
  });

  if (!ok) {
    res.status(400).json({ error: "Invalid or expired reset link" });
    return;
  }
  res.json({ ok: true });
});

export default router;
