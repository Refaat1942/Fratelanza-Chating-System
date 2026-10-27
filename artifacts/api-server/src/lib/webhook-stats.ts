/**
 * Which kinds of WhatsApp webhook events Meta has actually delivered. Lets an
 * admin see at a glance whether e.g. phone-app echoes (smb_message_echoes)
 * arrive at all. Counted in memory and saved to `settings.webhook_stats`
 * (debounced) so the page doesn't go blank after every restart.
 */
import { eq } from "drizzle-orm";
import { db, settingsTable } from "@workspace/db";
import { logger } from "./logger";

type Stat = { count: number; lastAt: string };
interface Stored { since: string; events: Record<string, Stat> }

const stats = new Map<string, Stat>();
let since = new Date().toISOString();
let loaded = false;
let saveTimer: NodeJS.Timeout | null = null;

/** Merge the saved counters in once (counts recorded before load are kept). */
export async function loadWebhookStats(): Promise<void> {
  try {
    const [row] = await db.select({ s: settingsTable.webhookStats }).from(settingsTable).where(eq(settingsTable.id, 1));
    const saved = row?.s as Stored | null | undefined;
    if (saved?.events) {
      if (saved.since) since = saved.since;
      for (const [k, v] of Object.entries(saved.events)) {
        const cur = stats.get(k);
        stats.set(k, cur ? { count: cur.count + v.count, lastAt: cur.lastAt } : v);
      }
    }
  } catch (err) {
    logger.warn({ err }, "Could not load webhook stats");
  }
  loaded = true;
}

function scheduleSave(): void {
  if (!loaded || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const value: Stored = { since, events: Object.fromEntries(stats) };
    db.update(settingsTable).set({ webhookStats: value }).where(eq(settingsTable.id, 1))
      .catch((err) => logger.warn({ err }, "Could not save webhook stats"));
  }, 5000);
  saveTimer.unref?.();
}

export function recordWebhookEvent(kind: string, n = 1): void {
  if (n <= 0) return;
  const s = stats.get(kind) ?? { count: 0, lastAt: "" };
  s.count += n;
  s.lastAt = new Date().toISOString();
  stats.set(kind, s);
  scheduleSave();
}

export function webhookStats() {
  return { since, events: Object.fromEntries(stats) };
}
