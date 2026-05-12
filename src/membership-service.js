import { prisma } from "./prisma.js";

function addDays(baseIso, days) {
  const date = new Date(baseIso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function formatPrice(priceCents) {
  return (priceCents / 100).toFixed(2);
}

function resolvePaidTextMonthlyLimit(textDailyLimit) {
  return Math.max(Number(textDailyLimit || 0), 0) * 30;
}

function normalizePlanFeatures(features, textMonthlyLimit) {
  const normalized = features.map((feature) =>
    String(feature).replace(/每天\s*\d+\s*次文字创作/g, `每月 ${textMonthlyLimit} 次文章生成额度`),
  );
  if (!normalized.some((feature) => feature.includes("去水印"))) {
    normalized.push("会员生图支持去水印");
  }
  return normalized;
}

function sanitizePlan(plan) {
  if (!plan) return null;
  const textMonthlyLimit = resolvePaidTextMonthlyLimit(plan.textDailyLimit);
  const features = plan.featuresJson ? JSON.parse(plan.featuresJson) : [];
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    billingType: plan.billingType,
    priceCents: plan.priceCents,
    priceLabel: formatPrice(plan.priceCents),
    durationDays: plan.durationDays,
    isLifetime: plan.isLifetime,
    isActive: plan.isActive,
    sortOrder: plan.sortOrder,
    textDailyLimit: plan.textDailyLimit,
    textMonthlyLimit,
    imageMonthlyLimit: plan.imageMonthlyLimit,
    wechatAccountLimit: plan.wechatAccountLimit,
    tagline: plan.tagline,
    features: normalizePlanFeatures(features, textMonthlyLimit),
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

function resolveQuotaLimits(membership) {
  if (membership?.isActive && membership.plan) {
    return {
      source: membership.plan.code,
      textDaily: membership.plan.textDailyLimit ?? 0,
      imageMonthly: membership.plan.imageMonthlyLimit ?? 0,
    };
  }
  return { source: "free", textDaily: 0, imageMonthly: 0 };
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
  const endAt = plan.isLifetime
    ? null
    : new Date(stamp.getTime() + (plan.durationDays ?? 30) * 24 * 60 * 60 * 1000);

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
      return;
    }

    const durationDays = Number(plan.durationDays || 30);
    if (activeMembership && !activeMembership.plan.isLifetime) {
      const baseTime =
        activeMembership.endAt && activeMembership.endAt.getTime() > Date.now()
          ? activeMembership.endAt.toISOString()
          : stamp;
      const nextEndAt = addDays(baseTime, durationDays);

      await tx.membership.update({
        where: { id: activeMembership.id },
        data: {
          endAt: new Date(nextEndAt),
          updatedAt: new Date(stamp),
        },
      });
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
  const inviteNorm = String(filters.inviteCode ?? "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 8);
  const agentId = String(filters.agentId ?? "").trim();

  const where = {};
  if (inviteNorm.length === 8) {
    where.signupInviteCode = inviteNorm;
  } else if (agentId) {
    where.agentId = agentId;
  }

  const users = await prisma.user.findMany({
    where: Object.keys(where).length ? where : undefined,
    orderBy: { createdAt: "desc" },
  });

  return Promise.all(
    users.map(async (user) => ({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
      agentId: user.agentId,
      signupInviteCode: user.signupInviteCode,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      membership: await getMembershipSummary(user.id),
    })),
  );
}
