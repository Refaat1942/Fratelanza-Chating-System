import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";

const router = Router();

/**
 * AI-style insights powered by deterministic SQL aggregations.
 * No external LLM call — fast, free, and explainable.
 *
 * Returns four widgets the inbox/dashboard can render:
 *   - unrepliedChats   : open conversations whose last sender is the customer
 *   - urgentChats      : unreplied chats that have crossed the SLA threshold
 *   - mostActive       : top 5 customers by message volume in the last 7 days
 *   - avgReplyMinutes  : rolling 7-day average first-response time
 */
router.get("/insights", requireAuth, async (req: AuthRequest, res) => {
  // Authorization scope: admins see organization-wide insights; agents see
  // only conversations + customers tied to chats assigned to them. Without
  // this, the endpoint would leak PII (names, phones, branches) for the
  // entire customer base to every authenticated agent.
  const isAdmin = req.user!.role === "admin";
  const userId = req.user!.id;

  // Read SLA threshold from settings (fallback to 15 min)
  const slaRow = await db.execute(sql`
    SELECT sla_minutes FROM settings WHERE id = 1 LIMIT 1
  `);
  const slaMinutes = Number(
    (slaRow.rows[0] as { sla_minutes?: number } | undefined)?.sla_minutes ?? 15,
  );

  // Drizzle's sql.empty() returns a SQL fragment that's a no-op (renders as
  // nothing) — we use it to add a per-role filter only when needed.
  const agentScope = isAdmin
    ? sql.empty()
    : sql` AND c.assigned_agent_id = ${userId}`;

  // 1) Unreplied chats — customer was the last to speak, status is open
  const unrepliedResult = await db.execute(sql`
    SELECT
      c.id,
      c.customer_id,
      cu.name as customer_name,
      cu.phone,
      c.channel,
      c.last_message,
      c.last_message_at,
      c.assigned_agent_id,
      u.name as agent_name,
      EXTRACT(EPOCH FROM (NOW() - c.last_message_at)) / 60 as minutes_waiting
    FROM conversations c
    JOIN customers cu ON cu.id = c.customer_id
    LEFT JOIN users u ON u.id = c.assigned_agent_id
    WHERE c.status = 'open'
      AND c.last_sender_type = 'customer'
      AND c.last_message_at IS NOT NULL
      ${agentScope}
    ORDER BY c.last_message_at ASC
    LIMIT 50
  `);

  const unrepliedChats = unrepliedResult.rows.map((row) => {
    const r = row as Record<string, string | number | Date | null>;
    const mins = Math.max(0, Math.round(Number(r.minutes_waiting ?? 0)));
    return {
      conversationId: Number(r.id),
      customerId: Number(r.customer_id),
      customerName: String(r.customer_name),
      phone: String(r.phone ?? ""),
      channel: r.channel ? String(r.channel) : "whatsapp",
      lastMessage: r.last_message ? String(r.last_message) : "",
      lastMessageAt:
        r.last_message_at instanceof Date
          ? r.last_message_at.toISOString()
          : r.last_message_at
            ? String(r.last_message_at)
            : null,
      agentName: r.agent_name ? String(r.agent_name) : null,
      minutesWaiting: mins,
      severity:
        mins >= slaMinutes * 4
          ? "critical"
          : mins >= slaMinutes * 2
            ? "high"
            : mins >= slaMinutes
              ? "medium"
              : "normal",
    };
  });

  const urgentChats = unrepliedChats.filter(
    (c) => c.severity === "critical" || c.severity === "high",
  );

  // 2) Most active customers (last 7 days, by message count) — scoped
  const activeResult = await db.execute(sql`
    SELECT
      cu.id as customer_id,
      cu.name as customer_name,
      cu.phone,
      cu.branch,
      COUNT(m.id)::int as message_count,
      COUNT(DISTINCT c.id)::int as conversation_count,
      MAX(m.created_at) as last_seen
    FROM customers cu
    JOIN conversations c ON c.customer_id = cu.id
    JOIN messages m ON m.conversation_id = c.id
    WHERE m.created_at >= NOW() - INTERVAL '7 days'
      ${agentScope}
    GROUP BY cu.id, cu.name, cu.phone, cu.branch
    ORDER BY message_count DESC
    LIMIT 5
  `);

  const mostActive = activeResult.rows.map((row) => {
    const r = row as Record<string, string | number | Date | null>;
    return {
      customerId: Number(r.customer_id),
      customerName: String(r.customer_name),
      phone: String(r.phone ?? ""),
      branch: r.branch ? String(r.branch) : null,
      messageCount: Number(r.message_count),
      conversationCount: Number(r.conversation_count),
      lastSeenAt:
        r.last_seen instanceof Date
          ? r.last_seen.toISOString()
          : r.last_seen
            ? String(r.last_seen)
            : null,
    };
  });

  // 3) Rolling 7-day average first response time (scoped)
  const frtResult = await db.execute(sql`
    SELECT AVG(EXTRACT(EPOCH FROM (m.created_at - c.created_at)) / 60) as avg_minutes
    FROM conversations c
    JOIN LATERAL (
      SELECT created_at FROM messages
      WHERE conversation_id = c.id AND sender_type = 'agent'
      ORDER BY created_at ASC LIMIT 1
    ) m ON true
    WHERE c.created_at >= NOW() - INTERVAL '7 days'
      ${agentScope}
  `);
  const avgReplyMinutes = (() => {
    const v = (frtResult.rows[0] as { avg_minutes?: string | null })
      ?.avg_minutes;
    return v == null ? 0 : Math.round(Number(v) * 10) / 10;
  })();

  // 4) Channel breakdown for active chats (scoped — powers the sidebar pills)
  const channelResult = await db.execute(sql`
    SELECT c.channel, COUNT(*)::int as count
    FROM conversations c
    WHERE c.status IN ('open', 'pending')
      ${agentScope}
    GROUP BY c.channel
  `);
  const channelCounts: Record<string, number> = {};
  for (const row of channelResult.rows) {
    const r = row as { channel?: string; count?: number };
    if (r.channel) channelCounts[r.channel] = Number(r.count ?? 0);
  }

  // 5) Chat age — how many days since the last message, split by who owes a reply
  const ageRows = await db.execute(sql`
    SELECT
      CASE WHEN c.last_sender_type = 'customer' THEN 'us' ELSE 'customer' END AS waiting_on,
      CASE
        WHEN d < 1 THEN 'today'
        WHEN d < 4 THEN '1-3'
        WHEN d < 8 THEN '4-7'
        WHEN d < 31 THEN '8-30'
        ELSE '30+'
      END AS bucket,
      COUNT(*)::int AS count
    FROM (
      SELECT c.*, EXTRACT(EPOCH FROM (NOW() - c.last_message_at)) / 86400 AS d
      FROM conversations c
      WHERE c.status <> 'completed' AND c.last_message_at IS NOT NULL ${agentScope}
    ) c
    GROUP BY 1, 2
  `);
  const BUCKETS = ["today", "1-3", "4-7", "8-30", "30+"] as const;
  const emptyBuckets = () => BUCKETS.map((b) => ({ bucket: b, count: 0 }));
  const waitingOnUs = emptyBuckets();
  const waitingOnCustomer = emptyBuckets();
  for (const row of ageRows.rows) {
    const r = row as { waiting_on: string; bucket: string; count: number };
    const list = r.waiting_on === "us" ? waitingOnUs : waitingOnCustomer;
    const slot = list.find((x) => x.bucket === r.bucket);
    if (slot) slot.count = Number(r.count);
  }

  const topicRows = await db.execute(sql`
    SELECT
      cr.id AS topic_id,
      COALESCE(cr.name_en, 'Unsorted') AS name,
      COALESCE(cr.color, '#94A3B8') AS color,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE c.status <> 'completed')::int AS active,
      COUNT(*) FILTER (WHERE c.status <> 'completed' AND c.last_sender_type = 'customer')::int AS waiting_on_us,
      COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - c.last_message_at)) / 86400)
        FILTER (WHERE c.status <> 'completed'), 0) AS avg_days
    FROM conversations c
    LEFT JOIN chat_reasons cr ON cr.id = c.chat_reason_id
    WHERE c.last_message_at IS NOT NULL ${agentScope}
    GROUP BY cr.id, cr.name_en, cr.color
    ORDER BY active DESC, total DESC
  `);
  const byTopic = topicRows.rows.map((row) => {
    const r = row as Record<string, string | number | null>;
    return {
      topicId: r.topic_id === null ? null : Number(r.topic_id),
      name: String(r.name),
      color: String(r.color),
      total: Number(r.total),
      active: Number(r.active),
      waitingOnUs: Number(r.waiting_on_us),
      avgDaysSinceLast: Math.round(Number(r.avg_days) * 10) / 10,
    };
  });

  const oldestRows = await db.execute(sql`
    SELECT c.id, cu.name AS customer_name, cu.phone, c.last_message, c.last_message_at,
           cr.name_en AS topic, cr.color AS topic_color,
           EXTRACT(EPOCH FROM (NOW() - c.last_message_at)) / 86400 AS days
    FROM conversations c
    JOIN customers cu ON cu.id = c.customer_id
    LEFT JOIN chat_reasons cr ON cr.id = c.chat_reason_id
    WHERE c.status <> 'completed' AND c.last_sender_type = 'customer' AND c.last_message_at IS NOT NULL ${agentScope}
    ORDER BY c.last_message_at ASC
    LIMIT 10
  `);
  const oldestWaiting = oldestRows.rows.map((row) => {
    const r = row as Record<string, string | number | Date | null>;
    return {
      conversationId: Number(r.id),
      customerName: String(r.customer_name),
      phone: String(r.phone ?? ""),
      lastMessage: r.last_message ? String(r.last_message) : "",
      lastMessageAt: r.last_message_at instanceof Date ? r.last_message_at.toISOString() : r.last_message_at ? String(r.last_message_at) : null,
      topic: r.topic ? String(r.topic) : null,
      topicColor: r.topic_color ? String(r.topic_color) : null,
      daysWaiting: Math.floor(Number(r.days)),
    };
  });

  res.json({
    aging: { waitingOnUs, waitingOnCustomer, byTopic, oldestWaiting },
    slaMinutes,
    summary: {
      unrepliedCount: unrepliedChats.length,
      urgentCount: urgentChats.length,
      avgReplyMinutes,
      mostActiveCount: mostActive.length,
    },
    unrepliedChats,
    urgentChats,
    mostActive,
    channelCounts,
    generatedAt: new Date().toISOString(),
  });
});

export default router;
