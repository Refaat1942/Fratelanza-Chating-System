# AGENTS.md

Guidance for cloud agents working in this repository.

## Product

**Fratelanza / Lotus Pharmacies CRM** — pnpm monorepo with:

- `artifacts/api-server` — Express 5 + Socket.io API (REST under `/api`, WebSocket at `/api/socket.io`)
- `artifacts/lotus-crm` — React 19 + Vite 7 frontend
- `lib/db` — Drizzle ORM schema (PostgreSQL 16)
- `artifacts/mockup-sandbox` — optional UI preview tool (not required for CRM E2E)

Primary reference docs: `replit.md`, `deploy/HANDOFF.md`.

## Cursor Cloud specific instructions

### Dependencies (handled by VM update script)

- **Node.js** 22+ (Replit targets 24)
- **pnpm** 9.15.0 via corepack
- **PostgreSQL 16** — not installed by the update script. Start it before running the API (`sudo pg_ctlcluster 16 main start` on Ubuntu, or use `deploy/docker-compose.yml` if Docker is available).

### Local dev services (CRM E2E)

| Service | Port | Required env |
|---------|------|--------------|
| PostgreSQL | 5432 | `DATABASE_URL=postgres://fratelanza:<password>@localhost:5432/fratelanza` |
| API server | **3000** | `DATABASE_URL`, `JWT_SECRET` (≥32 chars), `PORT=3000` |
| Lotus CRM (Vite) | 5173 | optional `PORT=5173` |

**Port alignment:** `artifacts/lotus-crm/vite.config.ts` proxies `/api` to `http://localhost:3000`. Run the API on port **3000** in local dev, not 8080 (8080 is used in Docker/Replit production layout).

**First-time DB setup** (after Postgres is running):

```bash
export DATABASE_URL="postgres://fratelanza:fratelanza_dev_password@localhost:5432/fratelanza"
pnpm --filter @workspace/db run push
```

The API auto-seeds demo data on first boot when the database is empty (`bootstrap-seed.ts`).

**Demo logins** (seed uses `@fratelanza.com`, not `@lotuspharmacies.com` in some docs):

| Role | Email | Password |
|------|-------|----------|
| Admin | `layla@fratelanza.com` | `admin123` |
| Agent | `sara@fratelanza.com` | `agent123` |

### Commands

See root `package.json` and `replit.md`. There are **no ESLint or test scripts**.

| Task | Command |
|------|---------|
| Install | `pnpm install` |
| Typecheck (CI-style) | `pnpm run typecheck` |
| Build main app | `pnpm --filter @workspace/api-server run build && pnpm --filter @workspace/lotus-crm run build` |
| Full monorepo build | `pnpm run build` — fails for `mockup-sandbox` unless `PORT` is set |
| Format check | `pnpm exec prettier --check .` |
| API dev | `pnpm --filter @workspace/api-server run dev` |
| Frontend dev | `pnpm --filter @workspace/lotus-crm run dev` |
| DB schema push | `pnpm --filter @workspace/db run push` |

### Production-like stack (optional)

```bash
cp deploy/.env.example deploy/.env   # set JWT_SECRET + POSTGRES_PASSWORD
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up --build
# App at http://localhost:8090
```

### Gotchas

- `pnpm --filter @workspace/api-server run dev` rebuilds then starts; changes require restart (no hot reload on API).
- Root `pnpm run build` includes `mockup-sandbox`, which requires `PORT` at build time — set `PORT=8081` or exclude that package when validating CRM-only changes.
- No root `README.md`; use `replit.md` and `deploy/HANDOFF.md`.
