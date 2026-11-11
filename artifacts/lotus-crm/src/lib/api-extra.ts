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

export interface AgeBucket {
  bucket: "today" | "1-3" | "4-7" | "8-30" | "30+";
  count: number;
}

export interface TopicAging {
  topicId: number | null;
  name: string;
  color: string;
  total: number;
  active: number;
  waitingOnUs: number;
  avgDaysSinceLast: number;
}

export interface OldestWaiting {
  conversationId: number;
  customerName: string;
  phone: string;
  lastMessage: string;
  lastMessageAt: string | null;
  topic: string | null;
  topicColor: string | null;
  daysWaiting: number;
}

export interface InsightsResponse {
  aging?: {
    waitingOnUs: AgeBucket[];
    waitingOnCustomer: AgeBucket[];
    byTopic: TopicAging[];
    oldestWaiting: OldestWaiting[];
  };
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
export type RoleName = "admin" | "supervisor" | "agent";

export interface RolePermissions {
  role: RoleName;
  canViewChats: boolean;
  canSendMessages: boolean;
  canViewReports: boolean;
  canManageCustomers: boolean;
  canManageSettings: boolean;
  canMonitorChats: boolean;
  canWhisper: boolean;
  canTakeover: boolean;
  updatedAt: string | null;
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
  /** Supervisors/admins: open other people's live chats. */
  canMonitorChats: boolean;
  /** Supervisors/admins: private messages to the agent (Whisper Mode). */
  canWhisper: boolean;
  /** Supervisors/admins: take a chat over and hand it back. */
  canTakeover: boolean;
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
    canMonitorChats: row?.canMonitorChats ?? (role !== "agent"),
    canWhisper: row?.canWhisper ?? (role !== "agent"),
    canTakeover: row?.canTakeover ?? (role !== "agent"),
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
  keywords?: string[];
  /** Chats filed under this topic are routed to this team. */
  teamId?: number | null;
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
    mutationFn: (data: { nameEn: string; nameAr: string; color: string; categoryId: number | null; keywords?: string[]; teamId?: number | null }) =>
      customFetch<ChatReason>("/api/chat-reasons", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/chat-reasons"] }),
  });
}

export function useUpdateChatReason() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; nameEn?: string; nameAr?: string; color?: string; categoryId?: number | null; keywords?: string[]; isActive?: boolean; teamId?: number | null }) =>
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


// ---------------------------------------------------------------------------
// Server capabilities + bulk inbox actions + topic re-filing
// ---------------------------------------------------------------------------
export interface SystemStatus {
  outboundEnabled: boolean;
  sendingConfigured?: boolean;
  webhooks?: { since: string; events: Record<string, { count: number; lastAt: string }> };
}

export interface Workload {
  id: number;
  name: string;
  displayName: string | null;
  role: string;
  status: string;
  isActive: boolean;
  maxChats: number | null;
  effectiveMax: number;
  defaultMax: number;
  openChats: number;
}

/** Admin-only: open chats per person vs. their limit. */
export function useWorkload(enabled = true) {
  return useQuery({
    queryKey: ["/api/users/workload"],
    queryFn: () => customFetch<Workload[]>("/api/users/workload"),
    enabled,
    staleTime: 10_000,
  });
}

export function useSystemStatus() {
  return useQuery({
    queryKey: ["/api/system"],
    queryFn: () => customFetch<SystemStatus>("/api/system"),
    staleTime: 60_000,
  });
}

export type BulkAction =
  | { action: "topic"; value: number | null }
  | { action: "addTag" | "removeTag"; value: string }
  | { action: "status"; value: "open" | "pending" | "completed" }
  | { action: "read" | "assignMe"; value?: undefined }
  | { action: "assign"; value: number | null }
  | { action: "team"; value: number | null };

export function useBulkConversations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, ...a }: { ids: number[] } & BulkAction) =>
      customFetch<{ updated: number; skipped: number }>("/api/conversations/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, ...a }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["/api/conversations"] });
      void qc.invalidateQueries({ queryKey: ["/api/inbox/sync"] });
      void qc.invalidateQueries({ queryKey: ["/api/insights"] });
      void qc.invalidateQueries({ queryKey: ["/api/users/workload"] });
    },
  });
}

export function useReclassifyTopics() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => customFetch<{ checked: number; filed: number }>("/api/chat-reasons/reclassify", { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["/api/conversations"] });
      void qc.invalidateQueries({ queryKey: ["/api/insights"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Supervision: Whisper Mode, takeover, live monitoring, activity log
// ---------------------------------------------------------------------------
export interface Whisper {
  id: number;
  conversationId: number;
  agentId: number;
  senderId: number;
  senderName: string | null;
  senderRole: string | null;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export const whispersKey = (conversationId: number) => ["/api/conversations", conversationId, "whispers"] as const;

export function useWhispers(conversationId: number | null) {
  return useQuery({
    queryKey: whispersKey(conversationId ?? 0),
    queryFn: () => customFetch<Whisper[]>(`/api/conversations/${conversationId}/whispers`),
    enabled: conversationId != null,
    staleTime: 5_000,
  });
}

export function useSendWhisper(conversationId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      customFetch<Whisper>(`/api/conversations/${conversationId}/whispers`, { method: "POST", body: JSON.stringify({ body }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: whispersKey(conversationId ?? 0) }),
  });
}

export function useMarkWhispersRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: number) =>
      customFetch(`/api/conversations/${conversationId}/whispers/read`, { method: "POST", body: "{}" }),
    onSuccess: (_d, conversationId) => {
      void qc.invalidateQueries({ queryKey: ["/api/whispers/unread"] });
      void qc.invalidateQueries({ queryKey: whispersKey(conversationId) });
    },
  });
}

