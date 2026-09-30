# Lotus Pharmacies CRM — Server / Domain Handoff

This document lists everything needed to host the project on your own
servers and domains. Hand this file to your IT support.

---

## 1. What it is (architecture in one paragraph)

Three Docker containers managed by **one** `docker-compose.yml`:

| Container       | Image / build          | Listens on   | Public? |
|-----------------|------------------------|--------------|---------|
| `lotus_postgres`| `postgres:16-alpine`   | `5432` (internal only) | No |
| `lotus_api`     | built from `./Dockerfile`     | `8080` (internal only) | No |
| `lotus_web`     | built from `./Dockerfile.web` (nginx) | `80` inside, mapped to host `${WEB_PORT}` (default `8090`) | **Yes** |

The browser only ever talks to **`lotus_web`** (nginx).
nginx serves the static React build and reverse-proxies anything
under `/api/` (including the WebSocket upgrade for Socket.io) to
`lotus_api:8080`. The API talks to Postgres on the internal
`lotus_net` Docker network.

There are **no Replit-runtime dependencies**. WhatsApp is integrated through
the Meta WhatsApp Cloud API (inbound webhook + outbound send) — see
`deploy/WHATSAPP_SETUP.md`. Messenger / Instagram are channel labels plus a
secret-protected generic JSON hook.

---

## 2. Required ports / firewall

Open **only** the host port mapped to nginx:

* `${WEB_PORT}` (default **8090**) — TCP, public

Everything else (`5432` Postgres, `8080` API) stays inside Docker.

If you put a reverse proxy (Caddy / nginx / Traefik / Cloudflare
Tunnel) in front of the container, terminate TLS there and forward
to `127.0.0.1:${WEB_PORT}`.

---

## 3. Domains & DNS

The app is fine on a bare IP, but for production give it a domain:

1. Create an **A record**: `crm.yourcompany.com` → server's public IP.
2. (Recommended) Put Caddy / nginx / Cloudflare Tunnel in front of
   port `${WEB_PORT}` to terminate TLS.
   Minimal Caddyfile example:
   ```
   crm.yourcompany.com {
       reverse_proxy 127.0.0.1:8090
   }
   ```
   Caddy will get a free Let's Encrypt cert automatically.
3. The frontend uses **relative URLs** (`/api/...`), so the app
   works under any hostname or sub-path — no env var to change.

---

## 4. Required environment variables

Copy `deploy/.env.example` → `deploy/.env` and fill in:

| Var | Purpose | Example |
|-----|---------|---------|
| `POSTGRES_USER` | DB user | `lotus` |
| `POSTGRES_PASSWORD` | **Strong** DB password | `openssl rand -hex 24` |
| `POSTGRES_DB` | DB name | `lotus` |
| `JWT_SECRET` | **Required.** Signs login tokens. Min 32 chars. | `openssl rand -hex 48` |
| `RUN_SEED` | Run demo seed on first boot | `true` (then set `false` later) |
| `FORCE_RESEED` | One-shot wipe + reseed of demo data (preserves users) | leave unset |
| `WEB_PORT` | Host port nginx is exposed on | `8090` |

That's the **complete** env list. There are no API keys, no webhook
secrets, no SMTP, no S3.

---

## 5. First-time install on a fresh VPS

```bash
# 1. Install docker + git
curl -fsSL https://get.docker.com | sh
apt install -y git docker-compose-plugin

# 2. Clone
mkdir -p /opt && cd /opt
git clone https://github.com/Refaat1942/Pharma-SaaS-Hub.git lotus-crm
cd lotus-crm

# 3. Configure
cp deploy/.env.example deploy/.env
nano deploy/.env       # set POSTGRES_PASSWORD + JWT_SECRET

# 4. Build and start
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build

# 5. Verify
docker compose -f deploy/docker-compose.yml ps
curl -s http://localhost:8090/api/healthz   # should print {"status":"ok"}
```

App is now live at `http://<server-ip>:8090`.

---

## 6. Update / redeploy after a code change

```bash
cd /opt/lotus-crm
git pull
docker compose -f deploy/docker-compose.yml build --no-cache
docker compose -f deploy/docker-compose.yml up -d
```

