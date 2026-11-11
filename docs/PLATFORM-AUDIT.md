# Fratelanza Chat System — platform audit & roadmap

Audit of the codebase against the "enterprise omnichannel" specification.
Status values: **Done** (works end-to-end against real data), **Partial**
(works, but part of the spec is missing), **Missing** (not built), **Needs
credentials** (code path exists or is feasible, but needs an external account).
Nothing below is a UI-only placeholder unless it says so.

## Phase 1 (this change): supervision, Whisper Mode, monitoring, audit trail

| Feature | Status | Notes |
|---|---|---|
| Supervisor / Team-leader role | **Done** | New role `supervisor` (plain text column — no data change). Defaults: monitor, whisper, take over, view reports; no settings access. |
| Permissions: monitor / whisper / take over | **Done** | New flags on `role_permissions` and per-user overrides. Agents can never hold them (enforced on the server, even if an override says otherwise). |
| Live monitoring of any agent's chat | **Done** | Supervisors open any chat read-only; real-time via the existing socket rooms; opening someone else's chat is logged (`monitor.open`, at most once per 10 min per chat). The agent's unread badge is not cleared by a supervisor viewing. |
| Whisper Mode (supervisor ⇄ agent, private) | **Done** | Separate table `whisper_messages` and API `/api/conversations/:id/whispers`. Never touches `messages`, so it cannot reach WhatsApp, webhooks, campaigns, exports, AI briefs or the customer thread. An agent only sees threads where they are the agent; socket events go only to `user:<agentId>` and the supervisors' room. Agents can reply or ask a supervisor first. |
| Whisper notifications | **Done** | Live toast with "Open", unread counts (`/api/whispers/unread`), badge on Live Monitor for agent replies. |
| Internal notes vs whisper | **Done** | Notes (amber, `messages.is_note`) are visible to all staff on the chat; whispers (violet) are a separate type with separate permissions. |
| Takeover / hand back | **Done** | `POST /conversations/:id/takeover` and `/release`. Supervisor becomes the responder; original agent stored in `takeover_from_agent_id`; hand back returns it (or to the queue if the agent was deactivated). Internal system notes mark both events; both are audited. Takeover replies are normal customer messages — never whispers. |
| Live Monitor page | **Done** | Agents strip (status, open chats, awaiting reply), queues with counts: Active, Last client message, SLA risk (≥ ½ SLA, red when breached), Hanging (configurable hours), Unassigned, Long waiting (> SLA in queue). Filter by agent/channel; actions: Open, Take over, Assign / back to queue. 10s refresh + socket push. |
| Activity log | **Done** | Append-only `audit_logs`: sign-ins (and failed sign-ins), user create/update/activate/deactivate/delete/reset-link, role & user permission changes, assignments (single/bulk), takeovers, whispers (metadata only, not the text), monitoring, settings changes. Settings → Security → Activity Log (admins), filter + paging. |
| Last login | **Done** | `users.last_login_at`, shown in Users & Roles. |
| Security fix | **Done** | Removed the socket handler that let any logged-in browser broadcast fake delivered/read ticks to everyone. Ticks now come only from the WhatsApp status webhook. `GET /users/:id/permissions` now reports the user's real role (it trusted a query parameter). |

## Phase 2: channels, teams, automation, CRM, deliveries

