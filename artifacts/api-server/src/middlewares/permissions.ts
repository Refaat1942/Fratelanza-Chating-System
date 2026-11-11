import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth";
import { hasPermission, PermissionKey } from "../lib/permissions";

export function requirePermission(key: PermissionKey) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const role = req.user.role;
    const allowed = await hasPermission(req.user.id, role, key);
    if (!allowed) {
      res.status(403).json({ error: `Permission denied: ${key}` });
      return;
    }
    next();
  };
}
