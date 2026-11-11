/** Chat side panel: this customer's delivery orders + "New order" (linked to the chat). */
import React, { useState } from "react";
import { Plus, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { NewOrderDialog, OrderDialog } from "@/components/delivery-dialogs";
import { STATUS_LABEL, STATUS_TONE, useDeliveries } from "@/lib/deliveries";

export function ChatDeliveries({ customer, conversationId }: { customer: { id: number; name: string; address?: string | null }; conversationId: number }) {
  const { data } = useDeliveries({ customerId: customer.id });
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const orders = data?.orders ?? [];
  return (
    <div className="space-y-2" data-testid="chat-deliveries">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5"><Truck className="h-3.5 w-3.5" /> Deliveries</h4>
        <button type="button" onClick={() => setCreating(true)} className="text-xs text-primary hover:underline inline-flex items-center gap-0.5" data-testid="btn-chat-new-order"><Plus className="h-3 w-3" /> New order</button>
      </div>
      {orders.length === 0 ? <p className="text-xs text-muted-foreground">No orders for this customer.</p> : (
        <ul className="space-y-1">
          {orders.slice(0, 5).map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => setOpen(o.id)} className="w-full text-left rounded-md border border-border px-2 py-1.5 text-xs hover:bg-muted flex items-center gap-2">
                <span className="font-medium">{o.order_number}</span>
                <span className="text-muted-foreground truncate flex-1">{o.driver_name ?? "no driver"}</span>
                <Badge variant="outline" className={`text-[10px] ${STATUS_TONE[o.status]}`}>{STATUS_LABEL[o.status]}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
      {creating && <NewOrderDialog customer={customer} conversationId={conversationId} onClose={() => setCreating(false)} />}
      {open !== null && <OrderDialog orderId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
