import { Router } from "express";
import { db } from "@workspace/db";
import {
  conversationsTable,
  messagesTable,
  usersTable,
  customersTable,
} from "@workspace/db";
import { eq, and, gte, sql, count } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission } from "../middlewares/permissions";

const router = Router();

// Scope to the reporting endpoints only. (A bare router.use() here used to apply to EVERY route
// registered after this router: /branding was login-protected and /me, /insights, /settings
// required the reports permission, which agents do not have.)
router.use(["/analytics", "/reports"], requireAuth, requirePermission("canViewReports"));

// ----- helpers -----
type DateRange = { from: Date; to: Date };

function parseRange(req: { query: Record<string, unknown> }): DateRange {
  const safeDate = (v: unknown, fallback: Date): Date => {
    if (!v) return fallback;
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? fallback : d;
  };
  const now = new Date();
  const to = safeDate(req.query.to, now);
  const from = safeDate(
    req.query.from,
    new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000),
  );
  // include the entire 'to' day
  const toEnd = new Date(to);
  toEnd.setHours(23, 59, 59, 999);
  return { from, to: toEnd };
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '""';
  const s = String(v).replace(/"/g, '""');
  return `"${s}"`;
}

function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const headerLine = headers.map(csvEscape).join(",");
  const dataLines = rows.map((r) =>
    headers.map((h) => csvEscape(r[h])).join(","),
  );
  return [headerLine, ...dataLines].join("\n");
}

// =====================================================
// Existing endpoints (kept for backward compatibility)
// =====================================================

router.get("/analytics/summary", async (_req, res) => {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [totalConvRow] = await db.select({ count: count() }).from(conversationsTable);
  const [activeRow] = await db.select({ count: count() }).from(conversationsTable).where(eq(conversationsTable.status, "open"));
  const [resolvedRow] = await db.select({ count: count() }).from(conversationsTable).where(
    and(eq(conversationsTable.status, "completed"), gte(conversationsTable.resolvedAt, startOfDay))
  );
  const [pendingRow] = await db.select({ count: count() }).from(conversationsTable).where(eq(conversationsTable.status, "pending"));
  const [newTodayRow] = await db.select({ count: count() }).from(conversationsTable).where(gte(conversationsTable.createdAt, startOfDay));
  const [totalCustomersRow] = await db.select({ count: count() }).from(customersTable);
  const [totalAgentsRow] = await db.select({ count: count() }).from(usersTable).where(eq(usersTable.role, "agent"));
  const [agentsAvailableRow] = await db.select({ count: count() }).from(usersTable).where(
    and(eq(usersTable.role, "agent"), eq(usersTable.status, "available")),
  );

  const avgResult = await db.execute(sql`
    SELECT AVG(EXTRACT(EPOCH FROM (m.created_at - c.created_at)) / 60) as avg_minutes
    FROM conversations c
    JOIN messages m ON m.conversation_id = c.id AND m.sender_type = 'agent'
    WHERE m.id = (
      SELECT id FROM messages WHERE conversation_id = c.id AND sender_type = 'agent' ORDER BY created_at ASC LIMIT 1
    )
  `);

  const avgMinutes = (avgResult.rows[0] as { avg_minutes: string | null })?.avg_minutes;

  res.json({
    totalConversations: Number(totalConvRow.count),
    activeChats: Number(activeRow.count),
    resolvedChats: Number(resolvedRow.count),
    avgResponseTimeMinutes: avgMinutes ? Math.round(Number(avgMinutes) * 10) / 10 : 0,
    openConversations: Number(activeRow.count) + Number(pendingRow.count),
    newConversationsToday: Number(newTodayRow.count),
    totalCustomers: Number(totalCustomersRow.count),
    totalAgents: Number(totalAgentsRow.count),
    agentsAvailable: Number(agentsAvailableRow.count),
    pendingChats: Number(pendingRow.count),
  });
});

router.get("/analytics/chats-over-time", async (_req, res) => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const result = await db.execute(sql`
    SELECT DATE(created_at) as date, COUNT(*) as count
    FROM conversations
    WHERE created_at >= ${thirtyDaysAgo.toISOString()}
    GROUP BY DATE(created_at)
    ORDER BY DATE(created_at) ASC
  `);

  res.json(result.rows.map((r: { date: Date | string; count: string }) => ({
    date: r.date instanceof Date ? r.date.toISOString().split("T")[0] : String(r.date),
    count: Number(r.count),
  })));
});

