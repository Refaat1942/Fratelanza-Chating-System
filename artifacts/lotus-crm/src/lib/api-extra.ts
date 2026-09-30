// Thin wrappers around customFetch for endpoints not yet in the openapi
// codegen pipeline (insights, branding, campaigns, role-permissions).
// Keeps things type-safe without requiring an orval regen for every new feature.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

export type ChatSeverity = "normal" | "medium" | "high" | "critical";

export interface UnrepliedChat {
  conversationId: number;
  customerId: number;
  customerName: string;
  phone: string;
  channel: string;
  lastMessage: string;
  lastMessageAt: string | null;
  agentName: string | null;
  minutesWaiting: number;
  severity: ChatSeverity;
}

export interface ActiveCustomer {
  customerId: number;
  customerName: string;
  phone: string;
  branch: string | null;
  messageCount: number;
  conversationCount: number;
  lastSeenAt: string | null;
}

export interface InsightsResponse {
  slaMinutes: number;
  summary: {
    unrepliedCount: number;
    urgentCount: number;
    avgReplyMinutes: number;
    mostActiveCount: number;
  };
  unrepliedChats: UnrepliedChat[];
  urgentChats: UnrepliedChat[];
  mostActive: ActiveCustomer[];
  channelCounts: Record<string, number>;
  generatedAt: string;
}

export function useInsights() {
  return useQuery({
    queryKey: ["/api/insights"],
    queryFn: () => customFetch<InsightsResponse>("/api/insights"),
    refetchInterval: 30_000,
  });
}

export interface Branding {
  companyName: string;
  logoUrl: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
}

export function useBranding() {
  return useQuery({
    queryKey: ["/api/branding"],
    queryFn: () => customFetch<Branding>("/api/branding"),
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Marketing campaigns
// ---------------------------------------------------------------------------
export type CampaignChannel = "whatsapp" | "messenger" | "instagram" | "sms" | "email";
export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "partial" | "failed";

export interface Campaign {
  id: number;
  name: string;
  channel: CampaignChannel;
  message: string;
  audience: string;
  status: CampaignStatus;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  scheduledAt: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface CreateCampaignInput {
  name: string;
  channel: CampaignChannel;
  message: string;
  audience?: string;
  customerIds?: number[];
  scheduledAt?: string | null;
}

export interface CampaignRecipient {
  id: number;
  customerId: number;
  customerName: string;
  phone: string;
  status: "pending" | "sent" | "failed";
  error: string | null;
  sentAt: string | null;
}

const CAMPAIGNS_KEY = ["/api/campaigns"] as const;

export function useCampaigns() {
  return useQuery({
    queryKey: CAMPAIGNS_KEY,
    queryFn: () => customFetch<Campaign[]>("/api/campaigns"),
  });
}

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCampaignInput) =>
      customFetch<Campaign>("/api/campaigns", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CAMPAIGNS_KEY }),
  });
}

