import { randomUUID } from "node:crypto";
import { prisma } from "./prisma.js";
import { resetPaidUserQuota } from "./quota-service.js";

function addDays(baseIso, days) {
  const date = new Date(baseIso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function formatPrice(priceCents) {
  return (priceCents / 100).toFixed(2);
}

function resolvePaidTextMonthlyLimit(plan) {
  if (!plan) return 0;
  if (plan.textMonthlyLimit !== null && plan.textMonthlyLimit !== undefined) {
    return Math.max(Number(plan.textMonthlyLimit || 0), 0);
  }
  return Math.max(Number(plan.textDailyLimit || 0), 0) * 30;
}

function parsePlanFeatures(plan) {
  if (!plan?.featuresJson) return [];
  try {
    return JSON.parse(plan.featuresJson);
  } catch {
    return [];
  }
}

function normalizePlanCategory(value, imageMonthlyLimit = 0) {
  const raw = String(value || "").trim();
  if (raw === "text_only" || raw === "text_image") {
    return raw;
  }
  return Number(imageMonthlyLimit || 0) > 0 ? "text_image" : "text_only";
}

export function resolvePlanDurationDaysByName(name, fallbackDays = 30) {
  const raw = String(name || "").trim();
  if (!raw) {
    return fallbackDays;
  }

  if (raw.includes("至尊年卡") || (raw.includes("至尊") && raw.includes("年")) || raw.includes("年卡")) {
    return 365;
  }
  if (raw.includes("进阶季卡") || raw.includes("进阶月卡") || raw.includes("季卡") || raw.includes("季度")) {
    return 90;
  }
  if (raw.includes("基础月卡") || raw.includes("月卡")) {
    return 30;
  }
  return fallbackDays;
}

function sanitizePlan(plan, options = {}) {
  if (!plan) return null;
  const textMonthlyLimit = resolvePaidTextMonthlyLimit(plan);
  const features = parsePlanFeatures(plan);
  const planCategory = normalizePlanCategory(plan.planCategory, plan.imageMonthlyLimit);
  const durationDays = resolvePlanDurationDaysByName(plan.name, plan.durationDays ?? 30);
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    billingType: plan.billingType,
    priceCents: plan.priceCents,
    priceLabel: formatPrice(plan.priceCents),
    durationDays,
    isLifetime: plan.isLifetime,
    isActive: plan.isActive,
    sortOrder: plan.sortOrder,
    planCategory,
    supportsImage: planCategory === "text_image",
    textDailyLimit: plan.textDailyLimit,
    textMonthlyLimit,
    imageMonthlyLimit: plan.imageMonthlyLimit,
    deAiMonthlyLimit: plan.deAiMonthlyLimit ?? 0,
    wechatAccountLimit: plan.wechatAccountLimit,
    tagline: plan.tagline,
    features,
  };
}

function sanitizeMembership(row) {
  if (!row) {
    return null;
  }

  const now = Date.now();
  const endAtMs = row.endAt ? row.endAt.getTime() : null;
  const isActive = row.status === "active" && (row.plan.isLifetime || endAtMs === null || endAtMs > now);

  return {
    id: row.id,
    status: row.status,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt ? row.endAt.toISOString() : null,
    isActive,
    plan: sanitizePlan(row.plan),
  };
}

function parsePositiveInt(value, fallback, max = 1000) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.min(n, max);
}