router.get("/analytics/agent-performance", async (_req, res) => {
  const result = await db.execute(sql`
    SELECT
      u.id as agent_id,
      u.name as agent_name,
      COUNT(DISTINCT c.id) as total_handled,
      COUNT(DISTINCT CASE WHEN c.status = 'completed' THEN c.id END) as resolved,
      COUNT(DISTINCT CASE WHEN c.status = 'open' THEN c.id END) as active_chats,
      AVG(CASE
        WHEN m.created_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (m.created_at - c.created_at)) / 60
        ELSE NULL
      END) as avg_response_time
    FROM users u
    LEFT JOIN conversations c ON c.assigned_agent_id = u.id
    LEFT JOIN LATERAL (
      SELECT created_at FROM messages
      WHERE conversation_id = c.id AND sender_type = 'agent'
      ORDER BY created_at ASC LIMIT 1
    ) m ON true
    WHERE u.role = 'agent'
    GROUP BY u.id, u.name
    ORDER BY total_handled DESC
  `);

  res.json(result.rows.map((r: {
    agent_id: number; agent_name: string;
    total_handled: string; resolved: string;
    active_chats: string; avg_response_time: string | null;
  }) => ({
    agentId: Number(r.agent_id),
    agentName: r.agent_name,
    totalHandled: Number(r.total_handled),
    resolved: Number(r.resolved),
    activeChats: Number(r.active_chats),
    avgResponseTimeMinutes: r.avg_response_time ? Math.round(Number(r.avg_response_time) * 10) / 10 : 0,
  })));
});

router.get("/analytics/recent-activity", async (_req, res) => {
  const result = await db.execute(sql`
    (SELECT
      CONCAT('conv-', c.id) as id,
      'conversation_created' as type,
      CONCAT('New conversation started with ', cu.name) as description,
      NULL as agent_name,
      cu.name as customer_name,
      c.created_at
    FROM conversations c
    JOIN customers cu ON c.customer_id = cu.id
    ORDER BY c.created_at DESC LIMIT 5)

    UNION ALL

    (SELECT
      CONCAT('res-', c.id) as id,
      'conversation_resolved' as type,
      CONCAT('Conversation with ', cu.name, ' completed') as description,
      u.name as agent_name,
      cu.name as customer_name,
      c.resolved_at as created_at
    FROM conversations c
    JOIN customers cu ON c.customer_id = cu.id
    LEFT JOIN users u ON u.id = c.assigned_agent_id
    WHERE c.status = 'completed' AND c.resolved_at IS NOT NULL
    ORDER BY c.resolved_at DESC LIMIT 5)

    UNION ALL

    (SELECT
      CONCAT('msg-', m.id) as id,
      'message_sent' as type,
      CONCAT(u.name, ' sent a message') as description,
      u.name as agent_name,
      NULL as customer_name,
      m.created_at
    FROM messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.sender_type = 'agent'
    ORDER BY m.created_at DESC LIMIT 5)

    ORDER BY created_at DESC LIMIT 20
  `);

  res.json(result.rows.map((r: {
    id: string; type: string; description: string;
    agent_name: string | null; customer_name: string | null; created_at: Date;
  }) => ({
    id: r.id,
    type: r.type,
    description: r.description,
    agentName: r.agent_name,
    customerName: r.customer_name,
    createdAt: r.created_at,
  })));
});

// =====================================================
// New comprehensive reports (date-range aware)
// =====================================================

