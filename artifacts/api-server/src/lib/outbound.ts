/**
 * Global outbound switch. Sending is ON unless the server owner sets
 * WHATSAPP_SENDING_ENABLED=false in deploy/.env (an emergency stop that cannot
 * be flipped from the app). Internal notes and inbound sync are unaffected.
 */
export function outboundEnabled(): boolean {
  return (process.env.WHATSAPP_SENDING_ENABLED ?? "true").trim().toLowerCase() !== "false";
}

export const OUTBOUND_DISABLED_ERROR = {
  error: "Sending messages to customers is turned off on this server. Use an internal note instead.",
  code: "OUTBOUND_DISABLED",
} as const;