| Feature | Status | Notes |
|---|---|---|
| Facebook Messenger | **Done — needs credentials** | Signed webhook `/api/webhooks/messenger` (verify token + app-secret signature, fail closed), customers by PSID, names from Meta, attachments, echoes from Business Suite, delivery/read receipts, replies via the Send API within 24h. Turns on when `MESSENGER_PAGE_ACCESS_TOKEN` is set. Public use needs Meta App Review (`pages_messaging`). Setup: `deploy/MESSENGER_INSTAGRAM_SETUP.md`. |
| Instagram Direct | **Done — needs credentials** | Same as Messenger at `/api/webhooks/instagram` (Facebook-login Page token or Instagram-login `IG…` token). Needs `instagram_manage_messages` review. |
| Channels screen | **Done** | Settings → Channels: configuration checklist (never shows secrets), callback URLs, webhook fields, live counters, read-only "Test connection". |
| Teams / groups | **Done** | Leader (supervisor/admin) + members; topics route chats to a team; team queues (auto-assignment only within the team); transfer to a team from the inbox and Live Monitor; team filters. |
| Speed messages | **Done** | Categories, `/shortcut` in the composer, visibility (everyone / team / personal), language tag, variables (`{{customer_name}}`, `{{first_name}}`, `{{agent_name}}`, `{{company}}`, `{{date}}`, `{{time}}`, `{{phone}}`, `{{order_number}}`), usage counts. |
| WhatsApp templates | **Done — needs `WHATSAPP_BUSINESS_ACCOUNT_ID`** | Read-only sync, approval status (sync + webhook), send from a chat with placeholders and preview (works after 24h), analytics (sent / delivered / read / failed / replied ≤24h). Media-header and dynamic-link templates are listed but not sendable yet. |
| Inbound media | **Done** | Photos, voice notes, video, documents, stickers (WhatsApp) and Messenger/Instagram attachments downloaded (≤20 MB), stored in the database, shown inline; served by unguessable key with `nosniff` and a sandbox CSP. |
| CRM | **Done** | Email + custom fields, CSV import (≤5,000 rows, never blanks data) / export (Excel-friendly, formula-safe), duplicate finder + merge, segments (new / returning / inactive / blocked), channel filter, activity timeline. |
| Bots & automation | **Done** | Menu / survey / action bots with welcome, menus, questions saved to the customer, routing to team / topic / tag, handover or close, fallbacks, opening hours, new-chat or keyword trigger; "agent" / "موظف" always reaches a person. Off by default; never runs while sending is off; steps back once an agent has the chat. Visual editor, "Test bot" simulator, stats. |
| Drivers & deliveries | **Done (new module)** | No drivers module existed. Drivers (availability follows active orders, history), groups, orders linked to customer and chat with status history; each change notes the chat and can notify the customer. |
| Scheduled messages | **Done (existing)** | Campaign scheduling. |
| Feed bot / subscription types / subscribers | **Not built** | Broadcasts are covered by Campaigns; opt-in subscriber lists are not built. |
| Excel (.xlsx) export | **Partial** | CSV exports open in Excel; no native .xlsx. |
| Arabic interface / full RTL | **Not built** | Message text and Arabic fields are RTL-aware; the interface has no translation layer yet. Largest remaining item. |
| Stores / locations screen | **Not built** | Customers keep a branch; no store management. |
| Full-text search across all messages | **Partial** | Inbox search covers name, phone and loaded messages. |
| Very large inboxes | **Partial** | Indexes added; the conversation list still loads in one request. |

## Before Phase 1 (unchanged, still working)

| Area | Status | Notes |
|---|---|---|
| WhatsApp Cloud API (in/out, statuses, 24h window, Coexistence echoes/history/contacts) | **Done** | Signed webhook, dedupe, kill switch. |
| Unified inbox, channel filter chips, topics grouping, lists/tags, bulk actions, unread counters, live updates | **Done** | |
| Search | **Partial** | Name/phone/message search in the inbox list; no server-side search by agent or message history across all chats. |
| Sorting | **Partial** | Latest activity + grouping; no explicit oldest/priority sort selector. |
| Assignment, auto-assign, per-user limits, queue | **Done** | Supervisors can now also reassign. |
| Internal notes | **Done** | |
| Attachments | **Done** | Agents attach images/PDF (≤400 KB); inbound media is shown inline (Phase 2). |
| Chat Reasons (topics), categories, Not-Ready reasons, tags | **Done** | |
| Customers / Mini CRM | **Done** | Profiles, notes, tags, block, history, AI brief; Phase 2 adds the rest (below). |
| Reports & dashboard | **Partial** | Real-data reports with CSV export (overview, volume, response times, customers, branches, tags, heatmap, agent performance). Missing: Excel export, team dimension. |
| Campaigns | **Done** | Broadcasts and scheduling; template sending is now available per chat (Phase 2). |
| Users, roles, permissions, deactivate, reset links, forced password change | **Done** | |
| Branding, PWA, responsive layout | **Done** | |

## Database changes in Phase 1 (additive only)

- New tables: `whisper_messages`, `audit_logs`.
- New nullable/defaulted columns: `users.last_login_at`, `conversations.takeover_from_agent_id`, `conversations.takeover_at`, `settings.hanging_hours` (default 24), `role_permissions.can_monitor_chats|can_whisper|can_takeover` (default false), `user_permissions.can_monitor_chats|can_whisper|can_takeover` (nullable).
- `users.role` / `role_permissions.role` accept `supervisor` (text columns — no DB change).
- Verified with `drizzle-kit push` (no `--force`) against a database with the previous schema: only CREATE TABLE / ADD COLUMN / CREATE INDEX, existing rows kept.

