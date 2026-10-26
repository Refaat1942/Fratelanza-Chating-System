import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { outboundEnabled } from "../lib/outbound";

const router = Router();

/** What this server is allowed to do — the UI adapts (e.g. note-only composer). */
router.get("/system", requireAuth, (_req, res) => {
  res.json({ outboundEnabled: outboundEnabled() });
});

export default router;
