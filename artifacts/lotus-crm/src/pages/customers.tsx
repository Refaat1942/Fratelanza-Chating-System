import React, { useState } from "react";
import {
  useListCustomers,
  useCreateCustomer,
  useGetCustomer,
  useGetCustomerConversations,
  getListCustomersQueryKey,
  getGetCustomerQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import {
  Search, Plus, Phone, MapPin, FileText, User,
  MessageSquare, Clock, ChevronRight, ArrowLeft, Ban, ShieldCheck,
  Check, ChevronsUpDown, X as XIcon, Sparkles, RefreshCw,
} from "lucide-react";
import { useBlockCustomer, useUnblockCustomer, useCustomerAiBrief } from "@/lib/api-extra";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription,
  DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem,
  FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const createCustomerSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters"),
  phone: z
    .string()
    .trim()
    .min(7, "Phone number is too short")
    .regex(/^[\d\s+\-()]+$/, "Phone can only contain digits, spaces, +, -, ()"),
  branch: z.string().optional(),
  address: z.string().trim().max(200, "Address is too long").optional(),
  tags: z.array(z.string()).default([]),
  notes: z.string().optional(),
  prescriptionNotes: z.string().optional(),
});

export default function CustomersPage() {
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);

  const { data: customers, isLoading } = useListCustomers({
    search: search || undefined,
    branch: branchFilter === "all" ? undefined : branchFilter,
  });

  if (selectedCustomerId !== null) {
    return (
      <CustomerDetailView
        customerId={selectedCustomerId}
        onBack={() => setSelectedCustomerId(null)}
      />
    );
  }

  return (
    <div className="flex-1 space-y-6 p-8 overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Customers</h2>
          <p className="text-muted-foreground">
            Manage and view customer histories across all branches.
          </p>
        </div>
        <CreateCustomerDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} />
      </div>

      <div className="flex items-center gap-4 bg-card p-4 rounded-xl border border-border shadow-sm">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, phone, or tags..."
            className="pl-9 bg-background"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={branchFilter} onValueChange={setBranchFilter}>
          <SelectTrigger className="w-[180px] bg-background">
            <SelectValue placeholder="Branch" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Branches</SelectItem>
            <SelectItem value="Downtown">Downtown</SelectItem>
            <SelectItem value="Westside">Westside</SelectItem>
            <SelectItem value="North">North Hills</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border border-border rounded-xl overflow-hidden bg-card shadow-sm">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="w-[50px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array(5).fill(0).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-8 w-8 rounded-full" />
                      <Skeleton className="h-4 w-24" />
                    </div>
                  </TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell />
                </TableRow>
              ))
              : customers?.length === 0
                ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                      <User className="h-8 w-8 mx-auto mb-2 opacity-20" />
                      No customers found matching your criteria.
                    </TableCell>
                  </TableRow>
                )
                : customers?.map((customer) => (
                  <TableRow
                    key={customer.id}
                    className="hover:bg-muted/50 cursor-pointer transition-colors group"
                    onClick={() => setSelectedCustomerId(customer.id)}
                    data-testid={`customer-row-${customer.id}`}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8 border border-border/50">
                          <AvatarFallback className="bg-primary/10 text-primary text-xs">
                            {customer.name.substring(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium">{customer.name}</span>
                        {(customer as { isBlocked?: boolean }).isBlocked && (
                          <Badge
                            variant="destructive"
                            className="text-[10px] h-5 px-1.5 gap-1"
                          >
                            <Ban className="h-3 w-3" />
                            Blocked
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center text-muted-foreground text-sm">
                        <Phone className="h-3 w-3 mr-2" />
                        {customer.phone}
                      </div>
                    </TableCell>
                    <TableCell>
                      {customer.branch
                        ? (
                          <div className="flex items-center text-sm">
                            <MapPin className="h-3 w-3 mr-1.5 text-muted-foreground" />
                            {customer.branch}
                          </div>
                        )
                        : <span className="text-muted-foreground text-sm">-</span>}
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      {(customer as { address?: string | null }).address
                        ? (
                          <div className="flex items-start text-sm text-muted-foreground gap-1.5">
                            <MapPin className="h-3 w-3 mt-0.5 shrink-0 text-emerald-600" />
                            <span className="truncate" title={(customer as { address?: string | null }).address ?? ""}>
                              {(customer as { address?: string | null }).address}
                            </span>
                          </div>
                        )
                        : <span className="text-muted-foreground text-sm">-</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {customer.tags?.map((tag, idx) => (
                          <Badge
                            key={idx}
                            variant="secondary"
                            className="font-normal text-[10px] px-1.5 h-5 bg-background"
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(parseISO(customer.createdAt), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CustomerDetailView({
  customerId,
  onBack,
}: {
  customerId: number;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const { data: customer, isLoading } = useGetCustomer(customerId, {
    query: { queryKey: getGetCustomerQueryKey(customerId) },
  });
  const { data: conversations, isLoading: convsLoading } = useGetCustomerConversations(customerId);
  const blockMut = useBlockCustomer();
  const unblockMut = useUnblockCustomer();
  const aiBriefMut = useCustomerAiBrief(customerId);
  const [aiBrief, setAiBrief] = React.useState<import("@/lib/api-extra").CustomerAiBrief | null>(null);
  const isBlocked = !!(customer as { isBlocked?: boolean } | undefined)?.isBlocked;
  const blockedReason = (customer as { blockedReason?: string | null } | undefined)?.blockedReason;
  const handleToggleBlock = () => {
    if (isBlocked) {
      unblockMut.mutate(customerId, {
        onSuccess: () => toast({ title: "Customer unblocked" }),
        onError: () => toast({ title: "Failed to unblock", variant: "destructive" }),
      });
    } else {
      const reason = window.prompt(
        "Optional reason for blocking this customer (will be visible to staff):",
        "",
      );
      if (reason === null) return;
      blockMut.mutate(
        { id: customerId, reason: reason.trim() },
        {
          onSuccess: () => toast({ title: "Customer blocked" }),
          onError: () => toast({ title: "Failed to block", variant: "destructive" }),
        },
      );
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 p-8 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-3 gap-6">
          <Skeleton className="h-48 col-span-1" />
          <Skeleton className="h-48 col-span-2" />
        </div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Customer not found.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Separator orientation="vertical" className="h-5" />
        <h2 className="text-2xl font-bold tracking-tight">{customer.name}</h2>
        <div className="flex gap-1 ml-1">
          {customer.tags?.map((tag, i) => (
            <Badge key={i} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
          {isBlocked && (
            <Badge variant="destructive" className="text-xs gap-1">
              <Ban className="h-3 w-3" />
              Blocked
            </Badge>
          )}
        </div>
        <div className="ml-auto">
          <Button
            variant={isBlocked ? "outline" : "destructive"}
            size="sm"
            onClick={handleToggleBlock}
            disabled={blockMut.isPending || unblockMut.isPending}
            className="gap-1.5"
            data-testid="btn-toggle-block"
          >
            {isBlocked ? (
              <>
                <ShieldCheck className="h-4 w-4" />
                Unblock
              </>
            ) : (
              <>
                <Ban className="h-4 w-4" />
                Block customer
              </>
            )}
          </Button>
        </div>
      </div>

      {isBlocked && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 flex items-start gap-3">
            <Ban className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-destructive">This customer is blocked.</p>
              <p className="text-muted-foreground">
                Outbound messages are disabled for all of their conversations. Internal notes are still allowed.
                {blockedReason ? <> &middot; <span className="italic">{blockedReason}</span></> : null}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Contact Brief
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={aiBriefMut.isPending}
            onClick={() =>
              aiBriefMut.mutate(undefined, {
                onSuccess: (data) => setAiBrief(data),
                onError: () => toast({ title: "Could not generate brief", variant: "destructive" }),
              })
            }
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${aiBriefMut.isPending ? "animate-spin" : ""}`} />
            {aiBrief ? "Refresh" : "Generate"}
          </Button>
        </CardHeader>
        {aiBrief && (
          <CardContent className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
            {(["profile", "clinical", "communication", "nextAction", "risk"] as const).map((key) => (
              <div key={key} className="space-y-1">
                <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
                  {key === "nextAction" ? "Next action" : key}
                </p>
                <p>{aiBrief[key]}</p>
              </div>
            ))}
          </CardContent>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Profile card */}
        <div className="space-y-4">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12">
                  <AvatarFallback className="bg-primary/10 text-primary font-semibold text-lg">
                    {customer.name.substring(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <CardTitle className="text-base">{customer.name}</CardTitle>
                  <p className="text-sm text-muted-foreground">{customer.branch ?? "No branch"}</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="h-3.5 w-3.5 shrink-0" />
                <span>{customer.phone}</span>
              </div>
              {customer.branch && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span>{customer.branch}</span>
                </div>
              )}
              {(customer as { address?: string | null }).address && (
                <div className="flex items-start gap-2 text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5 text-emerald-600" />
                  <span className="break-words">
                    {(customer as { address?: string | null }).address}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="h-3.5 w-3.5 shrink-0" />
                <span>Joined {format(parseISO(customer.createdAt), "MMM d, yyyy")}</span>
              </div>
            </CardContent>
          </Card>

          {customer.prescriptionNotes && (
            <Card className="shadow-sm border-blue-200 bg-blue-50/30 dark:bg-blue-900/10 dark:border-blue-900">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5 text-blue-700 dark:text-blue-400">
                  <FileText className="h-3.5 w-3.5" />
                  Clinical / Prescription Notes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {customer.prescriptionNotes}
                </p>
              </CardContent>
            </Card>
          )}

          {customer.notes && (
            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">General Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {customer.notes}
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Conversation history */}
        <div className="md:col-span-2 space-y-4">
          <h3 className="font-semibold text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            Conversation History
            <span className="text-muted-foreground font-normal text-sm">
              ({conversations?.length ?? 0} total)
            </span>
          </h3>

          {convsLoading
            ? Array(3).fill(0).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))
            : conversations?.length === 0
              ? (
                <Card className="shadow-sm">
                  <CardContent className="h-32 flex items-center justify-center text-muted-foreground text-sm">
                    <div className="text-center">
                      <MessageSquare className="h-6 w-6 mx-auto mb-2 opacity-20" />
                      No conversations yet
                    </div>
                  </CardContent>
                </Card>
              )
              : conversations?.map((conv) => (
                <Card
                  key={conv.id}
                  className="shadow-sm hover:shadow-md transition-shadow cursor-default"
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge
                            variant={
                              conv.status === "open"
                                ? "default"
                                : conv.status === "completed"
                                  ? "secondary"
                                  : "outline"
                            }
                            className="text-[10px] h-5 px-1.5 capitalize"
                          >
                            {conv.status}
                          </Badge>
                          {conv.tags?.map((tag, i) => (
                            <Badge
                              key={i}
                              variant="outline"
                              className="text-[10px] h-5 px-1.5"
                            >
                              {tag}
                            </Badge>
                          ))}
                        </div>
                        {conv.lastMessage && (
                          <p className="text-sm text-muted-foreground truncate">
                            {conv.lastMessage}
                          </p>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground shrink-0">
                        {conv.lastMessageAt
                          ? formatDistanceToNow(parseISO(conv.lastMessageAt), {
                            addSuffix: true,
                          })
                          : format(parseISO(conv.createdAt), "MMM d")}
                      </div>
                    </div>
                    {conv.assignedAgent && (
                      <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Avatar className="h-4 w-4">
                          <AvatarFallback className="text-[8px] bg-primary/10 text-primary">
                            {conv.assignedAgent.name.substring(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span>{conv.assignedAgent.name}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
        </div>
      </div>
    </div>
  );
}

function CreateCustomerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createMut = useCreateCustomer();

  const form = useForm<z.infer<typeof createCustomerSchema>>({
    resolver: zodResolver(createCustomerSchema),
    defaultValues: {
      name: "",
      phone: "",
      branch: "",
      address: "",
      tags: [],
      notes: "",
      prescriptionNotes: "",
    },
  });

  // Pull existing customer tags so the multi-select can suggest them
  const { data: existingCustomers } = useListCustomers({});
  const knownTags = React.useMemo(() => {
    const set = new Set<string>();
    existingCustomers?.forEach((c) => c.tags?.forEach((t) => t && set.add(t)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [existingCustomers]);

  const onSubmit = (values: z.infer<typeof createCustomerSchema>) => {
    const tagsArray = (values.tags ?? []).map((t) => t.trim()).filter(Boolean);

    createMut.mutate(
      // address is a new field on the customer schema not yet in the
      // generated openapi types; cast keeps TS happy while the server
      // still validates the payload.
      {
        data: {
          name: values.name,
          phone: values.phone,
          branch: values.branch,
          address: values.address,
          tags: tagsArray,
          notes: values.notes,
          prescriptionNotes: values.prescriptionNotes,
        } as never,
      },
      {
        onSuccess: () => {
          toast({ title: "Customer profile created successfully" });
          queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() });
          form.reset();
          onOpenChange(false);
        },
        onError: () => {
          toast({ title: "Failed to create profile", variant: "destructive" });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button data-testid="btn-create-customer">
          <Plus className="h-4 w-4 mr-2" />
          Add customer
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>Create customer profile</DialogTitle>
          <DialogDescription>
            Add a new customer so agents can keep notes on their profile.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone Number *</FormLabel>
                    <FormControl>
                      <Input placeholder="+1 (555) 000-0000" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="branch"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Home Branch</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select branch" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Downtown">Downtown</SelectItem>
                        <SelectItem value="Westside">Westside</SelectItem>
                        <SelectItem value="North">North Hills</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="tags"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tags</FormLabel>
                    <FormControl>
                      <TagsMultiSelect
                        value={field.value ?? []}
                        onChange={field.onChange}
                        options={knownTags}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-1.5">
                    <MapPin className="h-3 w-3" />
                    Address
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="123 Main St, Apt 4B, Cairo, Egypt"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="prescriptionNotes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center text-blue-600 dark:text-blue-400">
                    <FileText className="h-3 w-3 mr-1.5" />
                    Clinical / Prescription Notes
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Medication allergies, current prescriptions, dosage instructions..."
                      className="resize-none border-blue-200 focus-visible:ring-blue-500 bg-blue-50/50 dark:bg-blue-900/10 dark:border-blue-900"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>General Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Delivery instructions, preferred contact times..."
                      className="resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMut.isPending}>
                {createMut.isPending ? "Saving..." : "Save Profile"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Tags multi-select — pick from existing customer tags or add a new one.
// ---------------------------------------------------------------------------
function TagsMultiSelect({
  value,
  onChange,
  options,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  options: string[];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const toggle = (tag: string) => {
    if (value.includes(tag)) onChange(value.filter((t) => t !== tag));
    else onChange([...value, tag]);
  };

  const addNew = () => {
    const t = draft.trim();
    if (!t) return;
    if (!value.includes(t)) onChange([...value, t]);
    setDraft("");
  };

  const filtered = options.filter(
    (o) => !draft || o.toLowerCase().includes(draft.toLowerCase()),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          className="w-full justify-between font-normal h-auto min-h-10 py-2"
          data-testid="tags-multiselect-trigger"
        >
          <div className="flex flex-wrap gap-1 items-center">
            {value.length === 0
              ? <span className="text-muted-foreground">Select tags...</span>
              : value.map((tag) => (
                <Badge key={tag} variant="secondary" className="font-normal text-xs gap-1">
                  {tag}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(tag);
                    }}
                    className="hover:text-destructive"
                  >
                    <XIcon className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
          </div>
          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
        <div className="p-2 border-b border-border">
          <div className="flex gap-1.5">
            <Input
              placeholder="Search or add new tag"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addNew();
                }
              }}
              className="h-8 text-sm"
              data-testid="tags-multiselect-search"
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-8"
              onClick={addNew}
              disabled={!draft.trim()}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>
        <ScrollArea className="max-h-56">
          <div className="p-1">
            {filtered.length === 0
              ? (
                <p className="text-xs text-muted-foreground p-3 text-center">
                  No tags yet. Type above to add one.
                </p>
              )
              : filtered.map((tag) => {
                const checked = value.includes(tag);
                return (
                  <label
                    key={tag}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-accent cursor-pointer text-sm"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggle(tag)}
                    />
                    <span className="flex-1">{tag}</span>
                    {checked && <Check className="h-3.5 w-3.5 text-primary" />}
                  </label>
                );
              })}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

