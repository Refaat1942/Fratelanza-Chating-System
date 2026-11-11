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

## Already in the system before this change

| Area | Status | Notes |
|---|---|---|
| WhatsApp Cloud API (in/out, statuses, 24h window, Coexistence echoes/history/contacts) | **Done** | Signed webhook, dedupe, kill switch. |
| Unified inbox, channel filter chips, topics grouping, lists/tags, bulk actions, unread counters, live updates | **Done** | |
| Search | **Partial** | Name/phone/message search in the inbox list; no server-side search by agent or message history across all chats. |
| Sorting | **Partial** | Latest activity + grouping; no explicit oldest/priority sort selector. |
| Assignment, auto-assign, per-user limits, queue | **Done** | Supervisors can now also reassign. |
| Internal notes | **Done** | |
| Quick replies | **Partial** | Title + body; no categories, team visibility or variables yet. |
| Attachments | **Partial** | Agents can attach images/PDF (≤400 KB). Inbound WhatsApp media is shown as a label (e.g. "[Image]") — media download is not implemented. |
| Chat Reasons (topics), categories, Not-Ready reasons, tags | **Done** | |
| Customers / Mini CRM | **Partial** | Profiles, notes, tags, block, conversation history, AI brief. Missing: custom fields, import/export, duplicate detection, segments, timeline. |
| Reports & dashboard | **Partial** | Real-data reports with CSV export (overview, volume, response times, customers, branches, tags, heatmap, agent performance). Missing: Excel export, team dimension. |
| Campaigns | **Partial** | Broadcasts exist; approved WhatsApp template sending/status sync is not implemented. |
| Users, roles, permissions, deactivate, reset links, forced password change | **Done** | |
| Branding, PWA, responsive layout | **Done** | |

## Not built yet (recommended order)

1. **Teams/groups** — `teams` table, agent ↔ team, team leaders scoped to their team, team filters in inbox/monitor/reports.
2. **Speed messages v2** — categories, team/user visibility, `{{customer_name}}`-style variables (extend `quick_replies`).
3. **WhatsApp templates** — sync approved templates from Meta, send outside 24h, status tracking, usage analytics. *Needs the existing Meta credentials; read-only sync is safe.*
4. **Inbound media** — download WhatsApp media to storage and show images/voice/PDF inline.
5. **CRM v2** — custom fields, CSV import/export, duplicate detection (by normalised phone), segments, activity timeline.
6. **Reports v2** — Excel export, team dimension, Hanging/Last-client/Unassigned report exports (the live views already exist in Live Monitor).
7. **Facebook Messenger & Instagram DM** — *Needs credentials* (Page access token, app review for `pages_messaging` / `instagram_manage_messages`). A secret-protected generic intake (`POST /webhooks/messenger|instagram`) exists, but it is not Meta's signed Messenger/IG webhook and there is no outbound send.
8. **Bots & automation** (welcome menus, surveys, routing, hand-over) — not present; needs a flow model and engine.
9. **Drivers & delivery** — no drivers module exists in this codebase; it would be a new module.
10. **Arabic UI / full RTL** — message text is already bidi-safe, but the interface has no translation layer yet.
11. **Channels / Platforms / Stores screens** — only the WhatsApp diagnostics page exists today.

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
