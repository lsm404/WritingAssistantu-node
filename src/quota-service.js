import { prisma } from "./prisma.js";
import { getQuotaFreeRollingSettings } from "./system-settings-service.js";

const FREE_EXPERIENCE_LIMITS = {
  textDaily: 2,
  imageMonthly: 3,
};

// PLAN_LIMITS are now fetched from database via membership.plan

function resolvePaidTextMonthlyLimit(plan) {
  if (!plan) return 0;
  if (plan.textMonthlyLimit !== null && plan.textMonthlyLimit !== undefined) {
    return Math.max(Number(plan.textMonthlyLimit || 0), 0);
  }
  return Math.max(Number(plan.textDailyLimit || 0), 0) * 30;
}

function getTodayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function getMonthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function resolveQuotaLimits(membership) {
  if (membership?.isActive && membership.plan) {
    return {
      source: membership.plan.code,
      textMonthly: resolvePaidTextMonthlyLimit(membership.plan),
      imageMonthly: membership.plan.imageMonthlyLimit ?? 0,
    };
  }

  return {
    source: "free_experience",
    ...FREE_EXPERIENCE_LIMITS,
  };
}

/** UTC 午夜起算，返回 anchor(YYYY-MM-DD) 到 now 经过的完整天数 */
function daysSinceUtcDate(anchorStr, now = new Date()) {
  if (!anchorStr || !/^\d{4}-\d{2}-\d{2}$/.test(anchorStr)) {
    return Number.POSITIVE_INFINITY;
  }
  const y = Number.parseInt(anchorStr.slice(0, 4), 10);
  const m = Number.parseInt(anchorStr.slice(5, 7), 10) - 1;
  const d = Number.parseInt(anchorStr.slice(8, 10), 10);
  const anchorMs = Date.UTC(y, m, d);
  const nowMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((nowMs - anchorMs) / 86_400_000);
}

/** 免费用户的图片周期锚点：支持 YYYY-MM-DD；兼容旧数据 YYYY-MM */
function parseFreeImageAnchor(raw) {
  const s = String(raw ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return s;
  }
  if (/^\d{4}-\d{2}$/.test(s)) {
    return `${s}-01`;
  }
  return null;
}

/**
 * @param {object} row
 * @param {Date} now
 * @param {object | null} freePolicy { textPeriodDays, imagePeriodDays } 非免费传 null
 */
function normalizeQuotaRowWithPolicy(row, now, freePolicy) {
  const todayKey = getTodayKey(now);
  const monthKey = getMonthKey(now);

  if (!freePolicy) {
    return {
      userId: row.userId,
      textUsed: row.textDate === monthKey ? row.textUsed : 0,
      textDate: monthKey,
      imageUsed: row.imageMonth === monthKey ? row.imageUsed : 0,
      imageMonth: monthKey,
    };
  }

  let textUsed;
  let textDate;
  const textAnchor = /^\d{4}-\d{2}-\d{2}$/.test(String(row.textDate ?? "")) ? row.textDate : "";
  if (!textAnchor || daysSinceUtcDate(textAnchor, now) >= freePolicy.textPeriodDays) {
    textUsed = 0;
    textDate = todayKey;
  } else {
    textUsed = row.textUsed;
    textDate = textAnchor;
  }

  let imageUsed;
  let imageMonth;
  const imgAnchor = parseFreeImageAnchor(row.imageMonth);
  if (!imgAnchor || daysSinceUtcDate(imgAnchor, now) >= freePolicy.imagePeriodDays) {
    imageUsed = 0;
    imageMonth = todayKey;
  } else {
    imageUsed = row.imageUsed;
    imageMonth = imgAnchor;
  }

  return {
    userId: row.userId,
    textUsed,
    textDate,
    imageUsed,
    imageMonth,
  };
}

function addDaysYmdString(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d) + n * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function ymdToUtcStartIso(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0)).toISOString();
}

/** 付费：下个月 1 日 UTC 0 点起重新计文章和配图额度 */
function firstDayNextMonthUtcStartIso(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (m === 11) {
    return new Date(Date.UTC(y + 1, 0, 1, 0, 0, 0, 0)).toISOString();
  }
  return new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0)).toISOString();
}

