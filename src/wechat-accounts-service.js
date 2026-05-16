import { prisma } from "./prisma.js";
import { decryptWechatAccountAppSecretTransport } from "./wechat-account-transport-crypto.js";

function decodeWechatAccountAppSecretBase64(value) {
  if (!value || typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    throw new Error("APP_SECRET_BASE64_INVALID");
  }

  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    if (Buffer.from(decoded, "utf8").toString("base64") !== trimmed) {
      throw new Error("APP_SECRET_BASE64_INVALID");
    }
    return decoded;
  } catch {
    throw new Error("APP_SECRET_BASE64_INVALID");
  }
}

export async function getUserWechatAccounts(userId) {
  const rows = await prisma.wechatAccount.findMany({
    where: { userId },
    orderBy: { sortOrder: "asc" },
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { activeWechatClientKey: true },
  });

  const accounts = rows.map((row) => ({
    id: row.clientKey,
    name: row.name,
    appId: row.appId,
    appSecret: row.appSecret,
    thumbMediaId: row.thumbMediaId,
  }));

  const active = user?.activeWechatClientKey ?? "";
  const activeAccountId =
    active && accounts.some((a) => a.id === active) ? active : accounts[0]?.id ?? "";

  return { accounts, activeAccountId };
}

/**
 * 全量替换当前用户的公众号账号列表（写入数据库）；接口载荷优先使用 RSA-OAEP 密文字段 appSecretEncrypted。
 * appSecretBase64 仅用于无 WebCrypto 的临时 HTTP 部署兜底，不提供安全加密。
 */
export async function replaceUserWechatAccounts(userId, body) {
  if (!body || typeof body !== "object") {
    throw new Error("INVALID_BODY");
  }

  const accounts = body.accounts;
  if (!Array.isArray(accounts)) {
    throw new Error("ACCOUNTS_REQUIRED");
  }

  let activeAccountId =
    typeof body.activeAccountId === "string" ? body.activeAccountId.trim() : "";

  const normalizedAccounts = accounts.map((raw, index) => {
    const clientKey = String(raw?.id ?? "").trim();
    const name = String(raw?.name ?? "").trim();
    if (!clientKey || !name) {
      throw new Error("ACCOUNT_NAME_AND_ID_REQUIRED");
    }

    const cipher =
      raw?.appSecretEncrypted !== undefined && raw?.appSecretEncrypted !== null
        ? String(raw.appSecretEncrypted).trim()
        : "";
    const base64Secret =
      raw?.appSecretBase64 !== undefined && raw?.appSecretBase64 !== null
        ? String(raw.appSecretBase64).trim()
        : "";
    const plainLeak =
      raw?.appSecret !== undefined && raw?.appSecret !== null ? String(raw.appSecret).trim() : "";

    let appSecret = "";
    if (cipher) {
      appSecret = decryptWechatAccountAppSecretTransport(cipher);
    } else if (base64Secret) {
      appSecret = decodeWechatAccountAppSecretBase64(base64Secret);
    } else if (plainLeak) {
      throw new Error("APP_SECRET_PLAINTEXT_FORBIDDEN");
    }

    return {
      clientKey,
      name,
      appId: String(raw?.appId ?? "").trim(),
      appSecret,
      thumbMediaId: String(raw?.thumbMediaId ?? "").trim(),
      sortOrder: index,
    };
  });

  await prisma.$transaction(async (tx) => {
    const ids = normalizedAccounts.map((account) => account.clientKey);
    if (!ids.length) {
      await tx.wechatAccount.deleteMany({ where: { userId } });
      await tx.user.update({
        where: { id: userId },
        data: { activeWechatClientKey: null },
      });
      return;
    }

    await tx.wechatAccount.deleteMany({
      where: {
        userId,
        clientKey: { notIn: ids },
      },
    });

    for (const account of normalizedAccounts) {
      await tx.wechatAccount.upsert({
        where: {
          userId_clientKey: {
            userId,
            clientKey: account.clientKey,
          },
        },
        create: {
          userId,
          ...account,
        },
        update: {
          name: account.name,
          appId: account.appId,
          appSecret: account.appSecret,
          thumbMediaId: account.thumbMediaId,
          sortOrder: account.sortOrder,
        },
      });
    }

    if (!activeAccountId || !ids.includes(activeAccountId)) {
      activeAccountId = ids[0];
    }

    await tx.user.update({
      where: { id: userId },
      data: { activeWechatClientKey: activeAccountId },
    });
  });

  return getUserWechatAccounts(userId);
}