function buildUserFilters(filters = {}) {
  const inviteNorm = String(filters.inviteCode ?? "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 8);
  const agentId = String(filters.agentId ?? "").trim();
  const search = String(filters.search ?? "").trim();

  const where = {};
  if (inviteNorm.length === 8) {
    where.signupInviteCode = inviteNorm;
  } else if (agentId) {
    where.agentId = agentId;
  }

  if (search) {
    where.OR = [
      { email: { contains: search, mode: "insensitive" } },
      { displayName: { contains: search, mode: "insensitive" } },
    ];
  }

  return where;
}

function normalizeUserListSort(value) {
  const raw = String(value || "").trim();
  if (raw === "usage_desc" || raw === "last_used_desc" || raw === "created_desc") {
    return raw;
  }
  return "usage_desc";
}

function normalizeUserListSqlFilters(filters = {}) {
  const inviteNorm = String(filters.inviteCode ?? "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 8);
  const agentId = String(filters.agentId ?? "").trim();
  const search = String(filters.search ?? "").trim();
  const clauses = [];
  const params = [];

  const addParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (inviteNorm.length === 8) {
    clauses.push(`u.signup_invite_code = ${addParam(inviteNorm)}`);
  } else if (agentId) {
    clauses.push(`u.agent_id = ${addParam(agentId)}`);
  }

  if (search) {
    const searchParam = addParam(`%${search}%`);
    clauses.push(`(u.email ILIKE ${searchParam} OR u.display_name ILIKE ${searchParam})`);
  }

  if (filters.membershipOnly) {
    clauses.push(`
      EXISTS (
        SELECT 1
        FROM memberships m
        JOIN plans p ON p.id = m.plan_id
        WHERE m.user_id = u.id
          AND m.status = 'active'
          AND (p.is_lifetime = TRUE OR m.end_at IS NULL OR m.end_at > NOW())
      )
    `);
  }

  return {
    params,
    whereSql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
  };
}

function getUserListOrderSql(sort) {
  if (sort === "last_used_desc") {
    return `stats.last_used_at DESC NULLS LAST, u.created_at DESC, u.id ASC`;
  }
  if (sort === "created_desc") {
    return `u.created_at DESC, u.id ASC`;
  }
  return `COALESCE(stats.generation_count, 0) DESC, u.created_at DESC, u.id ASC`;
}

function toIsoOrNull(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function getArticleGenerationStats(userIds) {
  if (!userIds.length) {
    return new Map();
  }

  const placeholders = userIds.map((_, index) => `$${index + 1}`).join(", ");
  const grouped = await prisma.$queryRawUnsafe(
    `
      SELECT user_id AS "userId", COUNT(*)::int AS "count"
        , MAX(created_at) AS "lastUsedAt"
      FROM article_generation_logs
      WHERE user_id IN (${placeholders})
        AND kind <> 'image'
      GROUP BY user_id
    `,
    ...userIds,
  );

  return new Map(
    grouped.map((row) => [
      row.userId,
      {
        count: Number(row.count || 0),
        lastUsedAt: toIsoOrNull(row.lastUsedAt),
      },
    ]),
  );
}

async function buildUserSummary(user, generationStatsMap, options = {}) {
  const includeSuperAdminFields = Boolean(options.includeSuperAdminFields);
  const summary = {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    agentId: user.agentId,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    membership: await getMembershipSummary(user.id),
  };
  if (includeSuperAdminFields) {
    const generationStats = generationStatsMap.get(user.id);
    summary.signupInviteOwnerName = user.invitedBy?.name ?? null;
    summary.articleGenerationCount = generationStats?.count ?? 0;
    summary.lastArticleGenerationAt = generationStats?.lastUsedAt ?? null;
  }
  return summary;
}

function resolveQuotaLimits(membership) {
  if (membership?.isActive && membership.plan) {
    return {
      source: membership.plan.code,
      textMonthly: resolvePaidTextMonthlyLimit(membership.plan),
      imageMonthly: membership.plan.imageMonthlyLimit ?? 0,
      deAiMonthly: membership.plan.deAiMonthlyLimit ?? 0,
    };
  }
  return { source: "free", textMonthly: 0, imageMonthly: 0 };
}

async function getLatestMembershipRow(userId) {
  return prisma.membership.findFirst({
    where: { userId },
    include: { plan: true },
    orderBy: [{ status: "asc" }, { endAt: "desc" }, { createdAt: "desc" }],
  });
}

async function getActiveMembershipRow(userId) {
  return prisma.membership.findFirst({
    where: {
      userId,
      status: "active",
      OR: [{ plan: { isLifetime: true } }, { endAt: null }, { endAt: { gt: new Date() } }],
    },
    include: { plan: true },
    orderBy: [{ endAt: "desc" }, { createdAt: "desc" }],
  });
}

export async function listAllOrders(filters = {}) {
  const where = {};
  if (filters.agentId) {
    where.user = { agentId: filters.agentId };
  }

  const rows = await prisma.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { id: true, email: true, displayName: true } },
      plan: { select: { id: true, code: true, name: true, isLifetime: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    orderNo: row.orderNo,
    status: row.status,
    amountCents: row.amountCents,
    amountLabel: formatPrice(row.amountCents),
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    user: row.user,
    plan: row.plan,
  }));
}

export async function adminGrantMembership(userId, planCode) {
  const plan = await prisma.plan.findUnique({ where: { code: String(planCode || "").trim() } });
  if (!plan || !plan.isActive) {
    throw new Error("PLAN_NOT_FOUND");
  }

  const stamp = new Date();
  const durationDays = resolvePlanDurationDaysByName(plan.name, plan.durationDays ?? 30);
  const endAt = plan.isLifetime
    ? null
    : new Date(stamp.getTime() + durationDays * 24 * 60 * 60 * 1000);

  await prisma.membership.updateMany({
    where: { userId, status: "active" },
    data: { status: "replaced", updatedAt: stamp },
  });

  const membership = await prisma.membership.create({
    data: {
      userId,
      planId: plan.id,
      status: "active",
      startAt: stamp,
      endAt,
      source: "manual",
    },
    include: { plan: true },
  });

  await resetPaidUserQuota(userId);

  return sanitizeMembership(membership);
}

export async function adminRevokeMembership(userId) {
  const result = await prisma.membership.updateMany({
    where: { userId, status: "active" },
    data: { status: "cancelled", updatedAt: new Date() },
  });
  return { revoked: result.count };
}

export async function listPlans(includeInactive = false) {
  const rows = await prisma.plan.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { priceCents: "asc" }],
  });
  return rows.map((row) => sanitizePlan(row));
}