/**
 * @param {object} normalized
 * @param {object} limits
 * @param {object | null} freePolicy
 * @param {Date} now
 */
function buildQuotaSummaryPayload(normalized, limits, freePolicy, now = new Date()) {
  const textReset =
    freePolicy != null
      ? { resetMode: "rolling_days", resetEveryDays: freePolicy.textPeriodDays }
      : { resetMode: "calendar_month", resetEveryDays: null };
  const imageReset =
    freePolicy != null
      ? { resetMode: "rolling_days", resetEveryDays: freePolicy.imagePeriodDays }
      : { resetMode: "calendar_month", resetEveryDays: null };

  let textQuotaRefreshAt = null;
  let imageQuotaRefreshAt = null;

  if (freePolicy) {
    const ta = String(normalized.textDate ?? "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(ta)) {
      const nextTextYmd = addDaysYmdString(ta, freePolicy.textPeriodDays);
      textQuotaRefreshAt = ymdToUtcStartIso(nextTextYmd);
    }
    const imgA = parseFreeImageAnchor(normalized.imageMonth);
    const imgAnchor = imgA && /^\d{4}-\d{2}-\d{2}$/.test(imgA) ? imgA : null;
    if (imgAnchor) {
      const nextImgYmd = addDaysYmdString(imgAnchor, freePolicy.imagePeriodDays);
      imageQuotaRefreshAt = ymdToUtcStartIso(nextImgYmd);
    }
  } else {
    textQuotaRefreshAt = firstDayNextMonthUtcStartIso(now);
    imageQuotaRefreshAt = firstDayNextMonthUtcStartIso(now);
  }

  return {
    source: limits.source,
    usesFreeRollingWindows: Boolean(freePolicy),
    text: {
      limit: freePolicy ? limits.textDaily : limits.textMonthly,
      used: normalized.textUsed,
      remaining: Math.max((freePolicy ? limits.textDaily : limits.textMonthly) - normalized.textUsed, 0),
      periodKey: normalized.textDate,
      quotaRefreshAt: textQuotaRefreshAt,
      ...textReset,
    },
    image: {
      limit: limits.imageMonthly,
      used: normalized.imageUsed,
      remaining: Math.max(limits.imageMonthly - normalized.imageUsed, 0),
      periodKey: normalized.imageMonth,
      quotaRefreshAt: imageQuotaRefreshAt,
      ...imageReset,
    },
  };
}

export async function ensureQuotaSetup() {
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
}

export async function ensureUserQuota(userId) {
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO user_quotas (user_id, text_used, text_date, image_used, image_month, created_at, updated_at)
      VALUES ($1, 0, '', 0, '', NOW(), NOW())
      ON CONFLICT (user_id) DO NOTHING
    `,
    userId,
  );
}

export async function resetPaidUserQuota(userId, tx = prisma) {
  const monthKey = getMonthKey(new Date());

  await tx.$executeRawUnsafe(
    `
      INSERT INTO user_quotas (user_id, text_used, text_date, image_used, image_month, created_at, updated_at)
      VALUES ($1, 0, $2, 0, $2, NOW(), NOW())
      ON CONFLICT (user_id) DO NOTHING
    `,
    userId,
    monthKey,
  );

  await tx.$executeRawUnsafe(
    `
      UPDATE user_quotas
      SET
        text_used = 0,
        text_date = $2,
        image_used = 0,
        image_month = $2,
        updated_at = NOW()
      WHERE user_id = $1
    `,
    userId,
    monthKey,
  );
}

async function getRawUserQuota(tx, userId) {
  await tx.$executeRawUnsafe(
    `
      INSERT INTO user_quotas (user_id, text_used, text_date, image_used, image_month, created_at, updated_at)
      VALUES ($1, 0, '', 0, '', NOW(), NOW())
      ON CONFLICT (user_id) DO NOTHING
    `,
    userId,
  );

  const rows = await tx.$queryRawUnsafe(
    `
      SELECT
        user_id AS "userId",
        text_used AS "textUsed",
        text_date AS "textDate",
        image_used AS "imageUsed",
        image_month AS "imageMonth"
      FROM user_quotas
      WHERE user_id = $1
      LIMIT 1
    `,
    userId,
  );

  return rows[0];
}

export async function getUserQuotaSummary(userId, membership) {
  await ensureUserQuota(userId);
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT
        user_id AS "userId",
        text_used AS "textUsed",
        text_date AS "textDate",
        image_used AS "imageUsed",
        image_month AS "imageMonth"
      FROM user_quotas
      WHERE user_id = $1
      LIMIT 1
    `,
    userId,
  );

  let limits = resolveQuotaLimits(membership);
  const freePolicy =
    limits.source === "free_experience" ? await getQuotaFreeRollingSettings() : null;

  if (freePolicy) {
    limits.textDaily = freePolicy.textLimit;
    limits.imageMonthly = freePolicy.imageLimit;
  }

  const normalized = normalizeQuotaRowWithPolicy(
    rows[0] ?? { userId, textUsed: 0, textDate: "", imageUsed: 0, imageMonth: "" },
    new Date(),
    freePolicy,
  );

  return buildQuotaSummaryPayload(normalized, limits, freePolicy, new Date());
}

