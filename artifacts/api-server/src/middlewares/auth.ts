import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const JWT_SECRET_RAW = process.env["JWT_SECRET"];

if (!JWT_SECRET_RAW) {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("JWT_SECRET environment variable is required in production");
  }
  // In development, log a warning but allow startup with a generated secret
  process.stderr.write("[WARN] JWT_SECRET is not set — using insecure development secret. Set JWT_SECRET in .env for consistent sessions.\n");
}

export const JWT_SECRET = JWT_SECRET_RAW ?? "dev-only-secret-not-for-production";

export interface AuthRequest extends Request {
  user?: typeof usersTable.$inferSelect;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: number };
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId));
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }
    if (!user.isActive) {
      res.status(401).json({ error: "Account disabled" });
      return;
    }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

export function requireAgent(req: AuthRequest, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role !== "agent" && role !== "admin") {
    res.status(403).json({ error: "Agent access required" });
    return;
  }
  next();
}
