/** New delivery order dialog + order details sheet (used on the Deliveries page and in the chat). */
import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch, type Customer } from "@workspace/api-client-react";
import { format, parseISO } from "date-fns";
import { Loader2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { DELIVERY_STATUSES, STATUS_LABEL, STATUS_TONE, useDeliveryMutations, useDrivers, type DeliveryOrder, type DeliveryStatus } from "@/lib/deliveries";

const errMsg = (e: unknown, f: string) => (e as { data?: { error?: string } })?.data?.error ?? f;

export function NewOrderDialog({ customer, conversationId, onClose }: { customer?: { id: number; name: string; address?: string | null }; conversationId?: number; onClose: () => void }) {
  const { toast } = useToast();
  const { create } = useDeliveryMutations();
  const { data: drivers } = useDrivers();
  const [q, setQ] = useState("");
  const [customerId, setCustomerId] = useState<number | null>(customer?.id ?? null);
  const [address, setAddress] = useState(customer?.address ?? "");
  const [notes, setNotes] = useState("");
  const [amount, setAmount] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [driverId, setDriverId] = useState("none");
  const { data: found } = useQuery({
    queryKey: ["/api/customers", "pick", q],
    queryFn: () => customFetch<Customer[]>(`/api/customers?search=${encodeURIComponent(q)}`),
    enabled: !customer && q.trim().length >= 2,
  });
  const submit = () => {
    if (!customerId) return;
    create.mutate(
      { customerId, conversationId, address, notes, amount: amount || null, orderNumber: orderNumber || undefined, driverId: driverId === "none" ? null : Number(driverId) },
      { onSuccess: (o) => { toast({ title: `Order ${(o as unknown as { orderNumber?: string }).orderNumber ?? ""} created` }); onClose(); }, onError: (e) => toast({ title: errMsg(e, "Could not create the order"), variant: "destructive" }) },
    );
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Truck className="h-5 w-5" /> New delivery order</DialogTitle>
          <DialogDescription>{customer ? `For ${customer.name}` : "Pick the customer"}{conversationId ? " — status changes will be noted in this chat." : ""}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!customer && (
            <div className="space-y-1">
              <Label htmlFor="no-cust">Customer</Label>
              <Input id="no-cust" value={q} onChange={(e) => { setQ(e.target.value); setCustomerId(null); }} placeholder="Search name or phone" className="h-10" />
              {(found ?? []).length > 0 && !customerId && (
                <ul className="rounded-md border border-border max-h-40 overflow-y-auto">
                  {found!.slice(0, 8).map((c) => (
                    <li key={c.id}><button type="button" className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted" onClick={() => { setCustomerId(c.id); setQ(c.name); setAddress((c as { address?: string | null }).address ?? ""); }}>{c.name} · {c.phone}</button></li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label htmlFor="no-num">Order number <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="no-num" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder="Auto" className="h-10" /></div>
            <div className="space-y-1"><Label htmlFor="no-amt">Amount</Label><Input id="no-amt" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-10" /></div>
          </div>
          <div className="space-y-1"><Label htmlFor="no-addr">Delivery address</Label><Textarea id="no-addr" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} dir="auto" /></div>
          <div className="space-y-1"><Label htmlFor="no-notes">Notes</Label><Textarea id="no-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} dir="auto" placeholder="Items, payment, building…" /></div>
          <div className="space-y-1">
            <Label>Driver</Label>
            <Select value={driverId} onValueChange={setDriverId}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Assign later</SelectItem>
                {(drivers ?? []).filter((d) => d.is_active).map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name} · {d.status === "available" ? "available" : d.status === "on_delivery" ? `${d.active_orders} active` : "off"}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!customerId || create.isPending} data-testid="btn-create-order">{create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Create order</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OrderDialog({ orderId, onClose }: { orderId: number; onClose: () => void }) {
  const { toast } = useToast();
  const { update } = useDeliveryMutations();
  const { data: drivers } = useDrivers();
  const { data: o, refetch } = useQuery({ queryKey: ["/api/deliveries", "one", orderId], queryFn: () => customFetch<DeliveryOrder>(`/api/deliveries/${orderId}`) });
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(false);
  const change = (data: Record<string, unknown>) =>
    update.mutate({ id: orderId, ...data, note: note || undefined, notifyCustomer: notify }, {
      onSuccess: () => { setNote(""); void refetch(); },
      onError: (e) => toast({ title: errMsg(e, "Could not update"), variant: "destructive" }),
    });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[92dvh] overflow-y-auto">
        {!o ? <Loader2 className="h-5 w-5 animate-spin" /> : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">Order {o.order_number} <Badge variant="outline" className={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge></DialogTitle>
              <DialogDescription>{o.customer_name} · {o.customer_phone}{o.amount ? ` · ${o.amount}` : ""}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              {o.address && <p><b>Address:</b> <span className="bidi" dir="auto">{o.address}</span></p>}
              {o.notes && <p><b>Notes:</b> <span className="bidi" dir="auto">{o.notes}</span></p>}
              <div className="space-y-1">
                <Label>Driver</Label>
                <Select value={o.driver_id ? String(o.driver_id) : "none"} onValueChange={(v) => change({ driverId: v === "none" ? null : Number(v) })}>
                  <SelectTrigger className="h-10" data-testid="order-driver"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No driver</SelectItem>
                    {(drivers ?? []).filter((d) => d.is_active).map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name} ({d.phone})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ord-note">Note for this update <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input id="ord-note" value={note} onChange={(e) => setNote(e.target.value)} className="h-9" dir="auto" />
              </div>
              {o.conversation_id && (
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={notify} onCheckedChange={(v) => setNotify(!!v)} /> Also tell the customer in the chat</label>
              )}
              <div className="flex flex-wrap gap-1.5">
                {DELIVERY_STATUSES.filter((s) => s !== o.status && s !== "new").map((s) => (
                  <Button key={s} size="sm" variant="outline" onClick={() => change({ status: s as DeliveryStatus })} disabled={update.isPending} data-testid={`order-status-${s}`}>{STATUS_LABEL[s]}</Button>
                ))}
              </div>
              <div>
                <p className="font-semibold mb-1">History</p>
                <ol className="space-y-1 text-xs">
                  {(o.events ?? []).map((e) => (
                    <li key={e.id} className="flex gap-2">
                      <time className="text-muted-foreground tabular-nums shrink-0">{format(parseISO(e.created_at), "d MMM HH:mm")}</time>
                      <span><b>{STATUS_LABEL[e.status as DeliveryStatus] ?? e.status}</b>{e.driver_name ? ` · ${e.driver_name}` : ""}{e.actor ? ` · by ${e.actor}` : ""}{e.note ? ` — ${e.note}` : ""}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
