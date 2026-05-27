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
  adminDeleteUser,
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
  createPlan,
  deletePlan,
  getMembershipSummary,
  listAllOrders,
  listMembershipGrantLogs,
  listPlans,
  listUsersWithMemberships,
  listUsersWithMembershipsPage,
  purchasePlan,
  recordArticleGenerationLog,
  resolvePlanDurationDaysByName,
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
const WECHAT_COVER_MAX_BYTES = 5 * 1024 * 1024;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const GEMINI_MODEL_CONNECTING_MESSAGE = "Gemini模型连接中，稍后再试.......";

const ERROR_MESSAGE_MAP = {
  INVALID_JSON: "请求数据格式不正确",
  BODY_TOO_LARGE: "请求内容过大",
  INVALID_COUNT: "数量参数不正确",
  SYNC_OPENCLAW_FAILED: "同步授权码失败，请稍后再试",
  UNAUTHORIZED: "登录已过期，请重新登录",
  FORBIDDEN: "没有权限执行该操作",
  NOT_FOUND: "接口不存在",
  INTERNAL_SERVER_ERROR: "服务器异常，请稍后再试",
  INVALID_EMAIL: "邮箱格式不正确",
  PASSWORD_TOO_SHORT: "密码长度不能少于 6 位",
  INVALID_DISPLAY_NAME: "昵称不能为空",
  EMAIL_ALREADY_EXISTS: "该邮箱已注册",
  INVALID_CREDENTIALS: "账号或密码错误",
  USER_DISABLED: "账号已停用",
  USER_NOT_FOUND: "用户不存在",
  ADMIN_DISABLED: "管理员账号已停用",
  INVALID_STATUS: "状态参数不正确",
  LOGIN_FAILED: "登录失败，请稍后再试",
  REGISTER_FAILED: "注册失败，请稍后再试",
  REGISTRATION_IP_REQUIRED: "未获取到真实注册 IP，请检查反向代理配置",
  REGISTRATION_IP_LIMIT: "当前 IP 注册次数过多，请稍后再试",
  REGISTRATION_SUBNET_LIMIT: "当前网络注册次数过多，请稍后再试",
  REGISTRATION_DEVICE_LIMIT: "当前设备注册次数过多，请稍后再试",
  INVALID_INVITE_CODE: "激活码格式不正确",
  INVITE_CODE_NOT_FOUND: "激活码不存在",
  AGENT_DISABLED: "该激活码暂不可用",
  INVITE_CODE_GENERATION_FAILED: "激活码生成失败，请稍后再试",
  INVALID_AGENT_NAME: "代理名称不能为空",
  INVALID_AGENT_STATUS: "代理状态不正确",
  AGENT_RECORD_NOT_FOUND: "代理记录不存在",
  AGENT_GRANT_MEMBERSHIP_DISABLED: "该代理未开启开通会员权限",
  NOT_AN_AGENT: "当前账号不是代理账号",
  FETCH_AGENTS_FAILED: "获取代理列表失败",
  CREATE_AGENT_FAILED: "创建代理失败",
  UPDATE_AGENT_FAILED: "更新代理失败",
  DELETE_AGENT_FAILED: "删除代理失败",
  UPDATE_AGENT_PROFILE_FAILED: "更新代理资料失败",
  FETCH_USERS_FAILED: "获取用户列表失败",
  FETCH_OPERATION_LOGS_FAILED: "获取操作日志失败",
  FETCH_OVERVIEW_FAILED: "获取概览数据失败",
  NAME_AND_CONTENT_REQUIRED: "提示词名称和内容不能为空",
  PROMPT_NOT_FOUND: "提示词不存在",
  NO_VALID_UPDATES: "没有可更新的内容",
  INVALID_BODY: "请求内容不正确",
  ACCOUNTS_REQUIRED: "公众号账号列表不能为空",
  ACCOUNT_NAME_AND_ID_REQUIRED: "公众号账号名称和 AppID 不能为空",
  APP_SECRET_PLAINTEXT_FORBIDDEN: "AppSecret 必须加密传输",
  APP_SECRET_CIPHER_INVALID: "AppSecret 密文格式不正确",
  APP_SECRET_DECRYPT_FAILED: "AppSecret 解密失败",
  TEXT_QUOTA_EXCEEDED: "今日文章生成额度已用完，请开通或升级会员",
  IMAGE_QUOTA_EXCEEDED: "图片生成额度已用完，请开通或升级会员",
  DE_AI_QUOTA_EXCEEDED: "去 AI 化额度已用完，请开通或升级会员",
  INVALID_QUOTA_KIND: "额度类型不正确",
  INVALID_QUOTA_AMOUNT: "额度数量不正确",
  PLAN_NOT_FOUND: "套餐不存在",
  PLAN_CODE_REQUIRED: "套餐编码不能为空",
  PLAN_CODE_EXISTS: "套餐编码已存在",
  PLAN_IN_USE: "该套餐已有订单或会员记录，不能删除",
  LIFETIME_ALREADY_ACTIVE: "终身会员已生效，无需重复开通",
  CHECKOUT_FAILED: "创建订单失败，请稍后再试",
  CREATE_PLAN_FAILED: "创建套餐失败",
  UPDATE_PLAN_FAILED: "更新套餐失败",
  DELETE_PLAN_FAILED: "删除套餐失败",
  GRANT_FAILED: "开通会员失败",
  REVOKE_FAILED: "关闭会员失败",
  UPDATE_FAILED: "保存失败，请稍后再试",
  ARK_API_KEY_MISSING: "文本生成 API Key 未配置",
  ARK_MODEL_MISSING: "文本生成模型未配置",
  ARK_DEEPSEEK_API_KEY_MISSING: "DeepSeek API Key 未配置",
  ARK_DEEPSEEK_MODEL_MISSING: "DeepSeek 模型未配置",
  ARK_KIMI_API_KEY_MISSING: "Kimi API Key 未配置",
  ARK_KIMI_MODEL_MISSING: "Kimi 模型未配置",
  MIMO_API_KEY_MISSING: "小米 MiMo API Key 未配置",
  MIMO_MODEL_MISSING: "小米 MiMo 模型未配置",
  ARK_IMAGE_API_KEY_MISSING: "图片生成 API Key 未配置",
  ARK_IMAGE_MODEL_MISSING: "图片生成模型未配置",
  TOPIC_REQUIRED: "请先填写文章主题",
  SOURCE_ARTICLE_REQUIRED: "参考改写模式下，请先填写参考文章",
  PROMPT_REQUIRED: "请先填写图片描述",
  ARTICLE_GENERATE_FAILED: GEMINI_MODEL_CONNECTING_MESSAGE,
  IMAGE_GENERATE_FAILED: GEMINI_MODEL_CONNECTING_MESSAGE,
  ARTICLE_EMPTY: GEMINI_MODEL_CONNECTING_MESSAGE,
  GEMINI_MODEL_CONNECTING: GEMINI_MODEL_CONNECTING_MESSAGE,
  IMAGE_GENERATION_NOT_ALLOWED_FOR_BASIC_PLAN: "当前套餐不支持图片生成",
  FILE_REQUIRED: "请上传文件",
  WECHAT_THUMB_TOO_LARGE: "封面图大小不能超过 5MB",
  WECHAT_APPID_MISSING: "请先填写公众号 AppID",
  WECHAT_APPSECRET_MISSING: "请先填写公众号 AppSecret",
  WECHAT_THUMB_MEDIA_ID_MISSING: "请先上传封面图或填写 thumb_media_id",
  TITLE_REQUIRED: "请先补充文章标题",
  CONTENT_REQUIRED: "请先生成文章内容",
  WECHAT_TOKEN_FAILED: "获取微信访问凭证失败，请检查公众号配置",
  WECHAT_UPLOAD_FAILED: "上传微信素材失败，请稍后再试",
  WECHAT_DRAFT_FAILED: "发送到微信草稿箱失败，请稍后再试",
  WECHAT_ARTICLE_IMAGE_FETCH_FAILED: "获取文章图片失败，请检查图片链接",
  WECHAT_ARTICLE_IMAGE_INVALID_CONTENT_TYPE: "文章图片格式不支持",
  WECHAT_ARTICLE_IMAGE_UPLOAD_FAILED: "上传文章图片到微信失败",
  UPSTREAM_INVALID_JSON: "上游服务返回异常，请稍后再试",
  UPSTREAM_UNREACHABLE: "后端服务暂不可用，请稍后再试",
  DATABASE_URL_MISSING: "数据库连接未配置",
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".zip": "application/zip",
  ".msi": "application/x-msi",
  ".exe": "application/vnd.microsoft.portable-executable",
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
  const body = normalizeResponsePayload(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function normalizeResponsePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const normalized = { ...payload };
  const hasError = Object.prototype.hasOwnProperty.call(normalized, "error");
  if (hasError) {
    const originalCode = String(normalized.error || "INTERNAL_SERVER_ERROR");
    normalized.error = getChineseErrorMessage(originalCode);
  }

  if (hasError && Object.prototype.hasOwnProperty.call(normalized, "message")) {
    const originalMessage = String(normalized.message || "");
    normalized.message = getChineseErrorMessage(originalMessage);
  }

  return normalized;
}

function getChineseErrorMessage(rawCode) {
  const code = String(rawCode || "INTERNAL_SERVER_ERROR").trim();
  if (!code) {
    return ERROR_MESSAGE_MAP.INTERNAL_SERVER_ERROR;
  }

  if (isGeminiModelErrorCode(code)) {
    return GEMINI_MODEL_CONNECTING_MESSAGE;
  }

  if (code.startsWith("AI_UPSTREAM_ERROR|")) {
    const [, status = "", upstreamCode = "", upstreamMessage = ""] = code.split("|");
    const suffix = upstreamCode ? `（${upstreamCode}${status ? `/${status}` : ""}）` : "";
    if (upstreamCode === "InvalidEndpointOrModel.NotFound") {
      return `AI 接口调用失败：模型或接入点不存在，或当前 API Key 没有权限。请在后台填写火山方舟控制台实际可调用的接入点 ID/模型名，并确认 Key 属于同一项目${suffix}`;
    }
    return `AI 接口调用失败：${upstreamMessage || "上游服务返回异常"}${suffix}`;
  }

  if (code.startsWith("AI_UPSTREAM_INVALID_JSON|")) {
    return "AI 接口返回格式异常，请检查模型接口地址和模型名称";
  }

  if (code.startsWith("PLAN_WECHAT_LIMIT_EXCEEDED:")) {
    const limit = code.split(":")[1] || "1";
    return `当前套餐最多可绑定 ${limit} 个公众号`;
  }

  if (code.startsWith("PLAN_NOT_FOUND:")) {
    return ERROR_MESSAGE_MAP.PLAN_NOT_FOUND;
  }

  if (code.endsWith("_OUT_OF_RANGE")) {
    return "配置数值超出允许范围";
  }

  const prefix = code.split(":")[0];
  return ERROR_MESSAGE_MAP[code] || ERROR_MESSAGE_MAP[prefix] || "操作失败，请稍后再试";
}

async function requireMembershipGrantPermission(token, userId) {
  const auth = await requireAdminAccount(token);
  if (auth.admin.role === "super_admin") {
    return auth;
  }

  if (auth.admin.role !== "agent") {
    throw new Error("FORBIDDEN");
  }

  const agent = await getAgentByUserId(auth.admin.id);
  if (!agent) {
    throw new Error("AGENT_RECORD_NOT_FOUND");
  }
  if (agent.status !== "active") {
    throw new Error("AGENT_DISABLED");
  }
  if (!agent.canGrantMembership) {
    throw new Error("AGENT_GRANT_MEMBERSHIP_DISABLED");
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: String(userId) },
    select: { id: true, agentId: true },
  });
  if (!targetUser) {
    throw new Error("USER_NOT_FOUND");
  }
  if (targetUser.agentId !== agent.id) {
    throw new Error("FORBIDDEN");
  }

  return { ...auth, agent };
}