export function useWhisperUnread() {
  return useQuery({
    queryKey: ["/api/whispers/unread"],
    queryFn: () => customFetch<{ total: number; byConversation: Record<string, number> }>("/api/whispers/unread"),
    refetchInterval: 30_000,
  });
}

function useConversationAction(path: "takeover" | "release") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: number) =>
      customFetch<{ ok: boolean }>(`/api/conversations/${conversationId}/${path}`, { method: "POST", body: "{}" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/conversations"] });
      qc.invalidateQueries({ queryKey: ["/api/monitoring"] });
    },
  });
}
export const useTakeover = () => useConversationAction("takeover");
export const useReleaseTakeover = () => useConversationAction("release");

export type MonitoringView = "active" | "hanging" | "last_client" | "unassigned" | "long_waiting" | "sla";

export interface MonitoringRow {
  id: number;
  status: string;
  channel: string;
  created_at: string;
  last_message_at: string | null;
  last_sender_type: string | null;
  last_message: string | null;
  unread_count: number;
  queued_at: string | null;
  assigned_agent_id: number | null;
  agent_name: string | null;
  agent_status: string | null;
  takeover_from_agent_id: number | null;
  takeover_from_name: string | null;
  team_id: number | null;
  team_name: string | null;
  takeover_at: string | null;
  customer_id: number;
  customer_name: string;
  customer_phone: string;
  waiting_minutes: number | null;
  age_minutes: number;
  sla_breached: boolean;
}

export interface MonitoringAgent {
  id: number;
  name: string;
  role: string;
  status: string;
  last_login_at: string | null;
  open_chats: number;
  awaiting_reply: number;
}

export interface MonitoringResponse {
  view: MonitoringView;
  thresholds: { slaMinutes: number; hangingHours: number };
  counts: Partial<Record<MonitoringView, number>>;
  agents: MonitoringAgent[];
  conversations: MonitoringRow[];
}

export function useMonitoring(view: MonitoringView, filters: { agentId?: number; channel?: string; teamId?: number }) {
  const qs = new URLSearchParams({ view });
  if (filters.teamId) qs.set("teamId", String(filters.teamId));
  if (filters.agentId) qs.set("agentId", String(filters.agentId));
  if (filters.channel) qs.set("channel", filters.channel);
  return useQuery({
    queryKey: ["/api/monitoring", view, filters.agentId ?? 0, filters.channel ?? "", filters.teamId ?? 0],
    queryFn: () => customFetch<MonitoringResponse>(`/api/monitoring?${qs}`),
    refetchInterval: 10_000,
  });
}

export interface AuditLogRow {
  id: number;
  actorId: number | null;
  actorName: string | null;
  action: string;
  entityType: string | null;
  entityId: number | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export function useAuditLogs(filters: { action?: string; before?: number | null }) {
  const qs = new URLSearchParams({ limit: "100" });
  if (filters.action) qs.set("action", filters.action);
  if (filters.before) qs.set("before", String(filters.before));
  return useQuery({
    queryKey: ["/api/audit-logs", filters.action ?? "", filters.before ?? 0],
    queryFn: () => customFetch<{ rows: AuditLogRow[]; nextBefore: number | null }>(`/api/audit-logs?${qs}`),
  });
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------
export interface TeamMember { id: number; name: string; role: string; status: string }
export interface Team {
  id: number;
  name: string;
  description: string | null;
  color: string | null;
  leaderId: number | null;
  leaderName: string | null;
  isActive: boolean;
  memberCount: number;
  members: TeamMember[];
  openChats: number;
  queued: number;
}

export function useTeams() {
  return useQuery({ queryKey: ["/api/teams"], queryFn: () => customFetch<Team[]>("/api/teams"), staleTime: 30_000 });
}

export function useSaveTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: number; data: Partial<Pick<Team, "name" | "description" | "color" | "leaderId" | "isActive">> }) =>
      customFetch<Team>(id ? `/api/teams/${id}` : "/api/teams", { method: id ? "PUT" : "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/teams"] }),
  });
}

export function useSetTeamMembers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, userIds }: { id: number; userIds: number[] }) =>
      customFetch(`/api/teams/${id}/members`, { method: "PUT", body: JSON.stringify({ userIds }) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["/api/teams"] });
      void qc.invalidateQueries({ queryKey: ["/api/users"] });
    },
  });
}

export function useDeleteTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => customFetch(`/api/teams/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/teams"] }),
  });
}