DB schema changes are applied automatically on container boot
(`drizzle-kit push`); no manual migration step.

---

## 7. Default admin logins (created by seed)

| Email | Password | Role |
|-------|----------|------|
| `layla@lotuspharmacies.com` | `admin123` | admin |
| `omar@lotuspharmacies.com`  | `admin123` | admin |

Plus four demo agents (`sara@`, `youssef@`, `hana@`, `kareem@` —
all `agent123`). **Change these immediately in production**, or set
`RUN_SEED=false` and create users from scratch via Settings → Users.

---

## 8. Backups

Only Postgres holds state. Backup the named volume `lotus_db_data`:

```bash
# Daily dump (cron)
docker exec lotus_postgres pg_dump -U lotus lotus | gzip > /backup/lotus-$(date +%F).sql.gz

# Restore
gunzip -c /backup/lotus-2026-05-05.sql.gz | docker exec -i lotus_postgres psql -U lotus -d lotus
```

Uploaded files (e.g. branding logo) are stored as base64 inside the
DB, so the SQL dump captures them too.

---

## 9. Complete REST API surface (for reference)

All endpoints are served at `/api/...` and require a Bearer JWT
from `POST /api/auth/login` **except** `/api/auth/login` and
`/api/healthz`.

```
POST   /api/auth/login
GET    /api/auth/me

GET    /api/me/availability
PATCH  /api/me/availability

GET    /api/users           POST /api/users
PUT    /api/users/:id       DELETE /api/users/:id

GET    /api/customers       POST /api/customers
GET    /api/customers/:id   PUT /api/customers/:id   DELETE /api/customers/:id
POST   /api/customers/:id/block
POST   /api/customers/:id/unblock
GET    /api/customers/:id/conversations

GET    /api/conversations   POST /api/conversations
GET    /api/conversations/:id
PATCH  /api/conversations/:id            (status, assignee, tags, reason…)
GET    /api/conversations/:id/messages
POST   /api/conversations/:id/messages

GET    /api/tags            POST /api/tags   PUT /api/tags/:id   DELETE /api/tags/:id
GET    /api/quick-replies   POST /api/quick-replies   …
GET    /api/chat-reason-categories   POST/PUT/DELETE
GET    /api/chat-reasons             POST/PUT/DELETE
GET    /api/not-ready-reasons        POST/PUT/DELETE
GET    /api/role-permissions         PUT /api/role-permissions/:role

GET    /api/settings        PUT /api/settings        (branding, distribution)

GET    /api/insights
GET    /api/analytics/summary
GET    /api/analytics/chats-over-time
GET    /api/analytics/agent-performance
GET    /api/analytics/recent-activity
GET    /api/reports/overview
GET    /api/reports/chat-volume
GET    /api/reports/response-times
GET    /api/reports/customers
GET    /api/reports/branches
GET    /api/reports/tags
GET    /api/reports/heatmap
GET    /api/reports/export

GET    /api/campaigns       POST /api/campaigns
DELETE /api/campaigns/:id
POST   /api/campaigns/:id/send          ⚠ STUB — no real messaging provider

GET    /api/healthz                     (no auth, for monitoring/uptime checks)
```

A live realtime channel runs over **Socket.io** at `/api/socket.io/`
(nginx already proxies the WebSocket upgrade).

---

## 10. Webhooks (current state)

**There are no inbound webhooks defined in the code.** The CRM does
not receive WhatsApp / Messenger / Instagram messages — those panels
display data created in-app. If/when you connect a real provider
(e.g. WhatsApp Business Cloud API, Meta Messenger, Twilio), the
webhook receiver will need to be added to
`artifacts/api-server/src/routes/` and exposed publicly under
`https://crm.yourcompany.com/api/webhooks/<provider>`.

---

## 11. Source of truth

* GitHub: <https://github.com/Refaat1942/Pharma-SaaS-Hub>
* Build / runtime config: `Dockerfile`, `Dockerfile.web`,
  `deploy/docker-compose.yml`, `deploy/nginx.conf`, `deploy/.env.example`
* DB schema: `lib/db/src/schema.ts`
* OpenAPI / API contract: `lib/api-spec/`