export function useDeleteCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      customFetch<void>(`/api/campaigns/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CAMPAIGNS_KEY }),
  });
}

export function useSendCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      customFetch<Campaign & { providerStatus: string; message: string }>(
        `/api/campaigns/${id}/send`,
        { method: "POST", body: "{}" },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: CAMPAIGNS_KEY }),
  });
}

export function useCampaignRecipients(campaignId: number | null) {
  return useQuery({
    queryKey: ["/api/campaigns", campaignId, "recipients"],
    queryFn: () =>
      customFetch<CampaignRecipient[]>(`/api/campaigns/${campaignId}/recipients`),
    enabled: campaignId != null,
  });
}

// ---------------------------------------------------------------------------
// Role permissions (5 fixed booleans per role)
// ---------------------------------------------------------------------------
export type RoleName = "admin" | "agent";

export interface RolePermissions {
  role: RoleName;
  canViewChats: boolean;
  canSendMessages: boolean;
  canViewReports: boolean;
  canManageCustomers: boolean;
  canManageSettings: boolean;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Effective permissions (role + per-user overrides)
// ---------------------------------------------------------------------------
export interface EffectivePermissions {
  canViewChats: boolean;
  canSendMessages: boolean;
  canViewReports: boolean;
  canManageCustomers: boolean;
  canManageSettings: boolean;
}

export function useMyPermissions() {
  return useQuery({
    queryKey: ["/api/me/permissions"],
    queryFn: () => customFetch<EffectivePermissions>("/api/me/permissions"),
    staleTime: 30_000,
  });
}

export function useUploadAttachment() {
  return useMutation({
    mutationFn: ({ dataUrl, filename }: { dataUrl: string; filename: string }) =>
      customFetch<{ url: string; filename: string }>("/api/uploads", {
        method: "POST",
        body: JSON.stringify({ dataUrl, filename }),
      }),
  });
}

export interface CustomerAiBrief {
  source: "ai" | "deterministic";
  profile: string;
  clinical: string;
  communication: string;
  nextAction: string;
  risk: string;
  generatedAt: string;
}

export function useCustomerAiBrief(customerId: number | null) {
  return useMutation({
    mutationFn: () =>
      customFetch<CustomerAiBrief>(`/api/customers/${customerId}/ai-brief`, {
        method: "POST",
        body: "{}",
      }),
  });
}

export function useUserPermissionOverrides(userId: number | null, role: RoleName) {
  return useQuery({
    queryKey: ["/api/users", userId, "permissions", role],
    queryFn: () =>
      customFetch<{
        userId: number;
        role: RoleName;
        effective: EffectivePermissions;
        override: Record<string, boolean | null> | null;
      }>(`/api/users/${userId}/permissions?role=${role}`),
    enabled: userId != null,
  });
}

export function useUpdateUserPermissions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      data,
    }: {
      userId: number;
      data: Partial<Record<keyof EffectivePermissions, boolean | null>>;
    }) =>
      customFetch(`/api/users/${userId}/permissions`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["/api/users", vars.userId, "permissions"] });
      qc.invalidateQueries({ queryKey: ["/api/me/permissions"] });
    },
  });
}

const ROLE_PERMS_KEY = ["/api/role-permissions"] as const;

export function useRolePermissions() {
  return useQuery({
    queryKey: ROLE_PERMS_KEY,
    queryFn: () =>
      customFetch<RolePermissions[]>("/api/role-permissions"),
    staleTime: 60_000,
  });
}

export function useUpdateRolePermissions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      role,
      data,
    }: {
      role: RoleName;
      data: Partial<Omit<RolePermissions, "role" | "updatedAt">>;
    }) =>
      customFetch<RolePermissions>(`/api/role-permissions/${role}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ROLE_PERMS_KEY }),
  });
}

// ---------------------------------------------------------------------------
// Block / unblock customer
// ---------------------------------------------------------------------------
export function useBlockCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
      customFetch<unknown>(`/api/customers/${id}/block`, {
        method: "POST",
        body: JSON.stringify({ reason: reason ?? "" }),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["/api/customers"] });
      qc.invalidateQueries({ queryKey: [`/api/customers/${vars.id}`] });
    },
  });
}

export function useUnblockCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      customFetch<unknown>(`/api/customers/${id}/unblock`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["/api/customers"] });
      qc.invalidateQueries({ queryKey: [`/api/customers/${id}`] });
    },
  });
}

/**
 * Convenience: returns role-level permissions (legacy). Prefer useMyPermissions().
 */
export function usePermissionsFor(role: RoleName | undefined) {
  const { data: myPerms } = useMyPermissions();
  if (myPerms) return myPerms;
  const { data } = useRolePermissions();
  const row = data?.find((r) => r.role === role);
  return {
    canViewChats: row?.canViewChats ?? true,
    canSendMessages: row?.canSendMessages ?? true,
    canViewReports: row?.canViewReports ?? (role === "admin"),
    canManageCustomers: row?.canManageCustomers ?? true,
    canManageSettings: row?.canManageSettings ?? (role === "admin"),
  };
}

