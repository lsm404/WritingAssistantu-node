import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma.js";
import { assertRegistrationAllowed, MIN_DEVICE_ID_LEN } from "./registration-guard.js";
import { getRegistrationPolicySettings } from "./system-settings-service.js";
import { resolveActiveAgentByInviteCode } from "./agent-service.js";
import {
  getEmailLoginCandidates,
  isValidEmailAddress,
  normalizeEmailInput,
} from "./email-utils.js";

const SESSION_TTL_DAYS = 30;

function nowIso() {
  return new Date().toISOString();
}

function addDays(base, days) {
  const date = new Date(base);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  const [salt, expectedHex] = String(storedHash).split(":");
  if (!salt || !expectedHex) {
    return false;
  }

  const actual = Buffer.from(scryptSync(password, salt, 64).toString("hex"), "utf8");
  const expected = Buffer.from(expectedHex, "utf8");
  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    signupInviteCode: user.signupInviteCode ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    ownedAgent: user.ownedAgent ? { inviteCode: user.ownedAgent.inviteCode } : undefined,
  };
}

function sanitizeAdmin(admin) {
  return {
    id: admin.id,
    phone: admin.phone,
    displayName: admin.displayName,
    role: admin.role,
    status: admin.status,
    createdAt: admin.createdAt.toISOString(),
    updatedAt: admin.updatedAt.toISOString(),
  };
}

export async function ensureDefaultAdmin() {
  const defaultPhone = "15076032131";
  const existing = await prisma.admin.findUnique({
    where: { phone: defaultPhone },
    select: { id: true },
  });

  if (existing) {
    return;
  }

  await prisma.admin.create({
    data: {
      phone: defaultPhone,
      passwordHash: hashPassword("min6678038"),
      displayName: "超级管理员",
      role: "super_admin",
      status: "active",
    },
  });
}

export async function registerUser({
  email,
  password,
  displayName,
  inviteCode: inviteRaw,
  signupIp: signupIpRaw,
  signupSubnet: signupSubnetRaw,
  deviceId: deviceIdRaw,
}) {
  const normalizedEmail = normalizeEmailInput(email);
  const normalizedDisplayName = String(displayName || "").trim();
  const rawPassword = String(password || "");
  const signupIp = signupIpRaw ? String(signupIpRaw).trim() || null : null;
  const signupSubnet = signupSubnetRaw ? String(signupSubnetRaw).trim() || null : null;
  const deviceId = deviceIdRaw ? String(deviceIdRaw).trim() : "";

  if (!isValidEmailAddress(normalizedEmail)) {
    throw new Error("INVALID_EMAIL");
  }
  if (rawPassword.length < 6) {
    throw new Error("PASSWORD_TOO_SHORT");
  }
  if (!normalizedDisplayName) {
    throw new Error("INVALID_DISPLAY_NAME");
  }

  const agent = await resolveActiveAgentByInviteCode(inviteRaw ?? "");

  const existing = await findUserByEmailCandidates(getEmailLoginCandidates(normalizedEmail), {
    id: true,
  });
  if (existing) {
    throw new Error("EMAIL_ALREADY_EXISTS");
  }

  const policy = await getRegistrationPolicySettings();

  const user = await prisma.$transaction(async (tx) => {
    await assertRegistrationAllowed(tx, {
      signupIp,
      signupSubnet,
      deviceId,
      policy,
    });

    const userCount = await tx.user.count();
    const created = await tx.user.create({
      data: {
        email: normalizedEmail,
        passwordHash: hashPassword(rawPassword),
        displayName: normalizedDisplayName,
        role: userCount === 0 ? "admin" : "user",
        status: "active",
        signupIp,
        signupSubnet,
        agentId: agent.id,
        signupInviteCode: agent.inviteCode,
      },
    });

    if (deviceId.length >= MIN_DEVICE_ID_LEN) {
      await tx.registrationDeviceLink.create({
        data: {
          userId: created.id,
          deviceId,
        },
      });
    }

    return created;
  });

  return { user: sanitizeUser(user) };
}

export async function loginUser({ email, password }) {
  const rawPassword = String(password || "");

  const user = await findUserByEmailCandidates(getEmailLoginCandidates(email));
  if (!user || !verifyPassword(rawPassword, user.passwordHash)) {
    throw new Error("INVALID_CREDENTIALS");
  }
  if (user.status !== "active") {
    throw new Error("USER_DISABLED");
  }

  const token = randomBytes(32).toString("hex");
  const stamp = nowIso();
  const expiresAt = addDays(stamp, SESSION_TTL_DAYS);

  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(expiresAt),
      createdAt: new Date(stamp),
    },
  });

  return {
    token,
    expiresAt,
    user: sanitizeUser(user),
  };
}