## New API endpoints (Phase 1)

| Method & path | Who |
|---|---|
| `GET/POST /api/conversations/:id/whispers` | Supervisors with `canWhisper`; the agent on the chat (own thread only) |
| `POST /api/conversations/:id/whispers/read` | same |
| `GET /api/whispers/unread` | any signed-in user (own counts) |
| `POST /api/conversations/:id/takeover` | `canTakeover` |
| `POST /api/conversations/:id/release` | the supervisor holding it, or an admin |
| `GET /api/monitoring?view=&agentId=&channel=` | `canMonitorChats` |
| `GET /api/audit-logs?action=&before=&limit=` | admins |

Changed (backward compatible): conversation responses include `takeoverFromAgentId`/`takeoverAt`; user responses include `lastLoginAt`; `/api/role-permissions` always lists admin, supervisor, agent; `/api/users/workload` is open to supervisors; `PUT /api/settings` accepts `hangingHours`.

## Database changes in Phase 2 (additive only)

- New tables: `teams`, `quick_reply_categories`, `whatsapp_templates`, `media_files`, `customer_fields`, `bots`, `bot_sessions`, `driver_groups`, `drivers`, `delivery_orders`, `delivery_events`.
- New nullable/defaulted columns: `customers.messenger_psid`, `customers.instagram_id` (unique, nullable), `customers.email`, `customers.custom_fields`, `users.team_id`, `conversations.team_id`, `chat_reasons.team_id`, `quick_replies.category_id|shortcut|visibility (default 'all')|team_id|owner_id|language|usage_count|last_used_at`, `messages.template_id`, `messages.is_bot` (default false).
- New indexes on conversations (customer, agent, last message) and messages (conversation, id).
- Nothing is dropped, renamed or rewritten; existing quick replies stay visible to everyone.

## New API endpoints (Phase 2)

| Area | Endpoints |
|---|---|
| Messenger / Instagram | `GET/POST /api/webhooks/messenger`, `GET/POST /api/webhooks/instagram`; `GET /api/channels/status[?check=1]` |
| Teams | `GET/POST /api/teams`, `PUT/DELETE /api/teams/:id`, `PUT /api/teams/:id/members`; bulk action `team` |
| Speed messages | `GET/POST /api/quick-replies`, `PUT/DELETE /api/quick-replies/:id`, `POST /api/quick-replies/:id/use`, `GET/POST/DELETE /api/quick-reply-categories` |
| Templates | `GET /api/whatsapp/templates`, `POST /api/whatsapp/templates/sync`, `POST /api/conversations/:id/template`, `GET /api/whatsapp/templates/analytics` |
| Media | `GET /api/media/:key` |
| CRM | `GET/POST/DELETE /api/customer-fields`, `GET /api/customers/export.csv`, `POST /api/customers/import`, `GET /api/customers/duplicates`, `POST /api/customers/:id/merge`, `GET /api/customers/:id/timeline`, `GET /api/customers?segment=&channel=` |
| Bots | `GET/POST /api/bots`, `GET/PUT/DELETE /api/bots/:id`, `POST /api/bots/:id/active`, `POST /api/bots/simulate`, `GET /api/bots/:id/analytics` |
| Deliveries | `GET/POST /api/driver-groups`, `DELETE /api/driver-groups/:id`, `GET/POST /api/drivers`, `PUT /api/drivers/:id`, `GET /api/drivers/:id/history`, `GET/POST /api/deliveries`, `GET/PATCH /api/deliveries/:id` |

## New server settings (optional; empty = feature off)

`WHATSAPP_BUSINESS_ACCOUNT_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `MESSENGER_PAGE_ACCESS_TOKEN`, `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_GRAPH_HOST`, `BOT_TIMEZONE` (default Africa/Cairo). Passed through `deploy/docker-compose.yml`, documented in `deploy/.env.example`.

## Testing (Phase 2)

Against Postgres with a mock Meta Graph server (no real Meta calls): 195 API checks in 8 suites (Phase 1 regression 56, Messenger/Instagram 21, teams 21, speed messages 14, templates + media 18, CRM 23, bots 22, deliveries 20), all passing on fresh databases. Typecheck and production build clean. Browser test: bot simulator, delivery creation, customer import, all new settings sections, `/shortcut` filling, chat deliveries panel — no page errors; no horizontal overflow at 390 px on Bots, Deliveries, Customers, Live Monitor, Settings and Inbox.