// 1) Real-time overview KPIs (used by KPI cards, refreshes often)
router.get("/reports/overview", async (_req, res) => {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - 7);

  const [openRow] = await db.select({ count: count() }).from(conversationsTable).where(eq(conversationsTable.status, "open"));
  const [pendingRow] = await db.select({ count: count() }).from(conversationsTable).where(eq(conversationsTable.status, "pending"));
  const [resolvedTodayRow] = await db.select({ count: count() }).from(conversationsTable).where(
    and(eq(conversationsTable.status, "completed"), gte(conversationsTable.resolvedAt, startOfDay)),
  );
  const [resolvedWeekRow] = await db.select({ count: count() }).from(conversationsTable).where(
    and(eq(conversationsTable.status, "completed"), gte(conversationsTable.resolvedAt, startOfWeek)),
  );
  const [newTodayRow] = await db.select({ count: count() }).from(conversationsTable).where(gte(conversationsTable.createdAt, startOfDay));
  const [agentsOnlineRow] = await db.select({ count: count() }).from(usersTable).where(
    and(eq(usersTable.role, "agent"), eq(usersTable.status, "available")),
  );
  const [agentsBusyRow] = await db.select({ count: count() }).from(usersTable).where(
    and(eq(usersTable.role, "agent"), eq(usersTable.status, "busy")),
  );
  const [agentsTotalRow] = await db.select({ count: count() }).from(usersTable).where(eq(usersTable.role, "agent"));

  const frtTodayResult = await db.execute(sql`
    SELECT AVG(EXTRACT(EPOCH FROM (m.created_at - c.created_at)) / 60) as avg_minutes
    FROM conversations c
    JOIN LATERAL (
      SELECT created_at FROM messages
      WHERE conversation_id = c.id AND sender_type = 'agent'
      ORDER BY created_at ASC LIMIT 1
    ) m ON true
    WHERE c.created_at >= ${startOfDay.toISOString()}
  `);
  const avgFrt = (frtTodayResult.rows[0] as { avg_minutes: string | null })?.avg_minutes;

  res.json({
    openChats: Number(openRow.count),
    pendingChats: Number(pendingRow.count),
    resolvedToday: Number(resolvedTodayRow.count),
    resolvedThisWeek: Number(resolvedWeekRow.count),
    newToday: Number(newTodayRow.count),
    agentsOnline: Number(agentsOnlineRow.count),
    agentsBusy: Number(agentsBusyRow.count),
    agentsTotal: Number(agentsTotalRow.count),
    avgFirstResponseTodayMinutes: avgFrt ? Math.round(Number(avgFrt) * 10) / 10 : 0,
  });
});

// 2) Chat volume over time, with status breakdown + grouping
router.get("/reports/chat-volume", async (req, res) => {
  const { from, to } = parseRange(req);
  const groupBy = (req.query.groupBy as string) || "day";
  const trunc = groupBy === "month" ? "month" : groupBy === "week" ? "week" : "day";

  const result = await db.execute(sql`
    SELECT
      TO_CHAR(DATE_TRUNC(${trunc}, created_at), 'YYYY-MM-DD') as bucket,
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE status = 'open')::int as open,
      COUNT(*) FILTER (WHERE status = 'pending')::int as pending,
      COUNT(*) FILTER (WHERE status = 'completed')::int as resolved
    FROM conversations
    WHERE created_at BETWEEN ${from.toISOString()} AND ${to.toISOString()}
    GROUP BY bucket
    ORDER BY bucket ASC
  `);

  res.json(result.rows.map((r) => ({
    bucket: String((r as { bucket: string }).bucket),
    total: Number((r as { total: number }).total),
    open: Number((r as { open: number }).open),
    pending: Number((r as { pending: number }).pending),
    resolved: Number((r as { resolved: number }).resolved),
  })));
});