async function findUserByEmailCandidates(candidates, select) {
  for (const candidate of candidates) {
    const user = await prisma.user.findUnique({
      where: { email: candidate },
      ...(select ? { select } : {}),
    });
    if (user) return user;
  }
  return null;
}

export async function loginAdmin({ phone, password }) {
  const account = String(phone || "").trim();
  const rawPassword = String(password || "");

  // 1. 优先在 Admin 表查找（超级管理员）
  const admin = await prisma.admin.findUnique({
    where: { phone: account },
  });

  if (admin) {
    if (!verifyPassword(rawPassword, admin.passwordHash)) {
      throw new Error("INVALID_CREDENTIALS");
    }
    if (admin.status !== "active") {
      throw new Error("ADMIN_DISABLED");
    }

    const token = randomBytes(32).toString("hex");
    const stamp = nowIso();
    const expiresAt = addDays(stamp, SESSION_TTL_DAYS);

    await prisma.adminSession.create({
      data: {
        adminId: admin.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(expiresAt),
        createdAt: new Date(stamp),
      },
    });

    return {
      token,
      expiresAt,
      admin: sanitizeAdmin(admin),
    };
  }

  // 2. 如果没找到，尝试在 User 表查找（代理商账号）
  const user = await prisma.user.findUnique({
    where: { email: account.toLowerCase() },
    include: { ownedAgent: true },
  });

  if (user && (user.role === "agent" || user.role === "admin")) {
    if (!verifyPassword(rawPassword, user.passwordHash)) {
      throw new Error("INVALID_CREDENTIALS");
    }
    if (user.status !== "active") {
      throw new Error("USER_DISABLED");
    }

    const token = randomBytes(32).toString("hex");
    const stamp = nowIso();
    const expiresAt = addDays(stamp, SESSION_TTL_DAYS);

    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(expiresAt),
        createdAt: new Date(stamp),
      },
    });

    return {
      token,
      expiresAt,
      admin: {
        id: user.id,
        phone: user.email, // 这里的 phone 字段作为标识符透传
        displayName: user.displayName,
        role: user.role,
        status: user.status,
        inviteCode: user.ownedAgent?.inviteCode,
      },
    };
  }

  throw new Error("INVALID_CREDENTIALS");
}

export async function getSessionUser(token) {
  if (!token) {
    return null;
  }

  const tokenHash = hashToken(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: { include: { ownedAgent: true } } },
  });
  if (!session) {
    return null;
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { tokenHash } }).catch(() => undefined);
    return null;
  }

  if (session.user.status !== "active") {
    return null;
  }

  return {
    user: sanitizeUser(session.user),
    session: {
      userId: session.userId,
      expiresAt: session.expiresAt.toISOString(),
    },
  };
}

export async function getSessionAdmin(token) {
  if (!token) {
    return null;
  }

  const tokenHash = hashToken(token);
  const session = await prisma.adminSession.findUnique({
    where: { tokenHash },
    include: { admin: true },
  });
  if (!session) {
    return null;
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.adminSession.delete({ where: { tokenHash } }).catch(() => undefined);
    return null;
  }

  if (session.admin.status !== "active") {
    return null;
  }

  return {
    admin: sanitizeAdmin(session.admin),
    session: {
      adminId: session.adminId,
      expiresAt: session.expiresAt.toISOString(),
    },
  };
}

export async function requireUser(token) {
  const sessionUser = await getSessionUser(token);
  if (!sessionUser) {
    throw new Error("UNAUTHORIZED");
  }
  return sessionUser;
}

export async function requireSuperAdmin(token) {
  const sessionAdmin = await requireAdminAccount(token);
  if (sessionAdmin.admin.role !== "super_admin") {
    throw new Error("FORBIDDEN");
  }
  return sessionAdmin;
}

export async function requireAdmin(token) {
  const sessionUser = await requireUser(token);
  if (sessionUser.user.role !== "admin") {
    throw new Error("FORBIDDEN");
  }
  return sessionUser;
}

