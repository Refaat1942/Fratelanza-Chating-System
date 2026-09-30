#!/usr/bin/env bash
# Non-destructive install/update of the Fratelanza chat system on the VPS.
#  - never deletes volumes, directories or other containers
#  - never overwrites an existing deploy/.env
#  - refuses to start if port/containers are already taken
#  - does not touch nginx (see deploy/nginx-host-chat.conf.example)
#
# Usage (as root):   BRANCH=main bash vps-install.sh
set -euo pipefail

REPO="${REPO:-https://github.com/Refaat1942/fratelanza-chating-system.git}"
BRANCH="${BRANCH:-main}"
DIR="${INSTALL_DIR:-/opt/fratelanza-chat}"
PORT="${WEB_PORT:-17156}"

[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }
command -v docker >/dev/null || { echo "Docker is not installed."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "docker compose plugin missing."; exit 1; }
command -v git >/dev/null || { echo "git is not installed."; exit 1; }

if [ ! -d "$DIR/.git" ]; then
  [ -e "$DIR" ] && { echo "$DIR exists but is not a git checkout — refusing to touch it."; exit 1; }
  git clone --branch "$BRANCH" "$REPO" "$DIR"
else
  git -C "$DIR" fetch origin "$BRANCH"
  git -C "$DIR" checkout "$BRANCH"
  git -C "$DIR" merge --ff-only "origin/$BRANCH"
fi
cd "$DIR/deploy"

FIRST_RUN=0
if [ ! -f .env ]; then
  FIRST_RUN=1
  cp .env.example .env
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 16)|" .env
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 48)|" .env
  sed -i "s|^WHATSAPP_VERIFY_TOKEN=.*|WHATSAPP_VERIFY_TOKEN=$(openssl rand -hex 16)|" .env
  ADMIN_PW="$(openssl rand -base64 15 | tr -d '/+=')"
  sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${ADMIN_PW}|" .env
  chmod 600 .env
  echo "Created deploy/.env with generated secrets."
fi
grep -q "^WEB_PORT=$PORT" .env || sed -i "s|^WEB_PORT=.*|WEB_PORT=$PORT|" .env

# Safety checks only on a fresh stack (an update legitimately owns the port).
RUNNING="$(docker compose ps -q 2>/dev/null | wc -l)"
if [ "$RUNNING" -eq 0 ]; then
  if ss -ltn "( sport = :$PORT )" | grep -q LISTEN; then
    echo "Port $PORT is already in use by something else — aborting. Nothing was started."
    exit 1
  fi
  for c in fratelanza_postgres fratelanza_api fratelanza_web; do
    if docker ps -a --format '{{.Names}}' | grep -qx "$c"; then
      echo "A container named $c already exists (another project?) — aborting."
      exit 1
    fi
  done
fi

docker compose config -q
docker compose up -d --build

echo "Waiting for health..."
for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$PORT/api/healthz" >/dev/null 2>&1; then
    echo "OK: http://127.0.0.1:$PORT/api/healthz"
    OK=1; break
  fi
  sleep 3
done
[ "${OK:-0}" = 1 ] || { echo "Health check failed. Logs:"; docker compose logs --tail=60 api web; exit 1; }

echo
docker compose ps
echo
if [ "$FIRST_RUN" = 1 ]; then
  echo "First admin login -> email: $(grep ^ADMIN_EMAIL= .env | cut -d= -f2)  password: ${ADMIN_PW}"
  echo "(also stored in $DIR/deploy/.env — change it after logging in)"
fi
echo "WhatsApp Verify token: $(grep ^WHATSAPP_VERIFY_TOKEN= .env | cut -d= -f2-)"
echo "Still to set in deploy/.env: WHATSAPP_APP_SECRET, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID"
echo "then: cd $DIR/deploy && docker compose up -d"
