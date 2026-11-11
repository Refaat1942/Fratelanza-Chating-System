/**
 * Runs chat bots on live conversations (called for every inbound customer
 * message). Safety rules:
 *  - never runs while sending is switched off (kill switch);
 *  - never talks in a chat a person is handling (assigned agent) — an agent
 *    claiming the chat ends the bot;
 *  - bots are inactive until an admin activates them;
 *  - bot replies don't change "who spoke last", so a handed-over chat still
 *    shows as waiting for a human.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { Server as IOServer } from "socket.io";
import { db, botsTable, botSessionsTable, conversationsTable, customersTable, messagesTable, type Bot } from "@workspace/db";
import { advanceBot, startBot, type BotAction, type BotDef, type BotStep, type BotTurn } from "./bot-engine";
import { deliverToCustomer } from "./deliver";
import { outboundEnabled } from "./outbound";
import { normalizeText } from "./topics";
import { logger } from "./logger";

const STALE_MS = 24 * 3600 * 1000;

export function toDef(b: Bot): BotDef {
  return {
    welcomeMessage: b.welcomeMessage, fallbackMessage: b.fallbackMessage, handoverMessage: b.handoverMessage,
    completionMessage: b.completionMessage, endAction: b.endAction, maxFallbacks: b.maxFallbacks,
    steps: (b.steps ?? []) as BotStep[],
  };
}

/** Outside opening hours? (Times in BOT_TIMEZONE, default Africa/Cairo.) */
export function isOffHours(oh: Bot["offHours"], now = new Date()): boolean {
  if (!oh?.enabled) return false;
  const tz = process.env.BOT_TIMEZONE || "Africa/Cairo";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")?.value ?? "");
  const hm = `${parts.find((p) => p.type === "hour")?.value}:${parts.find((p) => p.type === "minute")?.value}`.replace(/^24:/, "00:");
  if (oh.days?.length && !oh.days.includes(wd)) return true;
  return oh.start <= oh.end ? hm < oh.start || hm >= oh.end : hm < oh.start && hm >= oh.end;
}

function matchesBot(b: Bot, channel: string, isNew: boolean, text: string): boolean {
  if (!b.isActive) return false;
  if (b.channel !== "all" && b.channel !== channel) return false;
  if (b.trigger === "new_conversation") return isNew;
  const t = normalizeText(text);
  return b.keywords.some((k) => { const n = normalizeText(k); return !!n && t.includes(n); });
}

async function applyTurn(turn: BotTurn, ctx: { conversationId: number; customerId: number; sessionId: number; io?: IOServer }): Promise<void> {
  // 1) customer data
  for (const s of turn.saves) {
    if (s.field === "name") await db.update(customersTable).set({ name: s.value.slice(0, 120) }).where(eq(customersTable.id, ctx.customerId));
    else if (s.field === "email") await db.update(customersTable).set({ email: s.value.toLowerCase() }).where(eq(customersTable.id, ctx.customerId));
    else if (s.field.startsWith("custom:")) {
      const key = s.field.slice(7);
      await db.update(customersTable)
        .set({ customFields: sql`COALESCE(${customersTable.customFields}, '{}'::jsonb) || ${JSON.stringify({ [key]: s.value })}::jsonb` })
        .where(eq(customersTable.id, ctx.customerId));
    }
  }
  // 2) routing / classification
  for (const a of turn.actions as BotAction[]) {
    if (a.type === "route_team") await db.update(conversationsTable).set({ teamId: a.teamId }).where(eq(conversationsTable.id, ctx.conversationId));
    if (a.type === "set_topic") await db.update(conversationsTable).set({ chatReasonId: a.topicId, chatReasonAuto: false }).where(eq(conversationsTable.id, ctx.conversationId));
    if (a.type === "tag") {
      await db.execute(sql`UPDATE conversations SET tags = array_append(tags, ${a.tag}) WHERE id = ${ctx.conversationId} AND NOT (${a.tag} = ANY(tags))`);
    }
    if (a.type === "close") {
      await db.update(conversationsTable).set({ status: "completed", resolvedAt: new Date() }).where(eq(conversationsTable.id, ctx.conversationId));
    }
  }
  // 3) replies — stored and sent like agent messages, marked as bot
  for (const body of turn.replies) {
    const [m] = await db.insert(messagesTable).values({
      conversationId: ctx.conversationId, senderId: null, senderType: "agent", body, status: "sent", isBot: true,
    }).returning();
    const { delivered } = await deliverToCustomer(ctx.conversationId, m!);
    ctx.io?.to(`conv:${ctx.conversationId}`).emit("new_message", delivered);
  }
  // 4) session
  await db.update(botSessionsTable).set({
    stepKey: turn.state.stepKey, answers: turn.state.answers, fallbacks: turn.state.fallbacks, lastActivityAt: new Date(),
    ...(turn.end ? { status: turn.end, endedAt: new Date() } : {}),
  }).where(eq(botSessionsTable.id, ctx.sessionId));
  ctx.io?.emit("conversation_updated", { conversationId: ctx.conversationId });
}

