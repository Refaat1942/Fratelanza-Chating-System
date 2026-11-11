/** Deliveries: orders board, drivers (profiles, availability, history) and driver groups. */
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { formatDistanceToNow, parseISO, format } from "date-fns";
import { History, Loader2, Pencil, Plus, Search, Trash2, Truck, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { EmptyState } from "@/components/states";
import { NewOrderDialog, OrderDialog } from "@/components/delivery-dialogs";
import { DELIVERY_STATUSES, STATUS_LABEL, STATUS_TONE, useDeliveries, useDriverGroups, useDrivers, type Driver } from "@/lib/deliveries";
import { cn } from "@/lib/utils";

const errMsg = (e: unknown, f: string) => (e as { data?: { error?: string } })?.data?.error ?? f;
const DRIVER_DOT = { available: "bg-success", on_delivery: "bg-warning", off: "bg-muted-foreground/40" } as const;

export default function DeliveriesPage() {
  const { user } = useAuth();
  const lead = user?.role === "admin" || user?.role === "supervisor";
  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-5" data-testid="page-deliveries">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2"><Truck className="h-7 w-7 text-primary" /> Deliveries</h2>
        <p className="text-muted-foreground text-sm mt-1">Delivery orders linked to customers and their chats, with drivers and full status history.</p>
      </div>
      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="drivers">Drivers</TabsTrigger>
          <TabsTrigger value="groups">Driver groups</TabsTrigger>
        </TabsList>
        <TabsContent value="orders" className="mt-4"><Orders /></TabsContent>
        <TabsContent value="drivers" className="mt-4"><Drivers lead={lead} /></TabsContent>
        <TabsContent value="groups" className="mt-4"><Groups lead={lead} /></TabsContent>
      </Tabs>
    </div>
  );
}