// ---------------------------------------------------------------------------
// Chat Reason Categories (Awfar-inspired) — admin CRUD
// ---------------------------------------------------------------------------
export interface ChatReasonCategory {
  id: number;
  titleEn: string;
  titleAr: string;
  isActive: boolean;
  createdAt: string;
}

export function useChatReasonCategories() {
  return useQuery({
    queryKey: ["/api/chat-reason-categories"],
    queryFn: () => customFetch<ChatReasonCategory[]>("/api/chat-reason-categories"),
  });
}

export function useCreateChatReasonCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { titleEn: string; titleAr: string }) =>
      customFetch<ChatReasonCategory>("/api/chat-reason-categories", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/chat-reason-categories"] }),
  });
}

export function useUpdateChatReasonCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; titleEn?: string; titleAr?: string }) =>
      customFetch<ChatReasonCategory>(`/api/chat-reason-categories/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/chat-reason-categories"] }),
  });
}

export function useDeleteChatReasonCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      customFetch<void>(`/api/chat-reason-categories/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/chat-reason-categories"] });
      qc.invalidateQueries({ queryKey: ["/api/chat-reasons"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Chat Reasons — admin CRUD; agents read for the conversation picker
// ---------------------------------------------------------------------------
export interface ChatReason {
  id: number;
  nameEn: string;
  nameAr: string;
  color: string;
  categoryId: number | null;
  isActive: boolean;
  createdAt: string;
  categoryTitleEn?: string | null;
  categoryTitleAr?: string | null;
}

export function useChatReasons() {
  return useQuery({
    queryKey: ["/api/chat-reasons"],
    queryFn: () => customFetch<ChatReason[]>("/api/chat-reasons"),
  });
}

export function useCreateChatReason() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { nameEn: string; nameAr: string; color: string; categoryId: number | null }) =>
      customFetch<ChatReason>("/api/chat-reasons", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/chat-reasons"] }),
  });
}

export function useUpdateChatReason() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; nameEn?: string; nameAr?: string; color?: string; categoryId?: number | null }) =>
      customFetch<ChatReason>(`/api/chat-reasons/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/chat-reasons"] }),
  });
}

export function useDeleteChatReason() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      customFetch<void>(`/api/chat-reasons/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/chat-reasons"] }),
  });
}

// ---------------------------------------------------------------------------
// Not-ready reasons — admin CRUD; agents pick when going off-shift
// ---------------------------------------------------------------------------
export interface NotReadyReason {
  id: number;
  key: string;
  value: string;
  isActive: boolean;
  createdAt: string;
}

export function useNotReadyReasons() {
  return useQuery({
    queryKey: ["/api/not-ready-reasons"],
    queryFn: () => customFetch<NotReadyReason[]>("/api/not-ready-reasons"),
  });
}

export function useCreateNotReadyReason() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { key: string; value: string }) =>
      customFetch<NotReadyReason>("/api/not-ready-reasons", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/not-ready-reasons"] }),
  });
}

export function useUpdateNotReadyReason() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; key?: string; value?: string }) =>
      customFetch<NotReadyReason>(`/api/not-ready-reasons/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/not-ready-reasons"] }),
  });
}

export function useDeleteNotReadyReason() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      customFetch<void>(`/api/not-ready-reasons/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/not-ready-reasons"] }),
  });
}

// ---------------------------------------------------------------------------
// Agent availability (ready / not-ready with reason)
// ---------------------------------------------------------------------------
export interface MyAvailability {
  isReady: boolean;
  notReadyReasonId: number | null;
  notReadySince: string | null;
  notReadyReason: string | null;
}

export function useMyAvailability() {
  return useQuery({
    queryKey: ["/api/me/availability"],
    queryFn: () => customFetch<MyAvailability>("/api/me/availability"),
    refetchInterval: 30_000,
  });
}

export function useUpdateMyAvailability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { notReadyReasonId: number | null }) =>
      customFetch<{ ok: boolean; isReady: boolean }>("/api/me/availability", {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/me/availability"] }),
  });
}

