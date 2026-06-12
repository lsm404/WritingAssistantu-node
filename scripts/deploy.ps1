# 零停机部署脚本 (Windows PowerShell)
# 策略：先 build 新镜像 → 执行 migration → 等新容器健康后再切换
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# ────────────────────────────────────────────
# [1/4] 确保数据库正在运行
# ────────────────────────────────────────────
Write-Host "[1/4] Ensuring database is running..."
docker compose up -d db

Write-Host "      Waiting for database to be healthy..."
$waited = 0
while (-not (docker compose ps db | Select-String "healthy")) {
  if ($waited -ge 60) {
    Write-Error "ERROR: Database did not become healthy in time."
    exit 1
  }
  Start-Sleep -Seconds 2
  $waited += 2
}
Write-Host "      Database is healthy."

# ────────────────────────────────────────────
# [2/4] 构建新镜像（线上容器继续跑旧镜像）
# ────────────────────────────────────────────
Write-Host "[2/4] Building new backend image..."
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
Write-Host "[3/4] Applying Prisma migrations..."

$hasMigrationTable = docker compose exec -T db `
  psql -U postgres -d openclaw -tAc `
  "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema='public' AND table_name='_prisma_migrations');" `
  2>$null

$hasMigrationTable = ($hasMigrationTable -replace '\s','')

if ($hasMigrationTable -ne 't') {
  Write-Host "      No migration history found - baselining existing database..."
  Get-ChildItem -Path "prisma/migrations" -Directory | ForEach-Object {
    $migrationName = $_.Name
    $sqlFile = Join-Path $_.FullName "migration.sql"
    if (Test-Path $sqlFile) {
      Write-Host "      Marking '$migrationName' as applied..."
      docker compose run --rm backend npx prisma migrate resolve --applied $migrationName
    }
  }
  Write-Host "      Baseline complete."
}

docker compose run --rm backend npx prisma migrate deploy

# ────────────────────────────────────────────
# [4/4] 滚动切换：等新容器健康后再替换旧容器
# ────────────────────────────────────────────
Write-Host "[4/4] Starting new backend (waiting for health check before replacing old)..."
docker compose up -d --no-build --wait backend

Write-Host ""
Write-Host "✅ Deploy complete. New backend is healthy and serving traffic."
