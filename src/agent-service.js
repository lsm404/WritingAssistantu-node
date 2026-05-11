import { randomInt } from "node:crypto";
import { prisma } from "./prisma.js";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

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
    inviteCode: a.inviteCode,
    status: a.status,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    userCount: countMap.get(a.id) ?? 0,
  }));
}

export async function createAgent({ name }) {
  const trimmed = String(name || "").trim();
  if (!trimmed) throw new Error("INVALID_AGENT_NAME");

  return prisma.$transaction(async (tx) => {
    const inviteCode = await generateUniqueInviteCode(tx);
    return tx.agent.create({
      data: {
        name: trimmed,
        inviteCode,
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

export async function setAgentStatus(agentId, status) {
  if (!["active", "disabled"].includes(status)) throw new Error("INVALID_AGENT_STATUS");
  return prisma.agent.update({
    where: { id: String(agentId) },
    data: { status, updatedAt: new Date() },
  });
}