function Orders() {
  const [status, setStatus] = useState("active");
  const [driverId, setDriverId] = useState("all");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const { data: drivers } = useDrivers();
  const { data, isLoading } = useDeliveries({ status, driverId, q: q.trim() || undefined });
  const counts = data?.counts ?? {};
  const active = (counts.new ?? 0) + (counts.assigned ?? 0) + (counts.picked_up ?? 0) + (counts.on_the_way ?? 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {[["active", `Active (${active})`], ...DELIVERY_STATUSES.map((s) => [s, `${STATUS_LABEL[s]} (${counts[s] ?? 0})`]), ["all", "All"]].map(([v, l]) => (
          <button key={v} type="button" onClick={() => setStatus(v)} aria-pressed={status === v}
            className={cn("rounded-full border px-3 py-1 text-sm", status === v ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted")}>{l}</button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order number, customer, phone or address" className="pl-9 h-10" aria-label="Search orders" />
        </div>
        <Select value={driverId} onValueChange={setDriverId}>
          <SelectTrigger className="w-44 h-10" aria-label="Driver"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All drivers</SelectItem>{(drivers ?? []).map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}</SelectContent>
        </Select>
        <Button className="h-10" onClick={() => setCreating(true)} data-testid="btn-new-order"><Plus className="h-4 w-4 mr-1.5" /> New order</Button>
      </div>
      {isLoading ? <Skeleton className="h-40 w-full" /> : !data?.orders.length ? (
        <EmptyState title="No orders here" hint="Create an order from a chat (Details → Deliveries) or with “New order”." />
      ) : (
        <ul className="rounded-xl border border-border bg-card divide-y divide-border">
          {data.orders.map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => setOpen(o.id)} className="w-full text-left p-3 sm:px-4 flex flex-col sm:flex-row sm:items-center gap-2 hover:bg-muted/40" data-testid={`order-${o.id}`}>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm">{o.order_number} · {o.customer_name} <span className="text-xs text-muted-foreground">{o.customer_phone}</span></p>
                  <p className="text-xs text-muted-foreground truncate bidi" dir="auto">{o.address ?? "No address"}{o.amount ? ` · ${o.amount}` : ""}</p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span>{o.driver_name ?? <span className="text-warning">No driver</span>}</span>
                  <Badge variant="outline" className={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>
                  <span className="text-muted-foreground tabular-nums">{formatDistanceToNow(parseISO(o.updated_at), { addSuffix: true })}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {creating && <NewOrderDialog onClose={() => setCreating(false)} />}
      {open !== null && <OrderDialog orderId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Drivers({ lead }: { lead: boolean }) {
  const { data, isLoading } = useDrivers();
  const [editing, setEditing] = useState<Driver | "new" | null>(null);
  const [history, setHistory] = useState<Driver | null>(null);
  return (
    <div className="space-y-4">
      {lead && <Button onClick={() => setEditing("new")} data-testid="btn-new-driver"><Plus className="h-4 w-4 mr-1.5" /> Add driver</Button>}
      {isLoading ? <Skeleton className="h-40 w-full" /> : !data?.length ? <EmptyState title="No drivers yet" hint={lead ? "Add your delivery drivers." : "An admin or supervisor can add drivers."} /> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((d) => (
            <div key={d.id} className={cn("rounded-xl border border-border bg-card p-4 space-y-2", !d.is_active && "opacity-60")} data-testid={`driver-${d.id}`}>
              <div className="flex items-start gap-2">
                <span className={cn("mt-1.5 h-2.5 w-2.5 rounded-full shrink-0", DRIVER_DOT[d.status])} aria-label={d.status} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{d.name} {!d.is_active && <Badge variant="outline">Inactive</Badge>}</p>
                  <p className="text-xs text-muted-foreground">{d.phone}{d.vehicle ? ` · ${d.vehicle}` : ""}{d.group_name ? ` · ${d.group_name}` : ""}</p>
                </div>
                {lead && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(d)} aria-label={`Edit ${d.name}`}><Pencil className="h-4 w-4" /></Button>}
              </div>
              <p className="text-xs tabular-nums">
                <b>{d.active_orders}</b> active · {d.delivered} delivered · {d.failed} failed
                {d.last_activity && <span className="text-muted-foreground"> · last {formatDistanceToNow(parseISO(d.last_activity), { addSuffix: true })}</span>}
              </p>
              <Button variant="outline" size="sm" onClick={() => setHistory(d)}><History className="h-3.5 w-3.5 mr-1" /> Activity</Button>
            </div>
          ))}
        </div>
      )}
      {editing && <DriverDialog driver={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {history && <DriverHistory driver={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function DriverDialog({ driver, onClose }: { driver: Driver | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: groups } = useDriverGroups();
  const [f, setF] = useState({
    name: driver?.name ?? "", phone: driver?.phone ?? "", vehicle: driver?.vehicle ?? "", notes: driver?.notes ?? "",
    groupId: driver?.group_id ? String(driver.group_id) : "none", status: driver?.status ?? "available", isActive: driver?.is_active ?? true,
  });
  const save = useMutation({
    mutationFn: () => customFetch(driver ? `/api/drivers/${driver.id}` : "/api/drivers", {
      method: driver ? "PUT" : "POST",
      body: JSON.stringify({ ...f, groupId: f.groupId === "none" ? null : Number(f.groupId) }),
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["/api/drivers"] }); onClose(); },
    onError: (e) => toast({ title: errMsg(e, "Could not save"), variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{driver ? "Edit driver" : "Add driver"}</DialogTitle><DialogDescription>Drivers don't sign in; they are assigned to orders.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label htmlFor="d-name">Name</Label><Input id="d-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="h-10" /></div>
            <div className="space-y-1"><Label htmlFor="d-phone">Phone</Label><Input id="d-phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className="h-10" inputMode="tel" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label htmlFor="d-veh">Vehicle</Label><Input id="d-veh" value={f.vehicle} onChange={(e) => setF({ ...f, vehicle: e.target.value })} className="h-10" /></div>
            <div className="space-y-1">
              <Label>Group</Label>
              <Select value={f.groupId} onValueChange={(v) => setF({ ...f, groupId: v })}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">No group</SelectItem>{(groups ?? []).map((g) => <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Availability</Label>
            <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v as Driver["status"] })}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="available">Available</SelectItem><SelectItem value="on_delivery">On delivery</SelectItem><SelectItem value="off">Off duty</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label htmlFor="d-notes">Notes</Label><Input id="d-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="h-10" /></div>
          {driver && <label className="flex items-center gap-2 text-sm"><Switch checked={f.isActive} onCheckedChange={(v) => setF({ ...f, isActive: v })} /> Active</label>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !f.name.trim()}>{save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DriverHistory({ driver, onClose }: { driver: Driver; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/drivers", driver.id, "history"],
    queryFn: () => customFetch<{ id: number; status: string; note: string | null; created_at: string; order_number: string; customer_name: string; actor: string | null }[]>(`/api/drivers/${driver.id}/history`),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[92dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{driver.name} — activity</DialogTitle><DialogDescription>Every status change on this driver's orders.</DialogDescription></DialogHeader>
        {isLoading ? <Skeleton className="h-24 w-full" /> : !data?.length ? <p className="text-sm text-muted-foreground">No activity yet.</p> : (
          <ol className="space-y-1.5 text-sm">
            {data.map((e) => (
              <li key={e.id} className="flex gap-2">
                <time className="text-xs text-muted-foreground tabular-nums shrink-0 w-24">{format(parseISO(e.created_at), "d MMM HH:mm")}</time>
                <span>{e.order_number} · {e.customer_name} — <b>{STATUS_LABEL[e.status as keyof typeof STATUS_LABEL] ?? e.status}</b>{e.actor ? ` · by ${e.actor}` : ""}{e.note ? ` — ${e.note}` : ""}</span>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Groups({ lead }: { lead: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useDriverGroups();
  const [name, setName] = useState("");
  const add = useMutation({
    mutationFn: () => customFetch("/api/driver-groups", { method: "POST", body: JSON.stringify({ name }) }),
    onSuccess: () => { setName(""); void qc.invalidateQueries({ queryKey: ["/api/driver-groups"] }); },
    onError: (e) => toast({ title: errMsg(e, "Could not add"), variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: (id: number) => customFetch(`/api/driver-groups/${id}`, { method: "DELETE" }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["/api/driver-groups"] }); void qc.invalidateQueries({ queryKey: ["/api/drivers"] }); },
  });
  return (
    <div className="space-y-4 max-w-2xl">
      {isLoading ? <Skeleton className="h-24 w-full" /> : (
        <ul className="rounded-xl border border-border bg-card divide-y divide-border">
          {(data ?? []).map((g) => (
            <li key={g.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
              <UsersRound className="h-4 w-4 text-muted-foreground" aria-hidden />
              <span className="font-medium flex-1">{g.name}</span>
              <span className="text-xs text-muted-foreground">{g.drivers} driver(s)</span>
              {lead && <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => del.mutate(g.id)} aria-label={`Delete ${g.name}`}><Trash2 className="h-4 w-4" /></Button>}
            </li>
          ))}
          {(data ?? []).length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">No groups yet (e.g. “Downtown”, “Night shift”).</li>}
        </ul>
      )}
      {lead && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add.mutate(); }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New group name" className="h-10" aria-label="New group name" />
          <Button type="submit" className="h-10" disabled={!name.trim()}>Add</Button>
        </form>
      )}
    </div>
  );
}
