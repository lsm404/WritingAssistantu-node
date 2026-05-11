# node-backend

独立的 Node.js 后端服务，按旧 `D:\auto\backend` 的许可证接口行为重写，并补了账号与会员能力。

## 启动

```powershell
cd D:\auto\node-backend
npm.cmd run start
```

默认端口是 `3100`，可通过环境变量覆盖：

```powershell
$env:PORT="3200"
npm.cmd run start
```

首次使用 PostgreSQL 时，先配置数据库连接并同步表结构：

```powershell
$env:DATABASE_URL="postgresql://postgres:password@127.0.0.1:5432/openclaw?schema=public"
npm.cmd run prisma:generate
npm.cmd run prisma:push
```

## 接口

- `GET /api/health`
- `GET /api/v1/ping`
- `POST /api/v1/ping`
- `GET /api/v1/plans`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `GET /api/v1/memberships/me`
- `POST /api/v1/memberships/checkout`
- `GET /api/v1/admin/users`
- `GET /api/v1/licenses`
- `POST /api/v1/licenses`
- `GET /api/v1/licenses/export?format=env|txt|json&scope=active|available|activated|all`

## 环境变量

- `PORT`
- `DATABASE_URL`
- `OPENCLAW_DIR`
- `OPENCLAW_DB_PATH`
- `OPENCLAW_SYNC_FILES`

## 会员套餐

- `monthly_99`：月付会员，`9.90`
- `lifetime_499`：终生会员，`49.90`

## 说明

- 当前账号、会员、订单主数据使用 PostgreSQL。
- Prisma schema 位于 `prisma/schema.prisma`。
- 第一位注册用户会自动成为 `admin`，可访问 `/api/v1/admin/users`。

默认会读取 `D:\auto\openClaw\data\license.db`，并同步：

- `D:\auto\openClaw\.env`
- `D:\auto\openClaw\local_activation_codes.env`
