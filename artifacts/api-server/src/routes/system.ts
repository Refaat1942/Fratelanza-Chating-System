import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { outboundEnabled } from "../lib/outbound";
import { whatsappSendingConfigured } from "../lib/whatsapp";
import { webhookStats } from "../lib/webhook-stats";
import type { AuthRequest } from "../middlewares/auth";

const router = Router();

/** What this server is allowed to do — the UI adapts (e.g. note-only composer). */
router.get("/system", requireAuth, (req: AuthRequest, res) => {
  const base = { outboundEnabled: outboundEnabled(), sendingConfigured: whatsappSendingConfigured() };
  // Delivery diagnostics are for admins only.
  res.json(req.user?.role === "admin" ? { ...base, webhooks: webhookStats() } : base);
});

export default router;