/**
 * Let a bot handle this inbound message. Returns true while the bot keeps the
 * conversation (the caller then skips auto-assignment).
 */
export async function runBotOnInbound(opts: { conversationId: number; text: string; isNewConversation: boolean; io?: IOServer }): Promise<boolean> {
  if (!outboundEnabled()) return false;
  try {
    const [conv] = await db
      .select({ id: conversationsTable.id, assignedAgentId: conversationsTable.assignedAgentId, channel: conversationsTable.channel, customerId: conversationsTable.customerId, status: conversationsTable.status })
      .from(conversationsTable).where(eq(conversationsTable.id, opts.conversationId));
    if (!conv) return false;

    const [session] = await db.select().from(botSessionsTable)
      .where(and(eq(botSessionsTable.conversationId, conv.id), eq(botSessionsTable.status, "active")))
      .orderBy(desc(botSessionsTable.id)).limit(1);

    if (conv.assignedAgentId) {
      // A person has the chat: the bot steps back for good.
      if (session) await db.update(botSessionsTable).set({ status: "handed_over", endedAt: new Date() }).where(eq(botSessionsTable.id, session.id));
      return false;
    }

    if (session) {
      const [bot] = await db.select().from(botsTable).where(eq(botsTable.id, session.botId));
      const stale = Date.now() - new Date(session.lastActivityAt).getTime() > STALE_MS;
      if (!bot || !bot.isActive || stale) {
        await db.update(botSessionsTable).set({ status: stale ? "abandoned" : "handed_over", endedAt: new Date() }).where(eq(botSessionsTable.id, session.id));
        return false;
      }
      const turn = advanceBot(toDef(bot), { stepKey: session.stepKey, answers: session.answers ?? {}, fallbacks: session.fallbacks }, opts.text);
      await applyTurn(turn, { conversationId: conv.id, customerId: conv.customerId, sessionId: session.id, io: opts.io });
      return turn.end === null;
    }

    const bots = await db.select().from(botsTable).where(eq(botsTable.isActive, true)).orderBy(desc(botsTable.priority), botsTable.id);
    const bot = bots.find((b) => matchesBot(b, conv.channel, opts.isNewConversation, opts.text));
    if (!bot || !(bot.steps ?? []).length) return false;

    const [s] = await db.insert(botSessionsTable).values({ botId: bot.id, conversationId: conv.id }).returning();
    const turn = startBot(toDef(bot));
    if (isOffHours(bot.offHours) && bot.offHours?.message) turn.replies.unshift(bot.offHours.message);
    await applyTurn(turn, { conversationId: conv.id, customerId: conv.customerId, sessionId: s!.id, io: opts.io });
    return turn.end === null;
  } catch (err) {
    logger.error({ err, conversationId: opts.conversationId }, "Bot failed — handing the chat to people");
    return false;
  }
}
