import "dotenv/config";
import http from "node:http";
import os from "node:os";
import { URL } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma, ensureDatabaseSetup, getDatabaseUrl } from "./prisma.js";
import {
  ensureWechatAccountTransportKeys,
  getWechatAccountTransportPublicKeyPem,
} from "./wechat-account-transport-crypto.js";
import {
  adminSetUserStatus,
  ensureDefaultAdmin,
  getUserModelConfig,
  loginAdmin,
  loginUser,
  registerUser,
  requireAdminAccount,
  requireSuperAdmin,
  requireUser,
  updateUserModelConfig,
} from "./auth-service.js";
import { createWechatDraft, generateArticleContent, generateImageContent, uploadWechatThumbMedia } from "./content-service.js";
import {
  exportLicenses,
  generateLicenses,
  getLicenseDashboard,
  syncOpenClawLicensePool,
} from "./license-service.js";
import {
  adminGrantMembership,
  adminRevokeMembership,
  getMembershipSummary,
  listAllOrders,
  listPlans,
  listUsersWithMemberships,
  purchasePlan,
} from "./membership-service.js";
import {
  getImageGenerationSettings,
  updateImageGenerationSettings,
  getQuotaFreeRollingSettings,
  updateQuotaFreeRollingSettings,
  getRegistrationPolicySettings,
  updateRegistrationPolicySettings,
  getTextGenerationSettings,
  updateTextGenerationSettings,
} from "./system-settings-service.js";
import { assertUserQuotaAvailable, consumeUserQuota, getUserQuotaSummary } from "./quota-service.js";
import { computeSubnetKey, getClientIpFromRequest } from "./registration-guard.js";
import {
  createAgent,
  ensureBootstrapAgentIfEmpty,
  getAgentByUserId,
  getMembershipContactWechatForUser,
  listAgentsWithStats,
  updateAgent,
} from "./agent-service.js";
import { getUserPrompts, createUserPrompt, updateUserPrompt, deleteUserPrompt } from "./prompt-service.js";
import { getUserWechatAccounts, replaceUserWechatAccounts } from "./wechat-accounts-service.js";

const PORT = Number(process.env.PORT || 3100);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".woff2":"font/woff2",
  ".zip":  "application/zip",
  ".msi":  "application/x-msi",
  ".exe":  "application/vnd.microsoft.portable-executable",
};

function serveStatic(response, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || "application/octet-stream";
  try {
    const data = fs.readFileSync(filePath);
    response.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=3600" });
    response.end(data);
    return true;
  } catch {
    return false;
  }
}

await ensureDatabaseSetup();
await ensureDefaultAdmin();
await ensureBootstrapAgentIfEmpty();
ensureWechatAccountTransportKeys();

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function getAuthToken(request) {
  const header = request.headers.authorization;
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token.trim();
}

function sendText(response, statusCode, contentType, body, filename) {
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  };

  if (filename) {
    headers["Content-Disposition"] = `attachment; filename="${filename}"`;
  }

  response.writeHead(statusCode, headers);
  response.end(body);
}

function getScope(raw) {
  if (raw === "available" || raw === "activated" || raw === "all") {
    return raw;
  }
  return "active";
}

function buildFilename(format, scope) {
  const stamp = new Date().toISOString().slice(0, 10);
  return `openclaw-licenses-${scope}-${stamp}.${format}`;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;

    request.on("data", (chunk) => {
      if (rejected) {
        return;
      }
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buffer);
      size += buffer.length;
      if (size > 1024 * 1024) {
        rejected = true;
        reject(new Error("BODY_TOO_LARGE"));
      }
    });

    request.on("end", () => {
      if (rejected) {
        return;
      }
      const raw = Buffer.concat(chunks, size).toString("utf8");
      if (!raw) {
        resolve(null);
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("INVALID_JSON"));
      }
    });

    request.on("error", reject);
  });
}

function getLocalIpv4Addresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const records of Object.values(interfaces)) {
    for (const record of records || []) {
      if (!record) continue;
      const family = typeof record.family === "string" ? record.family : String(record.family);
      if (family !== "IPv4" || record.internal) continue;
      addresses.push(record.address);
    }
  }

  return [...new Set(addresses)];
}

async function getPublicIpAddress() {
  const providers = [
    {
      url: "https://api.ipify.org?format=json",
      parse: async (response) => {
        const data = await response.json();
        return String(data?.ip || "").trim();
      },
    },
    {
      url: "https://checkip.amazonaws.com/",
      parse: async (response) => {
        const text = await response.text();
        return text.trim();
      },
    },
  ];

  for (const provider of providers) {
    try {
      const response = await fetch(provider.url, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        continue;
      }
      const ip = await provider.parse(response);
      if (ip) {
        return ip;
      }
    } catch {
      // try the next provider
    }
  }

  return "";
}

async function readMultipartForm(request) {
  const webRequest = new Request("http://localhost/upload", {
    method: request.method || "POST",
    headers: request.headers,
    body: request,
    duplex: "half",
  });
  return webRequest.formData();
}

