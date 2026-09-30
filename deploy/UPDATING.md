# Updating the production server

The installer is safe to re-run: it fast-forwards the git checkout, keeps your
`deploy/.env`, never deletes volumes, and only rebuilds/restarts containers.

```bash
# 1) back up the database first (30 seconds, strongly recommended)
cd /opt/fratelanza-chat/deploy
set -a; . ./.env; set +a
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > ~/fratelanza-backup-$(date +%F-%H%M).sql.gz

# 2) update (BRANCH=main once merged)
BRANCH=main bash /opt/fratelanza-chat/deploy/vps-install.sh
```

Database changes are applied automatically at container start (`drizzle-kit push`)
and are additive only (new nullable/defaulted columns + one new table).

Rollback: `git -C /opt/fratelanza-chat checkout <previous-commit> && cd deploy && docker compose up -d --build`
(the new columns are ignored by older code), or restore the backup above.
