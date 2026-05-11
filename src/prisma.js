import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis;
const databaseUrl = process.env.DATABASE_URL?.trim() || "";

if (!databaseUrl) {
  throw new Error("DATABASE_URL_MISSING");
}

export const prisma =
  globalForPrisma.__openClawPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__openClawPrisma = prisma;
}

const DEFAULT_PLANS = [
  {
    id: "plan-monthly-199",
    code: "monthly_199",
    name: "基础月卡",
    billingType: "monthly",
    priceCents: 1990,
    durationDays: 30,
    isLifetime: false,
    isActive: true,
    sortOrder: 1,
  },
  {
    id: "plan-monthly-399",
    code: "monthly_399",
    name: "进阶月卡",
    billingType: "monthly",
    priceCents: 3990,
    durationDays: 30,
    isLifetime: false,
    isActive: true,
    sortOrder: 2,
  },
  {
    id: "plan-monthly-599",
    code: "monthly_599",
    name: "专业月卡",
    billingType: "monthly",
    priceCents: 5990,
    durationDays: 30,
    isLifetime: false,
    isActive: true,
    sortOrder: 3,
  },
  {
    id: "plan-monthly-990",
    code: "monthly_990",
    name: "尊享月卡",
    billingType: "monthly",
    priceCents: 9900,
    durationDays: 30,
    isLifetime: false,
    isActive: true,
    sortOrder: 4,
  },
];

const LEGACY_PLAN_CODES = ["trial", "monthly_99", "lifetime_499"];

export async function ensureDatabaseSetup() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS user_quotas (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      text_used INT NOT NULL DEFAULT 0,
      text_date TEXT NOT NULL DEFAULT '',
      image_used INT NOT NULL DEFAULT 0,
      image_month TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_ip TEXT`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_subnet TEXT`,
  );

  // 代理人 / 邀请渠道（与 prisma/schema.prisma 一致）。线上若未跑 db push，此处仍可避免 agents 表缺失导致启动失败。
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      name TEXT NOT NULL,
      invite_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS agents_invite_code_key ON agents(invite_code)
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_id TEXT
  `);
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_agent_id_fkey'
      ) THEN
        ALTER TABLE users
          ADD CONSTRAINT users_agent_id_fkey
          FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL;
      END IF;
    END $$
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS users_agent_id_idx ON users(agent_id)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS wechat_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_key TEXT NOT NULL,
      name TEXT NOT NULL,
      app_id TEXT NOT NULL DEFAULT '',
      app_secret TEXT NOT NULL DEFAULT '',
      thumb_media_id TEXT NOT NULL DEFAULT '',
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, client_key)
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS wechat_accounts_user_id_idx ON wechat_accounts(user_id)
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS active_wechat_client_key TEXT
  `);



  await Promise.all(
    DEFAULT_PLANS.map((plan) =>
      prisma.plan.upsert({
        where: { code: plan.code },
        update: {
          name: plan.name,
          billingType: plan.billingType,
          priceCents: plan.priceCents,
          durationDays: plan.durationDays,
          isLifetime: plan.isLifetime,
          isActive: plan.isActive,
          sortOrder: plan.sortOrder,
        },
        create: plan,
      }),
    ),
  );

  await prisma.plan.updateMany({
    where: { code: { in: LEGACY_PLAN_CODES } },
    data: { isActive: false },
  });
}

export function getDatabaseUrl() {
  return databaseUrl;
}