export async function assertUserQuotaAvailable(userId, membership, kind, amount = 1) {
  const summary = await getUserQuotaSummary(userId, membership);

  if (kind === "text" && summary.text.remaining < amount) {
    throw new Error("TEXT_QUOTA_EXCEEDED");
  }

  if (kind === "image" && summary.image.remaining < amount) {
    throw new Error("IMAGE_QUOTA_EXCEEDED");
  }

  return summary;
}

export async function consumeUserQuota(userId, membership, kind, amount = 1) {
  if (!["text", "image"].includes(kind)) {
    throw new Error("INVALID_QUOTA_KIND");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("INVALID_QUOTA_AMOUNT");
  }

  let limits = resolveQuotaLimits(membership);
  const freePolicy =
    limits.source === "free_experience" ? await getQuotaFreeRollingSettings() : null;

  if (freePolicy) {
    limits.textDaily = freePolicy.textLimit;
    limits.imageMonthly = freePolicy.imageLimit;
  }

  return prisma.$transaction(async (tx) => {
    const rawRow = await getRawUserQuota(tx, userId);
    const normalized = normalizeQuotaRowWithPolicy(rawRow, new Date(), freePolicy);

    if (kind === "text") {
      const textLimit = freePolicy ? limits.textDaily : limits.textMonthly;
      const remaining = Math.max(textLimit - normalized.textUsed, 0);
      if (remaining < amount) {
        throw new Error("TEXT_QUOTA_EXCEEDED");
      }

      await tx.$executeRawUnsafe(
        `
          UPDATE user_quotas
          SET
            text_used = $2,
            text_date = $3,
            updated_at = NOW()
          WHERE user_id = $1
        `,
        userId,
        normalized.textUsed + amount,
        normalized.textDate,
      );
    } else {
      const remaining = Math.max(limits.imageMonthly - normalized.imageUsed, 0);
      if (remaining < amount) {
        throw new Error("IMAGE_QUOTA_EXCEEDED");
      }

      await tx.$executeRawUnsafe(
        `
          UPDATE user_quotas
          SET
            image_used = $2,
            image_month = $3,
            updated_at = NOW()
          WHERE user_id = $1
        `,
        userId,
        normalized.imageUsed + amount,
        normalized.imageMonth,
      );
    }

    const updatedRows = await tx.$queryRawUnsafe(
      `
        SELECT
          user_id AS "userId",
          text_used AS "textUsed",
          text_date AS "textDate",
          image_used AS "imageUsed",
          image_month AS "imageMonth"
        FROM user_quotas
        WHERE user_id = $1
        LIMIT 1
      `,
      userId,
    );

    const updated = normalizeQuotaRowWithPolicy(updatedRows[0], new Date(), freePolicy);
    return buildQuotaSummaryPayload(updated, limits, freePolicy, new Date());
  });
}
