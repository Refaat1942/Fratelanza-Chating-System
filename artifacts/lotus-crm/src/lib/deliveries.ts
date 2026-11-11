import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

export const DELIVERY_STATUSES = ["new", "assigned", "picked_up", "on_the_way", "delivered", "failed", "cancelled"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export const STATUS_LABEL: Record<DeliveryStatus, string> = {
  new: "New", assigned: "Assigned", picked_up: "Picked up", on_the_way: "On the way", delivered: "Delivered", failed: "Failed", cancelled: "Cancelled",
};
export const STATUS_TONE: Record<DeliveryStatus, string> = {
  new: "border-border", assigned: "border-info/40 text-info", picked_up: "border-info/40 text-info", on_the_way: "border-warning/40 text-warning bg-warning/10",
  delivered: "border-success/40 text-success bg-success/10", failed: "border-destructive/40 text-destructive", cancelled: "text-muted-foreground",
};

export interface DeliveryOrder {
  id: number; order_number: string; customer_id: number; conversation_id: number | null; driver_id: number | null; status: DeliveryStatus;
  address: string | null; notes: string | null; amount: string | null; scheduled_for: string | null; created_at: string; updated_at: string; delivered_at: string | null;
  customer_name: string; customer_phone: string; driver_name: string | null; driver_phone: string | null; created_by_name: string | null;
  events?: { id: number; status: string; note: string | null; created_at: string; driver_name: string | null; actor: string | null }[];
}
export interface Driver {
  id: number; name: string; phone: string; group_id: number | null; group_name: string | null; vehicle: string | null; status: "available" | "on_delivery" | "off";
  is_active: boolean; notes: string | null; active_orders: number; delivered: number; failed: number; last_activity: string | null;
}
export interface DriverGroup { id: number; name: string; description: string | null; drivers: number }

export function useDeliveries(filters: Record<string, string | number | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== "" && v !== "all") qs.set(k, String(v));
  return useQuery({
    queryKey: ["/api/deliveries", qs.toString()],
    queryFn: () => customFetch<{ orders: DeliveryOrder[]; counts: Record<string, number> }>(`/api/deliveries?${qs}`),
    refetchInterval: 20_000,
  });
}
export function useDrivers() { return useQuery({ queryKey: ["/api/drivers"], queryFn: () => customFetch<Driver[]>("/api/drivers") }); }
export function useDriverGroups() { return useQuery({ queryKey: ["/api/driver-groups"], queryFn: () => customFetch<DriverGroup[]>("/api/driver-groups") }); }

export function useDeliveryMutations() {
  const qc = useQueryClient();
  const done = () => { void qc.invalidateQueries({ queryKey: ["/api/deliveries"] }); void qc.invalidateQueries({ queryKey: ["/api/drivers"] }); };
  return {
    create: useMutation({ mutationFn: (data: Record<string, unknown>) => customFetch<DeliveryOrder>("/api/deliveries", { method: "POST", body: JSON.stringify(data) }), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, ...data }: { id: number } & Record<string, unknown>) => customFetch<DeliveryOrder>(`/api/deliveries/${id}`, { method: "PATCH", body: JSON.stringify(data) }), onSuccess: done }),
  };
}
