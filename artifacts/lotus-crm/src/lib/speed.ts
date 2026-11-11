/**
 * Speed-message variables. Kept tiny and explicit: unknown {{tokens}} are left
 * as they are so the agent notices them before sending.
 */
import { format } from "date-fns";

export const SPEED_VARIABLES = [
  { token: "{{customer_name}}", label: "Customer name" },
  { token: "{{first_name}}", label: "Customer first name" },
  { token: "{{phone}}", label: "Customer phone" },
  { token: "{{agent_name}}", label: "Your name" },
  { token: "{{company}}", label: "Company name" },
  { token: "{{date}}", label: "Today's date" },
  { token: "{{time}}", label: "Current time" },
  { token: "{{order_number}}", label: "Order number (customer field)" },
] as const;

export interface SpeedContext {
  customerName?: string | null;
  phone?: string | null;
  agentName?: string | null;
  company?: string | null;
  customFields?: Record<string, string> | null;
}

export function fillVariables(body: string, ctx: SpeedContext): string {
  const name = (ctx.customerName ?? "").trim();
  // A phone-number "name" is not a name.
  const realName = /\p{L}/u.test(name) ? name : "";
  const values: Record<string, string> = {
    customer_name: realName,
    first_name: realName.split(/\s+/)[0] ?? "",
    phone: ctx.phone ?? "",
    agent_name: ctx.agentName ?? "",
    company: ctx.company ?? "",
    date: format(new Date(), "d MMM yyyy"),
    time: format(new Date(), "h:mm a"),
    order_number: ctx.customFields?.["order_number"] ?? ctx.customFields?.["Order number"] ?? "",
  };
  return body
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k: string) => {
      const v = values[k.toLowerCase()];
      return v === undefined ? m : v;
    })
    // "Hello , " when a value is empty → "Hello, "
    .replace(/[ \t]+([,.!؟?،])/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
}
