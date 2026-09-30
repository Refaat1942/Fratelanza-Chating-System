import { Router } from "express";
import { requireAuth, requireAdmin, AuthRequest } from "../middlewares/auth";
import { getSettings, updateSettings, drainQueue } from "../lib/assignment";
import type { Server as IOServer } from "socket.io";

const router = Router();

router.get("/settings", requireAuth, async (_req, res) => {
  const settings = await getSettings();
  res.json(settings);
});

// Public endpoint — exposes only branding fields so the login page can render
// the company name + logo without needing an auth token.
router.get("/branding", async (_req, res) => {
  const settings = await getSettings();
  res.json({
    companyName: settings.companyName,
    logoUrl: settings.logoUrl,
    primaryColor: settings.primaryColor,
    accentColor: settings.accentColor,
  });
});

router.put("/settings", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const { maxChatsPerAgent, autoAssign, assignmentStrategy, companyName, logoUrl, slaMinutes, primaryColor, accentColor } = req.body ?? {};
  const patch: Record<string, unknown> = {};

  if (maxChatsPerAgent !== undefined) {
    const n = Number(maxChatsPerAgent);
    if (!Number.isFinite(n) || n < 1 || n > 100) {
      res.status(400).json({ error: "maxChatsPerAgent must be between 1 and 100" });
      return;
    }
    patch.maxChatsPerAgent = n;
  }

  if (autoAssign !== undefined) patch.autoAssign = !!autoAssign;

  if (assignmentStrategy !== undefined) {
    if (!["round_robin", "least_busy"].includes(assignmentStrategy)) {
      res.status(400).json({ error: "assignmentStrategy must be 'round_robin' or 'least_busy'" });
      return;
    }
    patch.assignmentStrategy = assignmentStrategy;
  }

  if (companyName !== undefined) {
    const s = String(companyName).trim();
    if (s.length < 1 || s.length > 80) {
      res.status(400).json({ error: "companyName must be 1-80 characters" });
      return;
    }
    patch.companyName = s;
  }

  if (logoUrl !== undefined) {
    // null/"" clears the logo. Otherwise only raster images or SVG delivered as
    // a base64 data URL (rendered via <img>, so SVG scripts can never run).
    if (logoUrl === null || logoUrl === "") {
      patch.logoUrl = null;
    } else {
      const s = String(logoUrl);
      if (s.length > 700_000) {
        res.status(400).json({ error: "Logo too large (max ~500KB)" });
        return;
      }
      const m = /^data:image\/(png|jpeg|webp|svg\+xml);base64,([A-Za-z0-9+/=]+)$/.exec(s);
      if (!m) {
        res.status(400).json({ error: "Logo must be a PNG, JPG, WEBP or SVG image" });
        return;
      }
      if (m[1] === "svg+xml") {
        const svg = Buffer.from(m[2], "base64").toString("utf8");
        if (/<script|on\w+\s*=|javascript:|<foreignObject/i.test(svg)) {
          res.status(400).json({ error: "SVG contains unsafe content" });
          return;
        }
      }
      patch.logoUrl = s;
    }
  }

  for (const [key, val] of [["primaryColor", primaryColor], ["accentColor", accentColor]] as const) {
    if (val === undefined) continue;
    if (val === null || val === "") {
      patch[key] = null;
    } else if (typeof val === "string" && /^#[0-9a-fA-F]{6}$/.test(val)) {
      patch[key] = val.toLowerCase();
    } else {
      res.status(400).json({ error: `${key} must be a hex colour like #0a7d5a` });
      return;
    }
  }

  if (slaMinutes !== undefined) {
    const n = Number(slaMinutes);
    if (!Number.isFinite(n) || n < 1 || n > 1440) {
      res.status(400).json({ error: "slaMinutes must be between 1 and 1440" });
      return;
    }
    patch.slaMinutes = n;
  }

  const updated = await updateSettings(patch);

  // If auto-assign was enabled / capacity raised, drain the queue immediately.
  const io = req.app.get("io") as IOServer | undefined;
  if (updated.autoAssign) {
    void drainQueue(io);
  }

  res.json(updated);
});

export default router;
