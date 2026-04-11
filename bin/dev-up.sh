#!/usr/bin/env bash
# Bring up the Ogun local dev stack: Postgres + Redis, migrations, seed.
#
# Usage:  ./bin/dev-up.sh
#
# The script is idempotent: run it as many times as you like. It will
# bring up the compose stack, wait for readiness, run migrations, and
# (re-)seed a demo merchant if one does not exist yet.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "[dev-up] starting docker-compose stack"
docker compose up -d

echo "[dev-up] waiting for postgres to be ready"
for i in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U ogun -d ogun_dev >/dev/null 2>&1; then
    echo "[dev-up] postgres ready"
    break
  fi
  sleep 1
done

echo "[dev-up] waiting for redis to be ready"
for i in $(seq 1 30); do
  if docker compose exec -T redis redis-cli ping >/dev/null 2>&1; then
    echo "[dev-up] redis ready"
    break
  fi
  sleep 1
done

echo "[dev-up] running migrations"
npm run migrate --silent

echo "[dev-up] seeding demo merchant"
npm run seed --silent

echo ""
echo "[dev-up] ready. next:  npm run dev"
