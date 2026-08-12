import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const PROXY_PATH = "/api/v1/miniapp/video/download";
const DEFAULT_TTL_SECONDS = 15 * 60;
const MAX_TTL_SECONDS = 60 * 60;
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 60_000;
const SIGNING_SECRET =
  process.env.VIDEO_PROXY_SECRET?.trim() || crypto.randomBytes(32).toString("hex");

if (!process.env.VIDEO_PROXY_SECRET?.trim()) {
  console.warn(
    "[video-download] VIDEO_PROXY_SECRET is not configured; signed download URLs will stop working after a server restart.",
  );
}

function sign(sourceUrl, expiresAt) {
  return crypto
    .createHmac("sha256", SIGNING_SECRET)
    .update(`${expiresAt}\n${sourceUrl}`)
    .digest("hex");
}

function signaturesMatch(actual, expected) {
  if (!/^[a-f0-9]{64}$/i.test(actual)) return false;
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function isPrivateIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIp(address) {
  if (net.isIPv4(address)) return isPrivateIpv4(address);
  if (!net.isIPv6(address)) return true;

  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized)) {
    return true;
  }

  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mappedIpv4 ? isPrivateIpv4(mappedIpv4) : false;
}

async function validateUpstreamUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("VIDEO_DOWNLOAD_URL_INVALID");
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("VIDEO_DOWNLOAD_URL_INVALID");
  }
  if (parsed.port && !['80', '443'].includes(parsed.port)) {
    throw new Error("VIDEO_DOWNLOAD_URL_INVALID");
  }

  let addresses;
  try {
    addresses = net.isIP(parsed.hostname)
      ? [{ address: parsed.hostname }]
      : await dns.lookup(parsed.hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("VIDEO_DOWNLOAD_UPSTREAM_UNREACHABLE");
  }

  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("VIDEO_DOWNLOAD_URL_FORBIDDEN");
  }

  return parsed;
}

async function fetchUpstream(sourceUrl, request, signal) {
  let currentUrl = sourceUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const parsed = await validateUpstreamUrl(currentUrl);
    const headers = {
      Accept: "video/*,image/*,application/octet-stream;q=0.9,*/*;q=0.8",
      "Accept-Encoding": "identity",
      "User-Agent":
        request.headers["user-agent"] ||
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
    };
    if (request.headers.range) headers.Range = request.headers.range;
    if (parsed.hostname.endsWith("douyin.com") || parsed.hostname.endsWith("365yg.com")) {
      headers.Referer = "https://www.douyin.com/";
    }

    const upstream = await fetch(parsed, {
      method: "GET",
      headers,
      redirect: "manual",
      signal,
    });

    if (![301, 302, 303, 307, 308].includes(upstream.status)) return upstream;
    const location = upstream.headers.get("location");
    if (!location || redirectCount === MAX_REDIRECTS) {
      throw new Error("VIDEO_DOWNLOAD_TOO_MANY_REDIRECTS");
    }
    currentUrl = new URL(location, parsed).toString();
  }

  throw new Error("VIDEO_DOWNLOAD_TOO_MANY_REDIRECTS");
}

export function buildSignedVideoDownloadPath(sourceUrl, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const expiresAt = Math.floor(Date.now() / 1000) + Math.min(ttlSeconds, MAX_TTL_SECONDS);
  const params = new URLSearchParams({
    url: String(sourceUrl),
    expires: String(expiresAt),
    signature: sign(String(sourceUrl), expiresAt),
  });
  return `${PROXY_PATH}?${params.toString()}`;
}

export async function proxyVideoDownload(request, response, requestUrl) {
  const sourceUrl = requestUrl.searchParams.get("url") || "";
  const expiresAt = Number(requestUrl.searchParams.get("expires"));
  const signature = requestUrl.searchParams.get("signature") || "";
  const now = Math.floor(Date.now() / 1000);

  if (
    !sourceUrl ||
    !Number.isInteger(expiresAt) ||
    expiresAt < now ||
    expiresAt > now + MAX_TTL_SECONDS ||
    !signaturesMatch(signature, sign(sourceUrl, expiresAt))
  ) {
    throw new Error("VIDEO_DOWNLOAD_LINK_INVALID");
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), FETCH_TIMEOUT_MS);
  request.once("aborted", () => abortController.abort());

  try {
    const upstream = await fetchUpstream(sourceUrl, request, abortController.signal);
    clearTimeout(timeout);
    if (!upstream.ok || !upstream.body) {
      throw new Error(`VIDEO_DOWNLOAD_UPSTREAM_${upstream.status}`);
    }

    const responseHeaders = {
      "Cache-Control": "private, no-store",
      "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
      "Content-Disposition": "attachment",
    };
    for (const headerName of [
      "accept-ranges",
      "content-length",
      "content-range",
      "etag",
      "last-modified",
    ]) {
      const value = upstream.headers.get(headerName);
      if (value) responseHeaders[headerName] = value;
    }
    response.writeHead(upstream.status, responseHeaders);
    await pipeline(Readable.fromWeb(upstream.body), response);
  } finally {
    clearTimeout(timeout);
  }
}
