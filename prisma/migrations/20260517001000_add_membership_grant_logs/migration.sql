CREATE TABLE IF NOT EXISTS "membership_grant_logs" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "actor_type" TEXT NOT NULL,
  "actor_id" TEXT,
  "actor_account" TEXT NOT NULL DEFAULT '',
  "actor_name" TEXT NOT NULL DEFAULT '',
  "target_user_id" TEXT NOT NULL,
  "target_user_email" TEXT NOT NULL DEFAULT '',
  "target_user_name" TEXT NOT NULL DEFAULT '',
  "plan_id" TEXT,
  "plan_code" TEXT NOT NULL DEFAULT '',
  "plan_name" TEXT NOT NULL DEFAULT '',
  "membership_id" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "membership_grant_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "membership_grant_logs_created_at_idx"
  ON "membership_grant_logs"("created_at");

CREATE INDEX IF NOT EXISTS "membership_grant_logs_actor_id_idx"
  ON "membership_grant_logs"("actor_id");

CREATE INDEX IF NOT EXISTS "membership_grant_logs_target_user_id_idx"
  ON "membership_grant_logs"("target_user_id");
