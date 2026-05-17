import { randomInt, scryptSync, randomBytes } from "node:crypto";
import { prisma } from "./prisma.js";
import { isValidEmailAddress, normalizeEmailInput } from "./email-utils.js";

export const DEFAULT_MEMBERSHIP_CONTACT_WECHAT = "Jiale-8888888";

// 简单的哈希函数（与 auth-service 保持一致）
function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function toBooleanPermission(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

export function normalizeInviteCodeInput(raw) {
  const upper = String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  return upper.slice(0, 8);
}

function generateInviteCandidate() {
  let s = "";
  for (let i = 0; i < 8; i++) {
    s += LETTERS[randomInt(0, LETTERS.length)];
  }
  return s;
}

export async function generateUniqueInviteCode(client = prisma) {
  for (let i = 0; i < 64; i++) {
    const code = generateInviteCandidate();
    const taken = await client.agent.findUnique({
      where: { inviteCode: code },
      select: { id: true },
    });
    if (!taken) return code;
  }
  throw new Error("INVITE_CODE_GENERATION_FAILED");
}

/** 尚无代理人时写入一条默认记录，便于首用户注册（邀请码打印在日志）。 */
export async function ensureBootstrapAgentIfEmpty() {
  const count = await prisma.agent.count();
  if (count > 0) return null;

  const inviteCode = await generateUniqueInviteCode();
  const row = await prisma.agent.create({
    data: {
      name: "官方默认渠道",
      inviteCode,
      status: "active",
    },
  });
  console.log(
    `[agent] No agents yet: created bootstrap agent "${row.name}", invite_code=${inviteCode}`,
  );
  return row;
}

export async function listAgentsWithStats() {
  const rows = await prisma.agent.findMany({
    orderBy: { createdAt: "desc" },
    include: { owner: true },
  });

  const grouped = await prisma.user.groupBy({
    by: ["agentId"],
    where: { agentId: { not: null } },
    _count: { _all: true },
  });

  const countMap = new Map(
    grouped.filter((g) => g.agentId).map((g) => [g.agentId, g._count._all]),
  );

  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    email: a.owner?.email ?? "无账号",
    inviteCode: a.inviteCode,
    contactWechat: a.contactWechat ?? "",
    canGrantMembership: Boolean(a.canGrantMembership),
    status: a.status,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    userCount: countMap.get(a.id) ?? 0,
  }));
}

export async function createAgent({ name, email, password, contactWechat, canGrantMembership }) {
  console.log("[agent-service] createAgent received:", { name, email, password: password ? "***" : "empty" });
  
  const trimmedName = String(name || "").trim();
  const trimmedEmail = normalizeEmailInput(email);
  const trimmedContactWechat = String(contactWechat || "").trim();
  
  if (!trimmedName) throw new Error("INVALID_AGENT_NAME");
  if (!isValidEmailAddress(trimmedEmail)) throw new Error("INVALID_EMAIL");
  if (!password || password.length < 6) throw new Error("PASSWORD_TOO_SHORT");

  return prisma.$transaction(async (tx) => {
    // 1. 获取或创建关联的用户账号
    let user = await tx.user.findUnique({ where: { email: trimmedEmail } });
    
    if (user) {
      // 如果用户已存在，将其角色更新为 agent
      user = await tx.user.update({
        where: { id: user.id },
        data: {
          role: "agent",
          passwordHash: hashPassword(password), // 管理员设置新密码
          displayName: trimmedName || user.displayName,
        }
      });
      console.log(`[agent-service] User ${trimmedEmail} already exists, promoting to agent`);
    } else {
      // 如果不存在，创建新用户
      user = await tx.user.create({
        data: {
          email: trimmedEmail,
          passwordHash: hashPassword(password),
          displayName: trimmedName,
          role: "agent",
          status: "active",
        },
      });
      console.log(`[agent-service] Created new user ${trimmedEmail} for agent`);
    }

    // 2. 生成唯一的邀请码
    const inviteCode = await generateUniqueInviteCode(tx);

    // 3. 创建或更新代理记录 (使用 upsert)
    return await tx.agent.upsert({
      where: { userId: user.id },
      update: {
        name: trimmedName,
        inviteCode,
        contactWechat: trimmedContactWechat,
        canGrantMembership: toBooleanPermission(canGrantMembership),
        status: "active",
      },
      create: {
        userId: user.id,
        name: trimmedName,
        inviteCode,
        contactWechat: trimmedContactWechat,
        canGrantMembership: toBooleanPermission(canGrantMembership),
        status: "active",
      },
    });
  });
}

export async function resolveActiveAgentByInviteCode(raw) {
  const code = normalizeInviteCodeInput(raw);
  if (code.length !== 8) {
    throw new Error("INVALID_INVITE_CODE");
  }

  const agent = await prisma.agent.findUnique({
    where: { inviteCode: code },
  });
  if (!agent) {
    throw new Error("INVITE_CODE_NOT_FOUND");
  }
  if (agent.status !== "active") {
    throw new Error("AGENT_DISABLED");
  }
  return agent;
}

export async function getAgentByUserId(userId) {
  return prisma.agent.findUnique({
    where: { userId: String(userId) },
  });
}

export async function updateAgent(agentId, { name, status, contactWechat, canGrantMembership }) {
  const data = { updatedAt: new Date() };
  if (name !== undefined) data.name = String(name).trim();
  if (contactWechat !== undefined) data.contactWechat = String(contactWechat || "").trim();
  if (canGrantMembership !== undefined) data.canGrantMembership = toBooleanPermission(canGrantMembership);
  if (status !== undefined) {
    if (!["active", "disabled"].includes(status)) throw new Error("INVALID_AGENT_STATUS");
    data.status = status;
  }
  
  return prisma.agent.update({
    where: { id: String(agentId) },
    data,
  });
}

export async function getMembershipContactWechatForUser(userId) {
  const user = await prisma.user.findUnique({
    where: { id: String(userId) },
    select: {
      invitedBy: {
        select: {
          status: true,
          contactWechat: true,
        },
      },
    },
  });

  const agentWechat = String(user?.invitedBy?.contactWechat || "").trim();
  if (user?.invitedBy?.status === "active" && agentWechat) {
    return agentWechat;
  }

  return DEFAULT_MEMBERSHIP_CONTACT_WECHAT;
}