const server = http.createServer(async (request, response) => {
  const method = request.method ?? "GET";
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const pathname = requestUrl.pathname;

  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, Accept, Origin, X-Device-Id, Cache-Control, Pragma",
  );
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  response.setHeader("Access-Control-Max-Age", "86400");

  if (method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  try {
    if (method === "GET" && pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        service: "node-backend",
        database: {
          type: "postgresql",
          connected: Boolean(getDatabaseUrl()),
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (method === "GET" && pathname === "/api/v1/ping") {
      sendJson(response, 200, { message: "pong" });
      return;
    }

    if (method === "POST" && pathname === "/api/v1/ping") {
      let body = null;
      try {
        body = await readJsonBody(request);
      } catch {
        body = null;
      }
      sendJson(response, 200, { echo: body });
      return;
    }

    if (method === "GET" && pathname === "/api/v1/plans") {
      const includeInactive = requestUrl.searchParams.get("includeInactive") === "true";
      const plans = await listPlans(includeInactive);
      sendJson(response, 200, { plans });
      return;
    }

    if (method === "GET" && pathname === "/api/v1/licenses") {
      const data = await getLicenseDashboard();
      sendJson(response, 200, data);
      return;
    }

    if (method === "POST" && pathname === "/api/v1/licenses") {
      let body;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        if (error instanceof Error && error.message === "INVALID_JSON") {
          sendJson(response, 400, { error: "INVALID_JSON" });
          return;
        }
        if (error instanceof Error && error.message === "BODY_TOO_LARGE") {
          sendJson(response, 413, { error: "BODY_TOO_LARGE" });
          return;
        }
        throw error;
      }

      const count = Number(body?.count);
      if (!Number.isFinite(count) || count <= 0) {
        sendJson(response, 400, { error: "INVALID_COUNT" });
        return;
      }

      try {
        const created = await generateLicenses({
          count,
          prefix: body?.prefix,
        });
        const sync = await syncOpenClawLicensePool();
        sendJson(response, 200, { ok: true, created, sync });
        return;
      } catch {
        sendJson(response, 500, { error: "SYNC_OPENCLAW_FAILED" });
        return;
      }
    }

    if (method === "GET" && pathname === "/api/v1/licenses/export") {
      const format = (requestUrl.searchParams.get("format") ?? "env").toLowerCase();
      const scope = getScope(requestUrl.searchParams.get("scope"));
      const exported = await exportLicenses(scope);

      if (format === "json") {
        sendText(
          response,
          200,
          "application/json; charset=utf-8",
          exported.jsonText,
          buildFilename("json", scope),
        );
        return;
      }

      if (format === "txt") {
        sendText(
          response,
          200,
          "text/plain; charset=utf-8",
          exported.txtText,
          buildFilename("txt", scope),
        );
        return;
      }

      sendText(
        response,
        200,
        "text/plain; charset=utf-8",
        exported.envText,
        buildFilename("env", scope),
      );
      return;
    }

    if (method === "POST" && pathname === "/api/article/generate") {
      let body;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        if (error instanceof Error && error.message === "INVALID_JSON") {
          sendJson(response, 400, { error: "INVALID_JSON" });
          return;
        }
        throw error;
      }

      try {
        const auth = await requireUser(getAuthToken(request));
        const membership = await getMembershipSummary(auth.user.id);
        await assertUserQuotaAvailable(auth.user.id, membership, "text", 1);
        const result = await generateArticleContent(body ?? {}, auth.user.id);
        const quota = await consumeUserQuota(auth.user.id, membership, "text", 1);
        sendJson(response, 200, { ...result, quota });
      } catch (error) {
        const message = error instanceof Error ? error.message : "ARTICLE_GENERATE_FAILED";
        console.error("[article/generate] failed:", error);
        const statusCode =
          message === "UNAUTHORIZED"
            ? 401
            : message === "TOPIC_REQUIRED" ||
                message === "SOURCE_ARTICLE_REQUIRED" ||
                message === "ARK_API_KEY_MISSING" ||
                message === "ARK_MODEL_MISSING" ||
                message === "TEXT_QUOTA_EXCEEDED"
            ? 400
            : 500;
        sendJson(response, statusCode, { error: message });
      }
      return;
    }

    if (method === "POST" && pathname === "/api/image/generate") {
      let body;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        if (error instanceof Error && error.message === "INVALID_JSON") {
          sendJson(response, 400, { error: "INVALID_JSON" });
          return;
        }
        throw error;
      }

      try {
        const auth = await requireUser(getAuthToken(request));
        const membership = await getMembershipSummary(auth.user.id);

        if (membership?.isActive && Number(membership?.plan?.imageMonthlyLimit ?? 0) <= 0) {
          sendJson(response, 403, { error: "IMAGE_GENERATION_NOT_ALLOWED_FOR_BASIC_PLAN" });
          return;
        }

        await assertUserQuotaAvailable(auth.user.id, membership, "image", Number(body?.n || 1));
        const result = await generateImageContent({
          ...(body ?? {}),
          watermark: membership?.isActive ? body?.watermark : true,
        });
        const quota = await consumeUserQuota(auth.user.id, membership, "image", Number(body?.n || 1));
        sendJson(response, 200, { ...result, quota });
      } catch (error) {
        const message = error instanceof Error ? error.message : "IMAGE_GENERATE_FAILED";
        const statusCode =
          message === "UNAUTHORIZED"
            ? 401
            : message === "PROMPT_REQUIRED" ||
                  message === "IMAGE_QUOTA_EXCEEDED" ||
                  message === "ARK_IMAGE_API_KEY_MISSING" ||
                  message === "ARK_IMAGE_MODEL_MISSING"
                ? 400
                : 500;
        sendJson(response, statusCode, { error: message });
      }
      return;
    }

    if (method === "POST" && pathname === "/api/wechat/upload_thumb") {
      try {
        const form = await readMultipartForm(request);
        const file = form.get("file");
        if (!(file instanceof File)) {
          sendJson(response, 400, { error: "FILE_REQUIRED" });
          return;
        }

        const result = await uploadWechatThumbMedia(file, {
          wechat_appid: String(form.get("wechat_appid") || ""),
          wechat_appsecret: String(form.get("wechat_appsecret") || ""),
        });
        sendJson(response, 200, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "WECHAT_UPLOAD_FAILED";
        const statusCode =
          message === "WECHAT_APPID_MISSING" || message === "WECHAT_APPSECRET_MISSING" ? 400 : 500;
        sendJson(response, statusCode, { error: message });
      }
      return;
    }

    if (method === "POST" && pathname === "/api/wechat/draft") {
      let body;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        if (error instanceof Error && error.message === "INVALID_JSON") {
          sendJson(response, 400, { error: "INVALID_JSON" });
          return;
        }
        throw error;
      }

      try {
        const result = await createWechatDraft(body ?? {});
        sendJson(response, 200, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "WECHAT_DRAFT_FAILED";
        const statusCode =
          message === "TITLE_REQUIRED" ||
          message === "CONTENT_REQUIRED" ||
          message === "WECHAT_APPID_MISSING" ||
          message === "WECHAT_APPSECRET_MISSING" ||
          message === "WECHAT_THUMB_MEDIA_ID_MISSING"
            ? 400
            : 500;
        sendJson(response, statusCode, { error: message });
      }
      return;
    }

    // Model Configuration routes
    if (method === "GET" && pathname === "/api/v1/model-config") {
      try {
        const auth = await requireUser(getAuthToken(request));
        const config = await getUserModelConfig(auth.user.id);
        sendJson(response, 200, { config });
      } catch (error) {
        const message = error.message || "Internal server error";
        const statusCode = message === "UNAUTHORIZED" ? 401 : 500;
        sendJson(response, statusCode, { error: message });
      }
      return;
    }

    if (method === "PUT" && pathname === "/api/v1/model-config") {
      try {
        const auth = await requireUser(getAuthToken(request));
        const body = await readJsonBody(request);
        const config = await updateUserModelConfig(auth.user.id, body);
        sendJson(response, 200, { config });
      } catch (error) {
        const message = error.message || "Internal server error";
        const statusCode = 
          message === "UNAUTHORIZED" ? 401 :
          message === "NO_VALID_UPDATES" ? 400 :
          500;
        sendJson(response, statusCode, { error: message });
      }
      return;
    }

    if (method === "GET" && pathname === "/api/v1/prompts") {
      try {
        const auth = await requireUser(getAuthToken(request));
        const prompts = await getUserPrompts(auth.user.id);
        sendJson(response, 200, { prompts });
      } catch (error) {
        const message = error.message || "Internal server error";
        sendJson(response, message === "UNAUTHORIZED" ? 401 : 500, { error: message });
      }
      return;
    }

    if (method === "POST" && pathname === "/api/v1/prompts") {
      try {
        const auth = await requireUser(getAuthToken(request));
        const body = await readJsonBody(request);
        const prompt = await createUserPrompt(auth.user.id, body);
        sendJson(response, 201, { prompt });
      } catch (error) {
        const message = error.message || "Internal server error";
        const statusCode = message === "UNAUTHORIZED" ? 401 : message === "NAME_AND_CONTENT_REQUIRED" ? 400 : 500;
        sendJson(response, statusCode, { error: message });
      }
      return;
    }

    const promptIdMatch = pathname.match(/^\/api\/v1\/prompts\/([^/]+)$/);
    if (method === "PUT" && promptIdMatch) {
      try {
        const auth = await requireUser(getAuthToken(request));
        const body = await readJsonBody(request);
        const promptId = promptIdMatch[1];
        const prompt = await updateUserPrompt(auth.user.id, promptId, body);
        sendJson(response, 200, { prompt });
      } catch (error) {
        const message = error.message || "Internal server error";
        const statusCode = message === "UNAUTHORIZED" ? 401 : message === "PROMPT_NOT_FOUND" ? 404 : message === "NAME_AND_CONTENT_REQUIRED" ? 400 : 500;
        sendJson(response, statusCode, { error: message });
      }
      return;
    }

    if (method === "DELETE" && promptIdMatch) {
      try {
        const auth = await requireUser(getAuthToken(request));
        const promptId = promptIdMatch[1];
        await deleteUserPrompt(auth.user.id, promptId);
        sendJson(response, 200, { ok: true });
      } catch (error) {
        const message = error.message || "Internal server error";
        const statusCode = message === "UNAUTHORIZED" ? 401 : message === "PROMPT_NOT_FOUND" ? 404 : 500;
        sendJson(response, statusCode, { error: message });
      }
      return;
    }

    if (method === "GET" && pathname === "/api/v1/wechat-accounts/encryption-key") {
      try {
        await requireUser(getAuthToken(request));
        sendJson(response, 200, { publicKeyPem: getWechatAccountTransportPublicKeyPem() });
      } catch (error) {
        const message = error.message || "Internal server error";
        sendJson(response, message === "UNAUTHORIZED" ? 401 : 500, { error: message });
      }
      return;
    }

    if (method === "GET" && pathname === "/api/v1/wechat-accounts") {
      try {
        const auth = await requireUser(getAuthToken(request));
        const payload = await getUserWechatAccounts(auth.user.id);
        sendJson(response, 200, payload);
      } catch (error) {
        const message = error.message || "Internal server error";
        sendJson(response, message === "UNAUTHORIZED" ? 401 : 500, { error: message });
      }
      return;
    }

    if (method === "PUT" && pathname === "/api/v1/wechat-accounts") {
      try {
        const auth = await requireUser(getAuthToken(request));
        const body = await readJsonBody(request);
        
        // 限制公众号绑定数量
        const membership = await getMembershipSummary(auth.user.id);
        const accountCount = Array.isArray(body?.accounts) ? body.accounts.length : 0;
        
        let limit = 1; // 默认（免费或过期） 1 个
        if (membership?.isActive && membership?.plan) {
          limit = membership.plan.wechatAccountLimit ?? 1;
        }

        if (accountCount > limit) {
          sendJson(response, 403, { error: `PLAN_WECHAT_LIMIT_EXCEEDED:${limit}` });
          return;
        }

        const payload = await replaceUserWechatAccounts(auth.user.id, body ?? {});
        sendJson(response, 200, payload);
      } catch (error) {
        const message = error.message || "Internal server error";
        const statusCode =
          message === "UNAUTHORIZED"
            ? 401
            : message === "INVALID_BODY" ||
                message === "ACCOUNTS_REQUIRED" ||
                message === "ACCOUNT_NAME_AND_ID_REQUIRED" ||
                message === "APP_SECRET_PLAINTEXT_FORBIDDEN" ||
                message === "APP_SECRET_CIPHER_INVALID"
              ? 400
              : message === "APP_SECRET_DECRYPT_FAILED"
                ? 400
                : 500;
        sendJson(response, statusCode, { error: message });
      }
      return;
    }

    if (method === "POST" && pathname === "/api/v1/admin/auth/login") {
      let body;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        if (error instanceof Error && error.message === "INVALID_JSON") {
          sendJson(response, 400, { error: "INVALID_JSON" });
          return;
        }
        throw error;
      }

      try {
        const result = await loginAdmin(body ?? {});
        sendJson(response, 200, {
          ok: true,
          token: result.token,
          expiresAt: result.expiresAt,
          admin: result.admin,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "LOGIN_FAILED";
        const statusCode =
          message === "INVALID_CREDENTIALS" || message === "ADMIN_DISABLED" ? 401 : 500;
        sendJson(response, statusCode, { error: message });
      }
      return;
    }

    if (method === "GET" && pathname === "/api/v1/admin/auth/me") {
      try {
        const auth = await requireAdminAccount(getAuthToken(request));
        sendJson(response, 200, {
          admin: auth.admin,
          session: auth.session,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "UNAUTHORIZED";
        sendJson(response, message === "UNAUTHORIZED" ? 401 : 500, { error: message });
      }
      return;
    }

    if (method === "POST" && pathname === "/api/v1/auth/register") {
      let body;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        if (error instanceof Error && error.message === "INVALID_JSON") {
          sendJson(response, 400, { error: "INVALID_JSON" });
          return;
        }
        throw error;
      }

      try {
        const ip = getClientIpFromRequest(request);
        const subnet = computeSubnetKey(ip);
        const deviceHeader = request.headers["x-device-id"];
        const deviceId =
          typeof deviceHeader === "string" && deviceHeader.trim().length > 0
            ? deviceHeader.trim()
            : String(body?.deviceId ?? "").trim();

        const result = await registerUser({
          ...(body ?? {}),
          signupIp: ip || null,
          signupSubnet: subnet || null,
          deviceId,
        });
        sendJson(response, 201, {
          ok: true,
          user: result.user,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "REGISTER_FAILED";
        const tooMany =
          message === "REGISTRATION_IP_LIMIT" ||
          message === "REGISTRATION_SUBNET_LIMIT" ||
          message === "REGISTRATION_DEVICE_LIMIT";
        const statusCode =
          message === "EMAIL_ALREADY_EXISTS" ||
          message === "INVALID_EMAIL" ||
          message === "PASSWORD_TOO_SHORT" ||
          message === "INVALID_DISPLAY_NAME" ||
          message === "INVALID_INVITE_CODE" ||
          message === "INVITE_CODE_NOT_FOUND" ||
          message === "AGENT_DISABLED"
            ? 400
            : tooMany
              ? 429
              : 500;
        sendJson(response, statusCode, { error: message });
      }
      return;
    }

    if (method === "POST" && pathname === "/api/v1/auth/login") {
      let body;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        if (error instanceof Error && error.message === "INVALID_JSON") {
          sendJson(response, 400, { error: "INVALID_JSON" });
          return;
        }
        throw error;
      }

      try {
        const result = await loginUser(body ?? {});
        sendJson(response, 200, {
          ok: true,
          token: result.token,
          expiresAt: result.expiresAt,
          user: result.user,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "LOGIN_FAILED";
        const statusCode =
          message === "INVALID_CREDENTIALS" || message === "USER_DISABLED" ? 401 : 500;
        sendJson(response, statusCode, { error: message });
      }
      return;
    }

    if (method === "GET" && pathname === "/api/v1/auth/me") {
      try {
        const auth = await requireUser(getAuthToken(request));
        const membership = await getMembershipSummary(auth.user.id);
        const quota = await getUserQuotaSummary(auth.user.id, membership);
        sendJson(response, 200, {
          user: {
            ...auth.user,
            membershipContactWechat: await getMembershipContactWechatForUser(auth.user.id),
          },
          membership,
          quota,
          session: auth.session,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "UNAUTHORIZED";
        sendJson(response, message === "UNAUTHORIZED" ? 401 : 500, { error: message });
      }
      return;
    }

    if (method === "GET" && pathname === "/api/v1/memberships/me") {
      try {
        const auth = await requireUser(getAuthToken(request));
        const membership = await getMembershipSummary(auth.user.id);
        sendJson(response, 200, {
          membership,
          quota: await getUserQuotaSummary(auth.user.id, membership),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "UNAUTHORIZED";
        sendJson(response, message === "UNAUTHORIZED" ? 401 : 500, { error: message });
      }
      return;
    }

    if (method === "POST" && pathname === "/api/v1/memberships/checkout") {
      let body;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        if (error instanceof Error && error.message === "INVALID_JSON") {
          sendJson(response, 400, { error: "INVALID_JSON" });
          return;
        }
        throw error;
      }

      try {
        const auth = await requireUser(getAuthToken(request));
        const result = await purchasePlan(auth.user.id, body?.planCode);
        sendJson(response, 200, {
          ok: true,
          ...result,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "CHECKOUT_FAILED";
        const statusCode =
          message === "UNAUTHORIZED"
            ? 401
            : message === "PLAN_NOT_FOUND" || message === "LIFETIME_ALREADY_ACTIVE"
              ? 400
              : 500;
        sendJson(response, statusCode, { error: message });
      }
      return;
    }

    if (method === "GET" && pathname === "/api/v1/admin/users") {
      try {
        const auth = await requireAdminAccount(getAuthToken(request));
        let inviteCode = requestUrl.searchParams.get("inviteCode") || "";
        let agentId = requestUrl.searchParams.get("agentId") || "";

        if (auth.admin.role === "agent") {
          const agent = await getAgentByUserId(auth.admin.id);
          if (!agent) {
            sendJson(response, 403, { error: "AGENT_RECORD_NOT_FOUND" });
            return;
          }
          agentId = agent.id;
          inviteCode = "";
        }

        sendJson(response, 200, {
          users: await listUsersWithMemberships({ inviteCode, agentId }),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "FORBIDDEN";
        const statusCode = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
        sendJson(response, statusCode, { error: message });
      }
      return;
    }


    if (method === "GET" && pathname === "/api/v1/admin/orders") {
      try {
        const auth = await requireAdminAccount(getAuthToken(request));
        let agentId = "";

        if (auth.admin.role === "agent") {
          const agent = await getAgentByUserId(auth.admin.id);
          if (!agent) {
            sendJson(response, 403, { error: "AGENT_RECORD_NOT_FOUND" });
            return;
          }
          agentId = agent.id;
        }

        sendJson(response, 200, { orders: await listAllOrders({ agentId }) });
      } catch (error) {
        const message = error instanceof Error ? error.message : "FORBIDDEN";
        const statusCode = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
        sendJson(response, statusCode, { error: message });
      }
      return;
    }

    if (method === "GET" && pathname === "/api/v1/admin/settings/image-generation") {
      try {
        await requireAdminAccount(getAuthToken(request));
        const settings = await getImageGenerationSettings();
        sendJson(response, 200, { settings });
      } catch (error) {
        const message = error instanceof Error ? error.message : "FORBIDDEN";
        sendJson(response, message === "UNAUTHORIZED" ? 401 : 500, { error: message });
      }
      return;
    }

    if (method === "PUT" && pathname === "/api/v1/admin/settings/image-generation") {
      let body;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        if (error instanceof Error && error.message === "INVALID_JSON") {
          sendJson(response, 400, { error: "INVALID_JSON" });
          return;
        }
        throw error;
      }

      try {
        await requireAdminAccount(getAuthToken(request));
        const settings = await updateImageGenerationSettings(body ?? {});
        sendJson(response, 200, { ok: true, settings });
      } catch (error) {
        const message = error instanceof Error ? error.message : "UPDATE_FAILED";
        sendJson(response, message === "UNAUTHORIZED" ? 401 : 500, { error: message });
      }
      return;
    }

    if (method === "GET" && pathname === "/api/v1/admin/settings/text-generation") {
      try {
        await requireAdminAccount(getAuthToken(request));
        const settings = await getTextGenerationSettings();
        sendJson(response, 200, { settings });
      } catch (error) {
        const message = error instanceof Error ? error.message : "FORBIDDEN";
        sendJson(response, message === "UNAUTHORIZED" ? 401 : 500, { error: message });
      }
      return;
    }

    if (method === "PUT" && pathname === "/api/v1/admin/settings/text-generation") {
      let body;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        if (error instanceof Error && error.message === "INVALID_JSON") {
          sendJson(response, 400, { error: "INVALID_JSON" });
          return;
        }
        throw error;
      }

      try {
        await requireAdminAccount(getAuthToken(request));
        const settings = await updateTextGenerationSettings(body ?? {});
        sendJson(response, 200, { ok: true, settings });
      } catch (error) {
        const message = error instanceof Error ? error.message : "UPDATE_FAILED";
        sendJson(response, message === "UNAUTHORIZED" ? 401 : 500, { error: message });
      }
      return;
    }

    if (method === "GET" && pathname === "/api/v1/admin/settings/registration-policy") {
      try {
        await requireAdminAccount(getAuthToken(request));
        const settings = await getRegistrationPolicySettings();
        sendJson(response, 200, { settings });
      } catch (error) {
        const message = error instanceof Error ? error.message : "FORBIDDEN";
        sendJson(response, message === "UNAUTHORIZED" ? 401 : 500, { error: message });
      }
      return;
    }

    if (method === "PUT" && pathname === "/api/v1/admin/settings/registration-policy") {
      let body;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        if (error instanceof Error && error.message === "INVALID_JSON") {
          sendJson(response, 400, { error: "INVALID_JSON" });
          return;
        }
        throw error;
      }

      try {
        await requireAdminAccount(getAuthToken(request));
        const settings = await updateRegistrationPolicySettings(body ?? {});
        sendJson(response, 200, { ok: true, settings });
      } catch (error) {
        const message = error instanceof Error ? error.message : "UPDATE_FAILED";
        const endsWithRange = typeof message === "string" && message.endsWith("_OUT_OF_RANGE");
        const statusCode =
          message === "UNAUTHORIZED"
            ? 401
            : endsWithRange
              ? 400
              : 500;
        sendJson(response, statusCode, { error: message });
      }
      return;
    }

    if (method === "GET" && pathname === "/api/v1/admin/settings/quota-free-rolling") {
      try {
        await requireAdminAccount(getAuthToken(request));
        const settings = await getQuotaFreeRollingSettings();
        sendJson(response, 200, { settings });
      } catch (error) {
        const message = error instanceof Error ? error.message : "FORBIDDEN";
        sendJson(response, message === "UNAUTHORIZED" ? 401 : 500, { error: message });
      }
      return;
    }

    if (method === "PUT" && pathname === "/api/v1/admin/settings/quota-free-rolling") {
      let body;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        if (error instanceof Error && error.message === "INVALID_JSON") {
          sendJson(response, 400, { error: "INVALID_JSON" });
          return;
        }
        throw error;
      }

      try {
        await requireAdminAccount(getAuthToken(request));
        const settings = await updateQuotaFreeRollingSettings(body ?? {});
        sendJson(response, 200, { ok: true, settings });
      } catch (error) {
        const message = error instanceof Error ? error.message : "UPDATE_FAILED";
        const endsWithRange = typeof message === "string" && message.endsWith("_OUT_OF_RANGE");
        const statusCode =
          message === "UNAUTHORIZED" ? 401 : endsWithRange ? 400 : 500;
        sendJson(response, statusCode, { error: message });
      }
      return;
    }

    const userMembershipMatch = pathname.match(/^\/api\/v1\/admin\/users\/([^/]+)\/membership$/);
    if (userMembershipMatch) {
      const userId = userMembershipMatch[1];

      if (method === "POST") {
        let body;
        try {
          body = await readJsonBody(request);
        } catch (error) {
          if (error instanceof Error && error.message === "INVALID_JSON") {
            sendJson(response, 400, { error: "INVALID_JSON" });
            return;
          }
          throw error;
        }

        try {
          await requireSuperAdmin(getAuthToken(request));
          const membership = await adminGrantMembership(userId, body?.planCode);
          sendJson(response, 200, { ok: true, membership });
        } catch (error) {
          const message = error instanceof Error ? error.message : "GRANT_FAILED";
          const statusCode =
            message === "UNAUTHORIZED" ? 401 : message === "PLAN_NOT_FOUND" ? 400 : 500;
          sendJson(response, statusCode, { error: message });
        }
        return;
      }

      if (method === "DELETE") {
        try {
          await requireSuperAdmin(getAuthToken(request));
          const result = await adminRevokeMembership(userId);
          sendJson(response, 200, { ok: true, ...result });
        } catch (error) {
          const message = error instanceof Error ? error.message : "REVOKE_FAILED";
          sendJson(response, message === "UNAUTHORIZED" ? 401 : 500, { error: message });
        }
        return;
      }
    }

    const userStatusMatch = pathname.match(/^\/api\/v1\/admin\/users\/([^/]+)\/status$/);
    if (userStatusMatch && method === "PATCH") {
      const userId = userStatusMatch[1];
      let body;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        if (error instanceof Error && error.message === "INVALID_JSON") {
          sendJson(response, 400, { error: "INVALID_JSON" });
          return;
        }
        throw error;
      }

      try {
        await requireSuperAdmin(getAuthToken(request));

        const result = await adminSetUserStatus(userId, body?.status);
        sendJson(response, 200, { ok: true, user: result.user });
      } catch (error) {
        const message = error instanceof Error ? error.message : "UPDATE_FAILED";
        const statusCode =
          message === "UNAUTHORIZED" ? 401 : message === "INVALID_STATUS" ? 400 : 500;
        sendJson(response, statusCode, { error: message });
      }
      return;
    }

    // ===== Admin Overview =====
    if (method === "GET" && pathname === "/api/v1/admin/overview") {
      try {
        const auth = await requireAdminAccount(getAuthToken(request));

        if (auth.admin.role === "agent") {
          const agent = await getAgentByUserId(auth.admin.id);
          if (!agent) {
            sendJson(response, 403, { error: "AGENT_RECORD_NOT_FOUND" });
            return;
          }

          const userCount = await prisma.user.count({ where: { agentId: agent.id } });
          const orderCount = await prisma.order.count({
            where: { user: { agentId: agent.id }, status: "paid" },
          });

          sendJson(response, 200, {
            role: "agent",
            inviteCode: agent.inviteCode,
            contactWechat: agent.contactWechat ?? "",
            stats: {
              userCount,
              orderCount,
            },
          });
        } else {
          // 超管概览
          const userCount = await prisma.user.count();
          const orderCount = await prisma.order.count({ where: { status: "paid" } });
          const agentCount = await prisma.agent.count();

          sendJson(response, 200, {
            role: "super_admin",
            stats: {
              userCount,
              orderCount,
              agentCount,
            },
          });
        }
      } catch (error) {
        console.error("[server.js] Overview fetch error:", error);
        const message = error instanceof Error ? error.message : "FETCH_OVERVIEW_FAILED";
        sendJson(response, message === "UNAUTHORIZED" ? 401 : 500, { error: message });
      }
      return;
    }

    if (method === "PATCH" && pathname === "/api/v1/admin/overview") {
      try {
        const auth = await requireAdminAccount(getAuthToken(request));
        if (auth.admin.role !== "agent") {
          sendJson(response, 403, { error: "FORBIDDEN" });
          return;
        }

        const agent = await getAgentByUserId(auth.admin.id);
        if (!agent) {
          sendJson(response, 403, { error: "AGENT_RECORD_NOT_FOUND" });
          return;
        }

        const body = await readJsonBody(request);
        const updated = await updateAgent(agent.id, { contactWechat: body?.contactWechat });
        sendJson(response, 200, { contactWechat: updated.contactWechat ?? "" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "UPDATE_AGENT_PROFILE_FAILED";
        sendJson(response, message === "UNAUTHORIZED" ? 401 : 400, { error: message });
      }
      return;
    }

    // ===== Admin Agent Management =====
    if (method === "GET" && pathname === "/api/v1/admin/agents") {
      try {
        await requireSuperAdmin(getAuthToken(request));
        const agents = await listAgentsWithStats();
        sendJson(response, 200, { agents });
      } catch (error) {
        const message = error instanceof Error ? error.message : "FETCH_AGENTS_FAILED";
        sendJson(response, message === "UNAUTHORIZED" ? 401 : 403, { error: message });
      }
      return;
    }

    if (method === "POST" && pathname === "/api/v1/admin/agents") {
      try {
        await requireSuperAdmin(getAuthToken(request));
        const body = await readJsonBody(request);
        console.log("[server.js] DEBUG - Parsed Body:", body);
        
        const agent = await createAgent({ 
          name: body.name, 
          email: body.email, 
          password: body.password,
          contactWechat: body.contactWechat,
        });
        sendJson(response, 200, agent);
      } catch (error) {
        console.error("[server.js] Agent creation error:", error);
        const message = error instanceof Error ? error.message : "CREATE_AGENT_FAILED";
        sendJson(response, 400, { error: message });
      }
      return;
    }

    if (method === "PATCH" && pathname.startsWith("/api/v1/admin/plans/")) {
      try {
        await requireSuperAdmin(getAuthToken(request));
        const planId = pathname.split("/").filter(Boolean).pop();
        const body = await readJsonBody(request);
        console.log(`[server.js] Updating plan with ID/Code: "${planId}"`, body);

        // 先尝试按 ID 找，找不到按 Code 找
        let plan = await prisma.plan.findUnique({ where: { id: planId } });
        if (!plan) {
          plan = await prisma.plan.findUnique({ where: { code: planId } });
        }

        if (!plan) {
          throw new Error(`PLAN_NOT_FOUND: ${planId}`);
        }

        const updated = await prisma.plan.update({
          where: { id: plan.id },
          data: {
            name: body.name,
            priceCents: body.priceCents,
            isActive: body.isActive,
            textDailyLimit:
              body.textMonthlyLimit !== undefined
                ? Math.max(0, Math.round(Number(body.textMonthlyLimit || 0) / 30))
                : body.textDailyLimit,
            textMonthlyLimit:
              body.textMonthlyLimit !== undefined
                ? Math.max(0, Math.round(Number(body.textMonthlyLimit || 0)))
                : undefined,
            imageMonthlyLimit: body.imageMonthlyLimit,
            wechatAccountLimit: body.wechatAccountLimit,
            tagline: body.tagline,
            featuresJson: Array.isArray(body.features) ? JSON.stringify(body.features) : undefined,
          },
        });

        sendJson(response, 200, { ok: true, plan: updated });
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }
      return;
    }

    if (method === "PATCH" && pathname.startsWith("/api/v1/admin/agents/")) {
      try {
        await requireSuperAdmin(getAuthToken(request));
        const agentId = pathname.split("/").pop();
        const body = await readJsonBody(request);
        const agent = await updateAgent(agentId, {
          name: body?.name,
          status: body?.status,
          contactWechat: body?.contactWechat,
        });
        sendJson(response, 200, agent);
      } catch (error) {
        const message = error instanceof Error ? error.message : "UPDATE_AGENT_FAILED";
        sendJson(response, 400, { error: message });
      }
      return;
    }

    if (method === "DELETE" && pathname.startsWith("/api/v1/admin/agents/")) {
      try {
        await requireSuperAdmin(getAuthToken(request));
        const agentId = pathname.split("/").pop();
        await prisma.agent.delete({ where: { id: agentId } });
        sendJson(response, 200, { ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : "DELETE_AGENT_FAILED";
        sendJson(response, 400, { error: message });
      }
      return;
    }

    if (method === "GET" && pathname === "/api/v1/agent/my-users") {
      try {
        const auth = await requireUser(getAuthToken(request));
        const agent = await getAgentByUserId(auth.user.id);
        
        if (!agent) {
          sendJson(response, 403, { error: "NOT_AN_AGENT" });
          return;
        }

        const users = await listUsersWithMemberships({ agentId: agent.id });
        sendJson(response, 200, { users });
      } catch (error) {
        const message = error instanceof Error ? error.message : "FETCH_USERS_FAILED";
        sendJson(response, message === "UNAUTHORIZED" ? 401 : 500, { error: message });
      }
      return;
    }

    // Serve public static files — 官网入口 (no auth required)
    if (method === "GET" && !pathname.startsWith("/api")) {
      const relativePath =
        pathname === "/"
          ? "index.html"
          : pathname.replace(/^\//, "");
      const filePath = path.join(PUBLIC_DIR, relativePath);

      // 安全校验：确保文件确实在公共目录内
      const resolvedPublicDir = path.resolve(PUBLIC_DIR);
      const resolvedFilePath = path.resolve(filePath);

      if (resolvedFilePath.startsWith(resolvedPublicDir) && serveStatic(response, resolvedFilePath)) {
        return;
      }
    }

    sendJson(response, 404, { error: "NOT_FOUND" });
  } catch (error) {
    sendJson(response, 500, {
      error: "INTERNAL_SERVER_ERROR",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(PORT, () => {
  const localIps = getLocalIpv4Addresses();
  console.log(`node-backend listening on http://localhost:${PORT}`);
  if (localIps.length) {
    console.log(`[node-backend] local IPv4: ${localIps.join(", ")}`);
    for (const ip of localIps) {
      console.log(`[node-backend] LAN URL: http://${ip}:${PORT}`);
    }
  } else {
    console.log("[node-backend] local IPv4: not detected");
  }

  void getPublicIpAddress()
    .then((publicIp) => {
      if (publicIp) {
        console.log(`[node-backend] public egress IP: ${publicIp}`);
      } else {
        console.log("[node-backend] public egress IP: unavailable");
      }
    })
    .catch(() => {
      console.log("[node-backend] public egress IP: unavailable");
    });
});