function isGeminiModelErrorCode(code) {
  return [
    "ARTICLE_GENERATE_FAILED",
    "IMAGE_GENERATE_FAILED",
    "ARTICLE_EMPTY",
    "GEMINI_MODEL_CONNECTING",
  ].includes(code);
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
        const quotaKind = body?.regenerate_for_de_ai ? "de_ai" : "text";
        await assertUserQuotaAvailable(auth.user.id, membership, quotaKind, 1);
        const result = await generateArticleContent(body ?? {}, auth.user.id);
        const quota = await consumeUserQuota(auth.user.id, membership, quotaKind, 1);
        await recordArticleGenerationLog(auth.user.id, body ?? {}, result, quotaKind);
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
              message === "ARK_DEEPSEEK_API_KEY_MISSING" ||
              message === "ARK_DEEPSEEK_MODEL_MISSING" ||
              message === "ARK_KIMI_API_KEY_MISSING" ||
              message === "ARK_KIMI_MODEL_MISSING" ||
              message === "MIMO_API_KEY_MISSING" ||
              message === "MIMO_MODEL_MISSING" ||
              message === "TEXT_QUOTA_EXCEEDED" ||
              message === "DE_AI_QUOTA_EXCEEDED"
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
        if (file.size > WECHAT_COVER_MAX_BYTES) {
          sendJson(response, 413, { error: "WECHAT_THUMB_TOO_LARGE" });
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
              message === "APP_SECRET_CIPHER_INVALID" ||
              message === "APP_SECRET_BASE64_INVALID"
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
        if (!ip) {
          throw new Error("REGISTRATION_IP_REQUIRED");
        }
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
            message === "AGENT_DISABLED" ||
            message === "REGISTRATION_IP_REQUIRED"
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

        const page = requestUrl.searchParams.get("page") || "1";
        const pageSize = requestUrl.searchParams.get("pageSize") || "10";
        const search = requestUrl.searchParams.get("search") || "";
        const sort = requestUrl.searchParams.get("sort") || "";
        sendJson(
          response,
          200,
          await listUsersWithMembershipsPage({
            inviteCode,
            agentId,
            search,
            page,
            pageSize,
            sort,
            includeSuperAdminFields: auth.admin.role === "super_admin",
          }),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "FORBIDDEN";
        const statusCode = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
        sendJson(response, statusCode, { error: message });
      }
      return;
    }

    if (method === "GET" && pathname === "/api/v1/admin/memberships") {
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

        const page = requestUrl.searchParams.get("page") || "1";
        const pageSize = requestUrl.searchParams.get("pageSize") || "10";
        const search = requestUrl.searchParams.get("search") || "";
        const sort = requestUrl.searchParams.get("sort") || "";
        sendJson(
          response,
          200,
          await listUsersWithMembershipsPage({
            inviteCode,
            agentId,
            search,
            page,
            pageSize,
            sort,
            membershipOnly: true,
            includeSuperAdminFields: auth.admin.role === "super_admin",
          }),
        );
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

    if (method === "GET" && pathname === "/api/v1/admin/operation-logs") {
      try {
        await requireSuperAdmin(getAuthToken(request));
        const page = requestUrl.searchParams.get("page") || "1";
        const pageSize = requestUrl.searchParams.get("pageSize") || "20";
        const search = requestUrl.searchParams.get("search") || "";
        sendJson(response, 200, await listMembershipGrantLogs({ page, pageSize, search }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "FETCH_OPERATION_LOGS_FAILED";
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
          const grantAuth = await requireMembershipGrantPermission(getAuthToken(request), userId);
          const membership = await adminGrantMembership(userId, body?.planCode, grantAuth.admin);
          sendJson(response, 200, { ok: true, membership });
        } catch (error) {
          const message = error instanceof Error ? error.message : "GRANT_FAILED";
          const statusCode =
            message === "UNAUTHORIZED"
              ? 401
              : message === "FORBIDDEN" ||
                message === "AGENT_RECORD_NOT_FOUND" ||
                message === "AGENT_DISABLED" ||
                message === "AGENT_GRANT_MEMBERSHIP_DISABLED"
                ? 403
                : message === "PLAN_NOT_FOUND"
                  ? 400
                  : message === "USER_NOT_FOUND"
                    ? 404
                    : 500;
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
          const statusCode = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
          sendJson(response, statusCode, { error: message });
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
          message === "UNAUTHORIZED"
            ? 401
            : message === "FORBIDDEN"
              ? 403
              : message === "INVALID_STATUS"
                ? 400
                : 500;
        sendJson(response, statusCode, { error: message });
      }
      return;
    }

    const userDeleteMatch = pathname.match(/^\/api\/v1\/admin\/users\/([^/]+)$/);
    if (userDeleteMatch && method === "DELETE") {
      const userId = userDeleteMatch[1];

      try {
        await requireSuperAdmin(getAuthToken(request));
        const result = await adminDeleteUser(userId);
        sendJson(response, 200, { ok: true, ...result });
      } catch (error) {
        const message = error instanceof Error ? error.message : "DELETE_FAILED";
        const statusCode =
          message === "UNAUTHORIZED"
            ? 401
            : message === "FORBIDDEN" || message === "USER_DELETE_FORBIDDEN"
              ? 403
              : message === "USER_NOT_FOUND"
                ? 404
                : 500;
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
            canGrantMembership: Boolean(agent.canGrantMembership),
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
          canGrantMembership: body.canGrantMembership,
        });
        sendJson(response, 200, agent);
      } catch (error) {
        console.error("[server.js] Agent creation error:", error);
        const message = error instanceof Error ? error.message : "CREATE_AGENT_FAILED";
        sendJson(response, 400, { error: message });
      }
      return;
    }

    if (method === "POST" && pathname === "/api/v1/admin/plans") {
      try {
        await requireSuperAdmin(getAuthToken(request));
        const body = await readJsonBody(request);
        const plan = await createPlan(body ?? {});
        sendJson(response, 200, { ok: true, plan });
      } catch (error) {
        const message = error instanceof Error ? error.message : "CREATE_PLAN_FAILED";
        const statusCode =
          message === "UNAUTHORIZED"
            ? 401
            : message === "PLAN_CODE_REQUIRED" || message === "PLAN_CODE_EXISTS"
              ? 400
              : 500;
        sendJson(response, statusCode, { error: message });
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

        const durationDays = resolvePlanDurationDaysByName(
          body.name ?? plan.name,
          body.durationDays ?? plan.durationDays ?? 30,
        );

        const updated = await prisma.plan.update({
          where: { id: plan.id },
          data: {
            name: body.name,
            priceCents: body.priceCents,
            durationDays,
            isActive: body.isActive,
            textDailyLimit:
              body.textMonthlyLimit !== undefined
                ? Math.max(0, Math.round(Number(body.textMonthlyLimit || 0) / 30))
                : body.textDailyLimit,
            textMonthlyLimit:
              body.textMonthlyLimit !== undefined
                ? Math.max(0, Math.round(Number(body.textMonthlyLimit || 0)))
                : undefined,
            imageMonthlyLimit:
              body.planCategory === "text_only"
                ? 0
                : body.imageMonthlyLimit,
            deAiMonthlyLimit: body.deAiMonthlyLimit,
            wechatAccountLimit: body.wechatAccountLimit,
            tagline: body.tagline,
            featuresJson: Array.isArray(body.features) ? JSON.stringify(body.features) : undefined,
          },
        });
        const planCategory =
          body.planCategory === "text_only" || body.planCategory === "text_image"
            ? body.planCategory
            : undefined;
        if (planCategory) {
          await prisma.$executeRawUnsafe(
            `UPDATE plans SET plan_category = $2 WHERE id = $1`,
            plan.id,
            planCategory,
          );
        }

        sendJson(response, 200, { ok: true, plan: planCategory ? { ...updated, planCategory } : updated });
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }
      return;
    }

    if (method === "DELETE" && pathname.startsWith("/api/v1/admin/plans/")) {
      try {
        await requireSuperAdmin(getAuthToken(request));
        const planId = pathname.split("/").filter(Boolean).pop();
        const result = await deletePlan(planId);
        sendJson(response, 200, { ok: true, ...result });
      } catch (error) {
        const message = error instanceof Error ? error.message : "DELETE_PLAN_FAILED";
        const statusCode =
          message === "UNAUTHORIZED"
            ? 401
            : message === "PLAN_NOT_FOUND" || message === "PLAN_IN_USE"
              ? 400
              : 500;
        sendJson(response, statusCode, { error: message });
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
          canGrantMembership: body?.canGrantMembership,
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

        const users = await listUsersWithMemberships({ agentId: agent.id, includeSuperAdminFields: false });
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
