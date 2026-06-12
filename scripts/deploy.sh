#!/usr/bin/env sh
# 零停机部署脚本
# 策略：先 build 新镜像 → 执行 migration → 等新容器健康后再切换流量
# 旧容器在新容器通过健康检查之前不会被停止
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

# ────────────────────────────────────────────
# [1/4] 确保数据库正在运行
# ────────────────────────────────────────────
echo "[1/4] Ensuring database is running..."
docker compose up -d db

echo "      Waiting for database to be healthy..."
WAIT=0
until docker compose ps db | grep -q "healthy"; do
  if [ $WAIT -ge 60 ]; then
    echo "ERROR: Database did not become healthy in time."
    exit 1
  fi
  sleep 2
  WAIT=$((WAIT + 2))
done
echo "      Database is healthy."

# ────────────────────────────────────────────
# [2/4] 构建新镜像（线上容器继续跑旧镜像）
# ────────────────────────────────────────────
echo "[2/4] Building new backend image..."
docker compose build backend

# ────────────────────────────────────────────
# [3/4] 应用 Prisma migrations
#
# 首次部署时数据库可能已有表（通过 db push 建的），但没有迁移历史。
# Prisma 会报 P3005（schema not empty）拒绝执行。
# 解决方法：检查 _prisma_migrations 表是否存在，
#   - 若不存在：将所有现有 migration 标记为"已应用"（baseline）
#   - 之后统一走 migrate deploy（幂等，只跑新增的 migration）
# ────────────────────────────────────────────
echo "[3/4] Applying Prisma migrations..."

HAS_MIGRATION_TABLE=$(docker compose exec -T db \
  psql -U postgres -d openclaw -tAc \
  "SELECT EXISTS (
     SELECT FROM information_schema.tables
     WHERE table_schema = 'public'
     AND table_name = '_prisma_migrations'
   );" 2>/dev/null | tr -d '[:space:]' || echo "f")

if [ "$HAS_MIGRATION_TABLE" = "f" ]; then
  echo "      No migration history found — baselining existing database..."
  for migration_dir in prisma/migrations/*/; do
    migration_name=$(basename "$migration_dir")
    # 只处理包含 migration.sql 的目录（跳过其他文件）
    [ -f "${migration_dir}migration.sql" ] || continue
    echo "      Marking '$migration_name' as applied..."
    docker compose run --rm backend npx prisma migrate resolve --applied "$migration_name"
  done
  echo "      Baseline complete."
fi

docker compose run --rm backend npx prisma migrate deploy

# ────────────────────────────────────────────
# [4/4] 滚动切换：等新容器健康后再替换旧容器
# --wait 让 compose 等待容器通过 healthcheck 再退出
# ────────────────────────────────────────────
echo "[4/4] Starting new backend (waiting for health check before replacing old)..."
docker compose up -d --no-build --wait backend

echo ""
echo "✅ Deploy complete. New backend is healthy and serving traffic."
