/** 设备 ID 长度 ≥ 此值才参与「单设备账号数」限制；过短或缺失则仅按 IP/网段 */
export const MIN_DEVICE_ID_LEN = 8;

function isTrustedProxySource(ip) {
  if (!ip) return false;
  if (ip === "127.0.0.1" || ip === "::1" || ip.toLowerCase() === "localhost") return true;
  if (ip === "::") return true;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!v4) {
    const lower = ip.toLowerCase();
    return lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:");
  }

  const a = Number(v4[1]);
  const b = Number(v4[2]);
  if (a === 10 || a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function isEmptyIpValue(value) {
  const s = String(value || "").trim().toLowerCase();
  return !s || s === "unknown" || s === "null" || s === "undefined";
}

function firstHeaderIp(value) {
  if (!value) return "";
  const raw = Array.isArray(value) ? value[0] : value;
  for (const part of String(raw).split(",")) {
    const candidate = normalizeIp(part);
    if (!isEmptyIpValue(candidate)) {
      return candidate;
    }
  }
  return "";
}

function firstForwardedHeaderIp(value) {
  if (!value) return "";
  const raw = Array.isArray(value) ? value[0] : value;
  for (const part of String(raw).split(",")) {
    const match = /(?:^|;)\s*for=(?:"?)([^;,"]+)/i.exec(part);
    const candidate = normalizeIp(match?.[1] || "");
    if (!isEmptyIpValue(candidate)) {
      return candidate;
    }
  }
  return "";
}

function getForwardedIp(request) {
  return (
    firstForwardedHeaderIp(request.headers["forwarded"]) ||
    firstHeaderIp(request.headers["cf-connecting-ip"]) ||
    firstHeaderIp(request.headers["true-client-ip"]) ||
    firstHeaderIp(request.headers["x-real-ip"]) ||
    firstHeaderIp(request.headers["x-client-ip"]) ||
    firstHeaderIp(request.headers["x-cluster-client-ip"]) ||
    firstHeaderIp(request.headers["fastly-client-ip"]) ||
    firstHeaderIp(request.headers["x-original-forwarded-for"]) ||
    firstHeaderIp(request.headers["x-forwarded-for"])
  );
}

/**
 * @param {import("http").IncomingMessage} request
 * @returns {string}
 */
export function getClientIpFromRequest(request) {
  const trustSetting = String(process.env.TRUST_PROXY || "").toLowerCase();
  const trustProxy = trustSetting === "1" || trustSetting === "true" || trustSetting === "always";
  const remoteIp = normalizeIp(request.socket?.remoteAddress ?? "");
  const remoteIsTrustedProxy = isTrustedProxySource(remoteIp);
  const fromOpenClawProxy =
    remoteIsTrustedProxy && String(request.headers["x-openclaw-proxy"] || "").toLowerCase() === "web";

  if (trustSetting === "always" || trustProxy || remoteIsTrustedProxy || fromOpenClawProxy) {
    const forwardedIp = getForwardedIp(request);
    if (forwardedIp) {
      return forwardedIp;
    }

    // 如果请求来自本机 / 内网代理但没有真实 IP 头，不要把代理自身 IP 当作所有用户的注册 IP。
    if (remoteIsTrustedProxy || fromOpenClawProxy || trustSetting === "always") {
      return "";
    }
  }

  return isEmptyIpValue(remoteIp) ? "" : remoteIp;
}

/**
 * @param {string} raw
 * @returns {string}
 */
export function normalizeIp(raw) {
  let s = String(raw).trim();
  if (isEmptyIpValue(s)) {
    return "";
  }
  if (s.startsWith("::ffff:")) {
    s = s.slice(7);
  }
  if (s.startsWith("[") && s.includes("]")) {
    s = s.slice(1, s.indexOf("]"));
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(s)) {
    s = s.slice(0, s.lastIndexOf(":"));
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
