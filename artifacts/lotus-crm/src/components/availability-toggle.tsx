import { useUpdateMyStatus, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Status = "available" | "busy" | "offline";

const STATUS_META: Record<Status, { label: string; dot: string; ring: string }> = {
  available: { label: "Available", dot: "bg-green-500", ring: "ring-green-500/30" },
  busy: { label: "Busy", dot: "bg-amber-500", ring: "ring-amber-500/30" },
  offline: { label: "Offline", dot: "bg-zinc-400", ring: "ring-zinc-400/30" },
};

export function AvailabilityToggle() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const mutation = useUpdateMyStatus();

  // Only agents need this toggle.
  if (!user || user.role !== "agent") return null;

  const current = (user.status ?? "available") as Status;
  const meta = STATUS_META[current];

  const setStatus = (next: Status) => {
    if (next === current) return;
    mutation.mutate(
      { data: { status: next } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          toast({ title: `You are now ${STATUS_META[next].label.toLowerCase()}` });
        },
        onError: () => {
          toast({ title: "Could not update status", variant: "destructive" });
        },
      },
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={mutation.isPending}
          className="w-full flex items-center gap-2 rounded-lg border border-sidebar-border bg-white/5 px-3 py-2 text-xs font-medium text-sidebar-foreground hover:bg-white/10 transition-colors disabled:opacity-50"
          data-testid="button-availability"
        >
          <span className={`h-2 w-2 rounded-full ring-2 ${meta.dot} ${meta.ring}`} />
          <span>{meta.label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {(Object.keys(STATUS_META) as Status[]).map((s) => (
          <DropdownMenuItem
            key={s}
            onClick={() => setStatus(s)}
            className="flex items-center gap-2"
          >
            <span className={`h-2 w-2 rounded-full ${STATUS_META[s].dot}`} />
            <span>{STATUS_META[s].label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
