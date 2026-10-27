/**
 * Which kinds of WhatsApp webhook events Meta has actually delivered since the
 * API started. Lets an admin see at a glance whether e.g. phone-app echoes
 * (smb_message_echoes) arrive at all. In memory: resets on restart.
 */
const stats = new Map<string, { count: number; lastAt: string }>();
const startedAt = new Date().toISOString();

export function recordWebhookEvent(kind: string, n = 1): void {
  if (n <= 0) return;
  const s = stats.get(kind) ?? { count: 0, lastAt: "" };
  s.count += n;
  s.lastAt = new Date().toISOString();
  stats.set(kind, s);
}

export function webhookStats() {
  return { since: startedAt, events: Object.fromEntries(stats) };
}