// 3) Response-time analytics: distribution + averages + SLA breaches
router.get("/reports/response-times", async (req, res) => {
  const { from, to } = parseRange(req);
  const slaMinutes = Number(req.query.slaMinutes ?? 5);

  const distResult = await db.execute(sql`
    WITH frt AS (
      SELECT
        c.id,
        EXTRACT(EPOCH FROM (m.created_at - c.created_at)) / 60 as response_minutes
      FROM conversations c
      JOIN LATERAL (
        SELECT created_at FROM messages
        WHERE conversation_id = c.id AND sender_type = 'agent'
        ORDER BY created_at ASC LIMIT 1
      ) m ON true
      WHERE c.created_at BETWEEN ${from.toISOString()} AND ${to.toISOString()}
    )
    SELECT
      AVG(response_minutes) as avg_minutes,
      MIN(response_minutes) as min_minutes,
      MAX(response_minutes) as max_minutes,
      PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY response_minutes) as p50,
      PERCENTILE_CONT(0.9)  WITHIN GROUP (ORDER BY response_minutes) as p90,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_minutes) as p95,
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE response_minutes <= ${slaMinutes})::int as within_sla,
      COUNT(*) FILTER (WHERE response_minutes >  ${slaMinutes})::int as breaches,
      COUNT(*) FILTER (WHERE response_minutes <= 1)::int as bucket_under_1m,
      COUNT(*) FILTER (WHERE response_minutes >  1 AND response_minutes <= 5)::int  as bucket_1_5m,
      COUNT(*) FILTER (WHERE response_minutes >  5 AND response_minutes <= 15)::int as bucket_5_15m,
      COUNT(*) FILTER (WHERE response_minutes > 15 AND response_minutes <= 60)::int as bucket_15_60m,
      COUNT(*) FILTER (WHERE response_minutes > 60)::int as bucket_over_60m
    FROM frt
  `);

  const resolutionResult = await db.execute(sql`
    SELECT
      AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60) as avg_minutes,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60) as p50
    FROM conversations
    WHERE status = 'completed'
      AND resolved_at IS NOT NULL
      AND created_at BETWEEN ${from.toISOString()} AND ${to.toISOString()}
  `);

  const d = distResult.rows[0] as Record<string, string | number | null>;
  const r = resolutionResult.rows[0] as Record<string, string | number | null>;

  const round = (v: string | number | null | undefined) =>
    v == null ? 0 : Math.round(Number(v) * 10) / 10;

  res.json({
    slaMinutes,
    total: Number(d.total ?? 0),
    avgMinutes: round(d.avg_minutes),
    minMinutes: round(d.min_minutes),
    maxMinutes: round(d.max_minutes),
    p50Minutes: round(d.p50),
    p90Minutes: round(d.p90),
    p95Minutes: round(d.p95),
    withinSla: Number(d.within_sla ?? 0),
    breaches: Number(d.breaches ?? 0),
    avgResolutionMinutes: round(r.avg_minutes),
    medianResolutionMinutes: round(r.p50),
    distribution: [
      { bucket: "< 1 min",   count: Number(d.bucket_under_1m ?? 0) },
      { bucket: "1–5 min",   count: Number(d.bucket_1_5m ?? 0) },
      { bucket: "5–15 min",  count: Number(d.bucket_5_15m ?? 0) },
      { bucket: "15–60 min", count: Number(d.bucket_15_60m ?? 0) },
      { bucket: "> 1 hour",  count: Number(d.bucket_over_60m ?? 0) },
    ],
  });
});

// 4) Customer analytics: top customers, repeat rate, growth
router.get("/reports/customers", async (req, res) => {
  const { from, to } = parseRange(req);
  const limit = Math.min(Number(req.query.limit ?? 10), 100);

  const topResult = await db.execute(sql`
    SELECT
      cu.id as customer_id,
      cu.name as customer_name,
      cu.phone,
      cu.branch,
      COUNT(c.id)::int as conversation_count,
      MAX(c.last_message_at) as last_contact_at
    FROM customers cu
    LEFT JOIN conversations c
      ON c.customer_id = cu.id
      AND c.created_at BETWEEN ${from.toISOString()} AND ${to.toISOString()}
    GROUP BY cu.id, cu.name, cu.phone, cu.branch
    HAVING COUNT(c.id) > 0
    ORDER BY conversation_count DESC
    LIMIT ${limit}
  `);

  const summaryResult = await db.execute(sql`
    WITH customer_conv_counts AS (
      SELECT customer_id, COUNT(*) as conv_count
      FROM conversations
      WHERE created_at BETWEEN ${from.toISOString()} AND ${to.toISOString()}
      GROUP BY customer_id
    )
    SELECT
      COUNT(*)::int as active_customers,
      COUNT(*) FILTER (WHERE conv_count > 1)::int as repeat_customers,
      AVG(conv_count) as avg_conv_per_customer
    FROM customer_conv_counts
  `);

  const growthResult = await db.execute(sql`
    SELECT
      TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') as bucket,
      COUNT(*)::int as count
    FROM customers
    WHERE created_at BETWEEN ${from.toISOString()} AND ${to.toISOString()}
    GROUP BY bucket
    ORDER BY bucket ASC
  `);

  const s = summaryResult.rows[0] as Record<string, string | number | null>;
  const repeatRate =
    Number(s.active_customers ?? 0) > 0
      ? Math.round((Number(s.repeat_customers ?? 0) / Number(s.active_customers)) * 1000) / 10
      : 0;

  res.json({
    summary: {
      activeCustomers: Number(s.active_customers ?? 0),
      repeatCustomers: Number(s.repeat_customers ?? 0),
      repeatRatePercent: repeatRate,
      avgConversationsPerCustomer: s.avg_conv_per_customer
        ? Math.round(Number(s.avg_conv_per_customer) * 10) / 10
        : 0,
    },
    topCustomers: topResult.rows.map((row) => {
      const r = row as Record<string, string | number | Date | null>;
      return {
        customerId: Number(r.customer_id),
        customerName: String(r.customer_name),
        phone: String(r.phone ?? ""),
        branch: r.branch ? String(r.branch) : null,
        conversationCount: Number(r.conversation_count),
        lastContactAt: r.last_contact_at instanceof Date
          ? r.last_contact_at.toISOString()
          : (r.last_contact_at ? String(r.last_contact_at) : null),
      };
    }),
    customerGrowth: growthResult.rows.map((row) => {
      const r = row as Record<string, string | number>;
      return { bucket: String(r.bucket), count: Number(r.count) };
    }),
  });
});

