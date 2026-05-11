/** 设备 ID 长度 ≥ 此值才参与「单设备账号数」限制；过短或缺失则仅按 IP/网段 */
export const MIN_DEVICE_ID_LEN = 8;

/**
 * @param {import("http").IncomingMessage} request
 * @returns {string}
 */
export function getClientIpFromRequest(request) {
  const trust =
    process.env.TRUST_PROXY === "1" ||
    String(process.env.TRUST_PROXY || "").toLowerCase() === "true";

  const xff = request.headers["x-forwarded-for"];
  if (trust && xff) {
    const first = String(xff).split(",")[0]?.trim();
    if (first) {
      return normalizeIp(first);
    }
  }

  const ra = request.socket?.remoteAddress ?? "";
  return normalizeIp(ra);
}

/**
 * @param {string} raw
 * @returns {string}
 */
export function normalizeIp(raw) {
  let s = String(raw).trim();
  if (s.startsWith("::ffff:")) {
    s = s.slice(7);
  }
  if (s.startsWith("[") && s.includes("]")) {
    s = s.slice(1, s.indexOf("]"));
  }
  return s;
}

/**
 * IPv4 → /24 bucket；IPv6 → 粗粒度前若干段；本机回环统一为 local
 * @param {string} ip normalize 后的地址
 * @returns {string}
 */
export function computeSubnetKey(ip) {
  if (!ip) {
    return "";
  }

  if (ip === "127.0.0.1" || ip === "::1" || ip.toLowerCase() === "localhost") {
    return "local";
  }

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    return `v4:${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  }

  if (ip.includes(":")) {
    const parts = ip.split(":").filter((p) => p.length > 0);
    const head = parts.slice(0, 4).join(":");
    return head ? `v6:${head}::/64` : `v6:${ip}`;
  }

  return `unk:${ip}`;
}

/**
 * @param {{ user: unknown, registrationDeviceLink: unknown }} db Prisma client 或 transaction
 * @param {{
 *   signupIp: string | null,
 *   signupSubnet: string | null,
 *   deviceId: string,
 *   policy: {
 *     ipWindowDays: number,
 *     ipMaxCount: number,
 *     subnetWindowDays: number,
 *     subnetMaxCount: number,
 *     maxAccountsPerDevice: number,
 *   },
 * }} args
 */
export async function assertRegistrationAllowed(db, { signupIp, signupSubnet, deviceId, policy }) {
  const now = Date.now();
  const ipCutoff = new Date(now - policy.ipWindowDays * 86_400_000);
  const subnetCutoff = new Date(now - policy.subnetWindowDays * 86_400_000);

  if (signupIp) {
    const c = await db.user.count({
      where: { signupIp, createdAt: { gte: ipCutoff } },
    });
    if (c >= policy.ipMaxCount) {
      throw new Error("REGISTRATION_IP_LIMIT");
    }
  }

  if (signupSubnet) {
    const c = await db.user.count({
      where: { signupSubnet, createdAt: { gte: subnetCutoff } },
    });
    if (c >= policy.subnetMaxCount) {
      throw new Error("REGISTRATION_SUBNET_LIMIT");
    }
  }

  const did = String(deviceId || "").trim();
  if (did.length >= MIN_DEVICE_ID_LEN) {
    const c = await db.registrationDeviceLink.count({
      where: { deviceId: did },
    });
    if (c >= policy.maxAccountsPerDevice) {
      throw new Error("REGISTRATION_DEVICE_LIMIT");
    }
  }
}
