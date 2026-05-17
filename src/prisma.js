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
      de_ai_used INT NOT NULL DEFAULT 0,
      de_ai_period TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE user_quotas ADD COLUMN IF NOT EXISTS de_ai_used INT NOT NULL DEFAULT 0
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE user_quotas ADD COLUMN IF NOT EXISTS de_ai_period TEXT NOT NULL DEFAULT ''
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_ip TEXT
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_subnet TEXT
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS users_signup_ip_created_at_idx
      ON users(signup_ip, created_at)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS users_signup_subnet_created_at_idx
      ON users(signup_subnet, created_at)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS registration_device_links (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS registration_device_links_device_id_idx
      ON registration_device_links(device_id)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      name TEXT NOT NULL,
      invite_code TEXT NOT NULL,
      contact_wechat TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS contact_wechat TEXT
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS can_grant_membership BOOLEAN NOT NULL DEFAULT FALSE
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

  await prisma.$executeRawUnsafe(`
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS text_monthly_limit INT
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS de_ai_monthly_limit INT NOT NULL DEFAULT 0
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS plan_category TEXT NOT NULL DEFAULT 'text_image'
  `);
  await prisma.$executeRawUnsafe(`
    UPDATE plans
    SET plan_category = CASE
      WHEN image_monthly_limit <= 0 THEN 'text_only'
      ELSE 'text_image'
    END
    WHERE plan_category IS NULL OR plan_category = ''
  `);
  await prisma.$executeRawUnsafe(`
    UPDATE plans
    SET text_monthly_limit = CASE
      WHEN text_monthly_limit IS NULL THEN GREATEST(text_daily_limit, 0) * 30
      ELSE text_monthly_limit
    END
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS article_generation_logs (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'text',
      client_source TEXT NOT NULL DEFAULT 'unknown',
      topic TEXT,
      creation_mode TEXT,
      model TEXT,
      article_chars INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS article_generation_logs_user_id_created_at_idx
      ON article_generation_logs(user_id, created_at)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS article_generation_logs_kind_idx
      ON article_generation_logs(kind)
  `);
}

export function getDatabaseUrl() {
  return databaseUrl;
}