// 5) Branch performance
router.get("/reports/branches", async (req, res) => {
  const { from, to } = parseRange(req);

  const result = await db.execute(sql`
    SELECT
      COALESCE(cu.branch, 'Unassigned') as branch,
      COUNT(DISTINCT c.id)::int as conversation_count,
      COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'completed')::int as resolved_count,
      COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'open')::int as open_count,
      COUNT(DISTINCT cu.id)::int as customer_count,
      AVG(EXTRACT(EPOCH FROM (m.created_at - c.created_at)) / 60) as avg_response_minutes
    FROM customers cu
    LEFT JOIN conversations c
      ON c.customer_id = cu.id
      AND c.created_at BETWEEN ${from.toISOString()} AND ${to.toISOString()}
    LEFT JOIN LATERAL (
      SELECT created_at FROM messages
      WHERE conversation_id = c.id AND sender_type = 'agent'
      ORDER BY created_at ASC LIMIT 1
    ) m ON true
    GROUP BY COALESCE(cu.branch, 'Unassigned')
    ORDER BY conversation_count DESC
  `);

  res.json(result.rows.map((row) => {
    const r = row as Record<string, string | number | null>;
    return {
      branch: String(r.branch),
      conversationCount: Number(r.conversation_count ?? 0),
      resolvedCount: Number(r.resolved_count ?? 0),
      openCount: Number(r.open_count ?? 0),
      customerCount: Number(r.customer_count ?? 0),
      avgResponseMinutes: r.avg_response_minutes
        ? Math.round(Number(r.avg_response_minutes) * 10) / 10
        : 0,
    };
  }));
});

// 6) Tag analytics
router.get("/reports/tags", async (req, res) => {
  const { from, to } = parseRange(req);

  // Tag frequency on conversations
  const convResult = await db.execute(sql`
    SELECT tag, COUNT(*)::int as count
    FROM conversations c, UNNEST(c.tags) as tag
    WHERE c.created_at BETWEEN ${from.toISOString()} AND ${to.toISOString()}
    GROUP BY tag
    ORDER BY count DESC
  `);

  // Tag frequency on customers
  const custResult = await db.execute(sql`
    SELECT tag, COUNT(*)::int as count
    FROM customers cu, UNNEST(cu.tags) as tag
    GROUP BY tag
    ORDER BY count DESC
  `);

  res.json({
    conversationTags: convResult.rows.map((row) => {
      const r = row as Record<string, string | number>;
      return { tag: String(r.tag), count: Number(r.count) };
    }),
    customerTags: custResult.rows.map((row) => {
      const r = row as Record<string, string | number>;
      return { tag: String(r.tag), count: Number(r.count) };
    }),
  });
});

// 7) Hourly heatmap (day-of-week × hour)
router.get("/reports/heatmap", async (req, res) => {
  const { from, to } = parseRange(req);

  const result = await db.execute(sql`
    SELECT
      EXTRACT(DOW  FROM created_at)::int as dow,
      EXTRACT(HOUR FROM created_at)::int as hour,
      COUNT(*)::int as count
    FROM conversations
    WHERE created_at BETWEEN ${from.toISOString()} AND ${to.toISOString()}
    GROUP BY dow, hour
    ORDER BY dow, hour
  `);

  res.json(result.rows.map((row) => {
    const r = row as Record<string, number>;
    return {
      dayOfWeek: Number(r.dow),
      hour: Number(r.hour),
      count: Number(r.count),
    };
  }));
});