export async function adminSetUserStatus(userId, status) {
  const allowed = ["active", "disabled"];
  if (!allowed.includes(status)) {
    throw new Error("INVALID_STATUS");
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: { status, updatedAt: new Date() },
  });

  return { user: sanitizeUser(user) };
}

export async function adminDeleteUser(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { ownedAgent: { select: { id: true } } },
  });

  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }
  if (user.role === "admin" || user.role === "agent" || user.ownedAgent) {
    throw new Error("USER_DELETE_FORBIDDEN");
  }

  await prisma.$transaction(async (tx) => {
    await tx.registrationDeviceLink.deleteMany({ where: { userId } });
    await tx.session.deleteMany({ where: { userId } });
    await tx.membership.deleteMany({ where: { userId } });
    await tx.order.deleteMany({ where: { userId } });
    await tx.modelConfig.deleteMany({ where: { userId } });
    await tx.prompt.deleteMany({ where: { userId } });
    await tx.wechatAccount.deleteMany({ where: { userId } });
    await tx.articleGenerationLog.deleteMany({ where: { userId } });
    await tx.userQuota.deleteMany({ where: { userId } });
    await tx.user.delete({ where: { id: userId } });
  });

  return { deleted: true };
}

export async function requireAdminAccount(token) {
  const sessionAdmin = await getSessionAdmin(token);
  if (sessionAdmin) {
    return sessionAdmin;
  }

  // 尝试从普通用户 Session 中查找代理商身份
  const sessionUser = await getSessionUser(token);
  if (sessionUser && (sessionUser.user.role === "agent" || sessionUser.user.role === "admin")) {
    return {
      admin: {
        id: sessionUser.user.id,
        phone: sessionUser.user.email,
        displayName: sessionUser.user.displayName,
        role: sessionUser.user.role,
        status: sessionUser.user.status,
        inviteCode: sessionUser.user.ownedAgent?.inviteCode,
      },
      session: sessionUser.session,
    };
  }

  throw new Error("UNAUTHORIZED");
}

// ===== Model Configuration =====

export async function getUserModelConfig(userId) {
  const rows = await prisma.$queryRaw`
    SELECT
      text_api_key AS "textApiKey",
      text_model AS "textModel",
      enable_web_search AS "enableWebSearch"
    FROM model_configs
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  const config = rows[0] ?? null;

  return config
    ? {
        textApiKey: config.textApiKey || "",
        textModel: config.textModel || "",
        enableWebSearch: config.enableWebSearch,
      }
    : {
        textApiKey: "",
        textModel: "",
        enableWebSearch: false,
      };
}

export async function updateUserModelConfig(userId, updates) {
  const allowedFields = ["textApiKey", "textModel", "enableWebSearch"];
  const data = {};

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined) {
      data[
        key === "textApiKey"
          ? "textApiKey"
          : key === "textModel"
            ? "textModel"
            : "enableWebSearch"
      ] = value;
    }
  }

  if (Object.keys(data).length === 0) {
    throw new Error("NO_VALID_UPDATES");
  }

  const textApiKey = Object.prototype.hasOwnProperty.call(data, "textApiKey") ? data.textApiKey : null;
  const textModel = Object.prototype.hasOwnProperty.call(data, "textModel") ? data.textModel : null;
  const enableWebSearch = Object.prototype.hasOwnProperty.call(data, "enableWebSearch")
    ? data.enableWebSearch
    : null;

  const rows = await prisma.$queryRaw`
    INSERT INTO model_configs (
      id,
      user_id,
      text_api_key,
      text_model,
      enable_web_search,
      created_at,
      updated_at
    )
    VALUES (
      ${randomUUID()},
      ${userId},
      ${textApiKey},
      ${textModel},
      COALESCE(${enableWebSearch}, false),
      NOW(),
      NOW()
    )
    ON CONFLICT (user_id)
    DO UPDATE SET
      text_api_key = COALESCE(${textApiKey}, model_configs.text_api_key),
      text_model = COALESCE(${textModel}, model_configs.text_model),
      enable_web_search = COALESCE(${enableWebSearch}, model_configs.enable_web_search),
      updated_at = NOW()
    RETURNING
      text_api_key AS "textApiKey",
      text_model AS "textModel",
      enable_web_search AS "enableWebSearch"
  `;
  const config = rows[0];

  return {
    textApiKey: config?.textApiKey || "",
    textModel: config?.textModel || "",
    enableWebSearch: Boolean(config?.enableWebSearch),
  };
}