function parseNonNegativeInt(value, fallback = 0) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? Math.max(n, 0) : fallback;
}

function sanitizePlanCode(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export async function createPlan(payload = {}) {
  const code = sanitizePlanCode(payload.code || payload.name);
  if (!code) {
    throw new Error("PLAN_CODE_REQUIRED");
  }

  const exists = await prisma.plan.findUnique({ where: { code } });
  if (exists) {
    throw new Error("PLAN_CODE_EXISTS");
  }

  const maxSort = await prisma.plan.aggregate({ _max: { sortOrder: true } });
  const textMonthlyLimit = parseNonNegativeInt(payload.textMonthlyLimit, 0);
  const imageMonthlyLimit = parseNonNegativeInt(payload.imageMonthlyLimit, 0);
  const planName = String(payload.name || code).trim();
  const planCategory = normalizePlanCategory(payload.planCategory, imageMonthlyLimit);
  const durationDays = resolvePlanDurationDaysByName(planName, parseNonNegativeInt(payload.durationDays, 30) || 30);
  const plan = await prisma.plan.create({
    data: {
      id: `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      code,
      name: planName,
      billingType: String(payload.billingType || "monthly").trim() || "monthly",
      priceCents: parseNonNegativeInt(payload.priceCents, 0),
      durationDays,
      isLifetime: false,
      isActive: payload.isActive !== false,
      sortOrder: parseNonNegativeInt(payload.sortOrder, (maxSort._max.sortOrder ?? 0) + 1),
      textDailyLimit: Math.max(0, Math.round(textMonthlyLimit / 30)),
      textMonthlyLimit,
      imageMonthlyLimit: planCategory === "text_only" ? 0 : imageMonthlyLimit,
      deAiMonthlyLimit: parseNonNegativeInt(payload.deAiMonthlyLimit, 0),
      wechatAccountLimit: parseNonNegativeInt(payload.wechatAccountLimit, 0),
      tagline: String(payload.tagline || "").trim(),
      featuresJson: Array.isArray(payload.features) ? JSON.stringify(payload.features) : JSON.stringify([]),
    },
  });
  await prisma.$executeRawUnsafe(
    `UPDATE plans SET plan_category = $2 WHERE id = $1`,
    plan.id,
    planCategory,
  );

  return sanitizePlan({ ...plan, planCategory });
}

export async function deletePlan(planIdOrCode) {
  const key = String(planIdOrCode || "").trim();
  if (!key) {
    throw new Error("PLAN_NOT_FOUND");
  }

  let plan = await prisma.plan.findUnique({ where: { id: key } });
  if (!plan) {
    plan = await prisma.plan.findUnique({ where: { code: key } });
  }
  if (!plan) {
    throw new Error("PLAN_NOT_FOUND");
  }

  const relatedCount = await prisma.membership.count({ where: { planId: plan.id } }) +
    await prisma.order.count({ where: { planId: plan.id } });
  if (relatedCount > 0) {
    throw new Error("PLAN_IN_USE");
  }

  await prisma.plan.delete({ where: { id: plan.id } });
  return { deleted: true };
}

export async function getMembershipSummary(userId) {
  return sanitizeMembership(await getLatestMembershipRow(userId));
}

export async function purchasePlan(userId, planCode) {
  const code = String(planCode || "").trim();
  const plan = await prisma.plan.findUnique({ where: { code } });
  if (!plan || !plan.isActive) {
    throw new Error("PLAN_NOT_FOUND");
  }

  const stamp = new Date().toISOString();
  const activeMembership = await getActiveMembershipRow(userId);
  if (activeMembership?.plan.isLifetime) {
    throw new Error("LIFETIME_ALREADY_ACTIVE");
  }

  const orderNo = `OC${Date.now()}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;

  await prisma.$transaction(async (tx) => {
    await tx.order.create({
      data: {
        userId,
        planId: plan.id,
        orderNo,
        amountCents: plan.priceCents,
        status: "paid",
        paidAt: new Date(stamp),
      },
    });

    if (plan.isLifetime) {
      await tx.membership.updateMany({
        where: { userId, status: "active" },
        data: { status: "replaced", updatedAt: new Date(stamp) },
      });

      await tx.membership.create({
        data: {
          userId,
          planId: plan.id,
          status: "active",
          startAt: new Date(stamp),
          endAt: null,
          source: "checkout",
        },
      });
      await resetPaidUserQuota(userId, tx);
      return;
    }

    const durationDays = resolvePlanDurationDaysByName(plan.name, plan.durationDays ?? 30);
    if (activeMembership && !activeMembership.plan.isLifetime) {
      await tx.membership.updateMany({
        where: { userId, status: "active" },
        data: { status: "replaced", updatedAt: new Date(stamp) },
      });

      const endAt = addDays(stamp, durationDays);
      await tx.membership.create({
        data: {
          userId,
          planId: plan.id,
          status: "active",
          startAt: new Date(stamp),
          endAt: new Date(endAt),
          source: "checkout",
        },
      });
      await resetPaidUserQuota(userId, tx);
      return;
    }

    const endAt = addDays(stamp, durationDays);
    await tx.membership.create({
      data: {
        userId,
        planId: plan.id,
        status: "active",
        startAt: new Date(stamp),
        endAt: new Date(endAt),
        source: "checkout",
      },
    });
    await resetPaidUserQuota(userId, tx);
  });

  return {
    order: {
      orderNo,
      amountLabel: formatPrice(plan.priceCents),
    },
    membership: await getMembershipSummary(userId),
  };
}

export async function listUsersWithMemberships(filters = {}) {
  const where = buildUserFilters(filters);
  const includeSuperAdminFields = Boolean(filters.includeSuperAdminFields);

  const users = await prisma.user.findMany({
    where: Object.keys(where).length ? where : undefined,
    orderBy: { createdAt: "desc" },
    include: includeSuperAdminFields ? { invitedBy: { select: { name: true } } } : undefined,
  });
  const generationStatsMap = includeSuperAdminFields
    ? await getArticleGenerationStats(users.map((user) => user.id))
    : new Map();

  return Promise.all(
    users.map((user) => buildUserSummary(user, generationStatsMap, { includeSuperAdminFields })),
  );
}

export async function listUsersWithMembershipsPage(filters = {}) {
  const page = parsePositiveInt(filters.page, 1, 100000);
  const pageSize = parsePositiveInt(filters.pageSize, 10, 100);
  const membershipOnly = Boolean(filters.membershipOnly);
  const includeSuperAdminFields = Boolean(filters.includeSuperAdminFields);
  const sort = includeSuperAdminFields ? normalizeUserListSort(filters.sort) : "created_desc";
  const { whereSql, params } = normalizeUserListSqlFilters({
    ...filters,
    membershipOnly,
  });
  const orderSql = getUserListOrderSql(sort);
  const offset = (page - 1) * pageSize;

  const countRows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS "count" FROM users u ${whereSql}`,
    ...params,
  );
  const total = Number(countRows[0]?.count || 0);

  const idParams = [...params, offset, pageSize];
  const offsetPlaceholder = `$${idParams.length - 1}`;
  const limitPlaceholder = `$${idParams.length}`;
  const idRows = await prisma.$queryRawUnsafe(
    `
      SELECT u.id
      FROM users u
      LEFT JOIN (
        SELECT user_id, COUNT(*)::int AS generation_count, MAX(created_at) AS last_used_at
        FROM article_generation_logs
        WHERE kind <> 'image'
        GROUP BY user_id
      ) stats ON stats.user_id = u.id
      ${whereSql}
      ORDER BY ${orderSql}
      OFFSET ${offsetPlaceholder}
      LIMIT ${limitPlaceholder}
    `,
    ...idParams,
  );
  const orderedIds = idRows.map((row) => row.id).filter(Boolean);

  const unorderedUsers = orderedIds.length
    ? await prisma.user.findMany({
      where: { id: { in: orderedIds } },
      include: includeSuperAdminFields ? { invitedBy: { select: { name: true } } } : undefined,
    })
    : [];
  const userById = new Map(unorderedUsers.map((user) => [user.id, user]));
  const users = orderedIds.map((id) => userById.get(id)).filter(Boolean);
  const generationStatsMap = includeSuperAdminFields
    ? await getArticleGenerationStats(users.map((user) => user.id))
    : new Map();

  return {
    users: await Promise.all(
      users.map((user) => buildUserSummary(user, generationStatsMap, { includeSuperAdminFields })),
    ),
    pagination: {
      page,
      pageSize,
      sort,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

export async function recordArticleGenerationLog(userId, payload = {}, result = {}, kind = "text") {
  await prisma.$executeRaw`
    INSERT INTO article_generation_logs (
      id,
      user_id,
      kind,
      client_source,
      topic,
      creation_mode,
      model,
      article_chars,
      created_at
    )
    VALUES (
      ${randomUUID()},
      ${userId},
      ${kind},
      ${String(payload.client_source || "unknown").trim().slice(0, 40) || "unknown"},
      ${String(payload.topic || payload.prompt || "").trim().slice(0, 240) || null},
      ${String(payload.creation_mode || "").trim().slice(0, 40) || null},
      ${String(result.meta?.model || "").trim().slice(0, 120) || null},
      ${String(result.article_md || "").length},
      NOW()
    )
  `;
}