// =====================================================
// Unified CSV export
// =====================================================
router.get("/reports/export", async (req, res) => {
  const type = (req.query.type as string) || "agents";
  const { from, to } = parseRange(req);

  let rows: Record<string, unknown>[] = [];
  let filename = "report.csv";

  if (type === "agents") {
    const result = await db.execute(sql`
      SELECT
        u.name as "Agent Name",
        u.email as "Email",
        COUNT(DISTINCT c.id)::int as "Total Handled",
        COUNT(DISTINCT CASE WHEN c.status = 'completed' THEN c.id END)::int as "Resolved",
        COUNT(DISTINCT CASE WHEN c.status = 'open' THEN c.id END)::int as "Active Chats",
        ROUND(AVG(CASE
          WHEN m.created_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (m.created_at - c.created_at)) / 60
          ELSE NULL
        END)::numeric, 1) as "Avg Response Time (min)"
      FROM users u
      LEFT JOIN conversations c
        ON c.assigned_agent_id = u.id
        AND c.created_at BETWEEN ${from.toISOString()} AND ${to.toISOString()}
      LEFT JOIN LATERAL (
        SELECT created_at FROM messages
        WHERE conversation_id = c.id AND sender_type = 'agent'
        ORDER BY created_at ASC LIMIT 1
      ) m ON true
      WHERE u.role = 'agent'
      GROUP BY u.id, u.name, u.email
      ORDER BY COUNT(DISTINCT c.id) DESC
    `);
    rows = result.rows as Record<string, unknown>[];
    filename = "agent-performance.csv";
  } else if (type === "conversations") {
    const result = await db.execute(sql`
      SELECT
        c.id as "Conversation ID",
        cu.name as "Customer",
        cu.phone as "Phone",
        cu.branch as "Branch",
        u.name as "Assigned Agent",
        c.status as "Status",
        c.tags as "Tags",
        c.created_at as "Created",
        c.resolved_at as "Resolved",
        c.last_message_at as "Last Message"
      FROM conversations c
      JOIN customers cu ON cu.id = c.customer_id
      LEFT JOIN users u ON u.id = c.assigned_agent_id
      WHERE c.created_at BETWEEN ${from.toISOString()} AND ${to.toISOString()}
      ORDER BY c.created_at DESC
    `);
    rows = result.rows as Record<string, unknown>[];
    filename = "conversations.csv";
  } else if (type === "customers") {
    const result = await db.execute(sql`
      SELECT
        cu.name as "Name",
        cu.phone as "Phone",
        cu.branch as "Branch",
        cu.tags as "Tags",
        COUNT(c.id)::int as "Conversations",
        MAX(c.last_message_at) as "Last Contact",
        cu.created_at as "Customer Since"
      FROM customers cu
      LEFT JOIN conversations c ON c.customer_id = cu.id
      GROUP BY cu.id, cu.name, cu.phone, cu.branch, cu.tags, cu.created_at
      ORDER BY COUNT(c.id) DESC
    `);
    rows = result.rows as Record<string, unknown>[];
    filename = "customers.csv";
  } else if (type === "branches") {
    const result = await db.execute(sql`
      SELECT
        COALESCE(cu.branch, 'Unassigned') as "Branch",
        COUNT(DISTINCT cu.id)::int as "Customers",
        COUNT(DISTINCT c.id)::int as "Conversations",
        COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'completed')::int as "Resolved",
        COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'open')::int as "Open"
      FROM customers cu
      LEFT JOIN conversations c
        ON c.customer_id = cu.id
        AND c.created_at BETWEEN ${from.toISOString()} AND ${to.toISOString()}
      GROUP BY COALESCE(cu.branch, 'Unassigned')
      ORDER BY "Conversations" DESC
    `);
    rows = result.rows as Record<string, unknown>[];
    filename = "branches.csv";
  } else if (type === "tags") {
    const result = await db.execute(sql`
      SELECT tag as "Tag", COUNT(*)::int as "Conversations"
      FROM conversations c, UNNEST(c.tags) as tag
      WHERE c.created_at BETWEEN ${from.toISOString()} AND ${to.toISOString()}
      GROUP BY tag
      ORDER BY "Conversations" DESC
    `);
    rows = result.rows as Record<string, unknown>[];
    filename = "tags.csv";
  } else {
    res.status(400).json({ error: `Unknown export type: ${type}` });
    return;
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(rowsToCsv(rows));
});

export default router;
