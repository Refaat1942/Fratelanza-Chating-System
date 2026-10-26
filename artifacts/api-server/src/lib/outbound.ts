/**
 * Global outbound kill switch.
 *
 * Nothing is ever sent to a customer (WhatsApp replies, campaigns) unless the
 * server owner explicitly sets WHATSAPP_SENDING_ENABLED=true in deploy/.env.
 * It is deliberately NOT a UI setting, so it cannot be switched on by mistake
 * from the app. Internal notes and inbound sync are unaffected.
 */
export function outboundEnabled(): boolean {
  return process.env.WHATSAPP_SENDING_ENABLED === "true";
}

export const OUTBOUND_DISABLED_ERROR = {
  error: "Sending messages to customers is turned off on this server. Use an internal note instead.",
  code: "OUTBOUND_DISABLED",
} as const;
