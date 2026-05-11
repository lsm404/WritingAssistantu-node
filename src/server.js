import "dotenv/config";
import http from "node:http";
import { URL } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDatabaseSetup, getDatabaseUrl } from "./prisma.js";
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
import { createAgent, ensureBootstrapAgentIfEmpty, getAgentByUserId, listAgentsWithStats, setAgentStatus } from "./agent-service.js";
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
    let raw = "";

    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error("BODY_TOO_LARGE"));
        request.destroy();
      }
    });

    request.on("end", () => {
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
    "Content-Type, Authorization, X-Requested-With, Accept, Origin, X-Device-Id",
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
        await assertUserQuotaAvailable(auth.user.id, membership, "image", Number(body?.n || 1));
        const result = await generateImageContent(body ?? {});
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

    if (method === "GET" && pathname === "/api/v1/plans") {
      sendJson(response, 200, {
        plans: await listPlans(),
      });
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
          user: auth.user,
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
        await requireAdminAccount(getAuthToken(request));
        const inviteCode = requestUrl.searchParams.get("inviteCode") || "";
        const agentId = requestUrl.searchParams.get("agentId") || "";
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

    if (method === "GET" && pathname === "/api/v1/admin/agents") {
      try {
        await requireSuperAdmin(getAuthToken(request));
        sendJson(response, 200, { agents: await listAgentsWithStats() });
      } catch (error) {
        const message = error instanceof Error ? error.message : "FORBIDDEN";
        const statusCode = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
        sendJson(response, statusCode, { error: message });
      }
      return;
    }

    if (method === "POST" && pathname === "/api/v1/admin/agents") {
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
        const row = await createAgent({ name: body?.name });
        sendJson(response, 201, {
          ok: true,
          agent: {
            id: row.id,
            name: row.name,
            inviteCode: row.inviteCode,
            status: row.status,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "CREATE_AGENT_FAILED";
        const statusCode =
          message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : message === "INVALID_AGENT_NAME" ? 400 : 500;
        sendJson(response, statusCode, { error: message });
      }
      return;
    }

    const agentStatusMatch = pathname.match(/^\/api\/v1\/admin\/agents\/([^/]+)\/status$/);

    if (method === "PATCH" && agentStatusMatch) {
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
        const agentId = agentStatusMatch[1];
        await setAgentStatus(agentId, String(body?.status ?? ""));
        sendJson(response, 200, { ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : "UPDATE_AGENT_FAILED";
        const statusCode =
          message === "UNAUTHORIZED"
            ? 401
            : message === "FORBIDDEN"
              ? 403
              : message === "INVALID_AGENT_STATUS"
                ? 400
                : 500;
        sendJson(response, statusCode, { error: message });
      }
      return;
    }

    if (method === "GET" && pathname === "/api/v1/admin/orders") {
      try {
        await requireAdminAccount(getAuthToken(request));
        sendJson(response, 200, { orders: await listAllOrders() });
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
          await requireAdminAccount(getAuthToken(request));
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
          await requireAdminAccount(getAuthToken(request));
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
        await requireAdminAccount(getAuthToken(request));
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
        const agent = await createAgent({ name: body?.name });
        sendJson(response, 200, agent);
      } catch (error) {
        const message = error instanceof Error ? error.message : "CREATE_AGENT_FAILED";
        sendJson(response, 400, { error: message });
      }
      return;
    }

    if (method === "PATCH" && pathname.startsWith("/api/v1/admin/agents/")) {
      try {
        await requireSuperAdmin(getAuthToken(request));
        const agentId = pathname.split("/").pop();
        const body = await readJsonBody(request);
        const agent = await setAgentStatus(agentId, body?.status);
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
      const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
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
  console.log(`node-backend listening on http://localhost:${PORT}`);
});
