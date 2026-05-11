import { getUserModelConfig } from "./auth-service.js";
import { getImageGenerationSettings, getTextGenerationSettings } from "./system-settings-service.js";

const DEFAULT_ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_WECHAT_BASE_URL = "https://api.weixin.qq.com";


const tokenCache = {
  token: "",
  expireAt: 0,
  appId: "",
  appSecret: "",
};

function getRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name}_MISSING`);
  }
  return value;
}

function getBooleanEnv(name, fallback = false) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value);
}

/** 本地调试：打印发往 Ark 的参数（密钥仅打码，不落盘完整 key） */
function maskSecret(value) {
  if (!value || typeof value !== "string") {
    return value ? "(set)" : "(empty)";
  }
  if (value.length <= 8) {
    return "***";
  }
  return `${value.slice(0, 4)}…${value.slice(-2)} (len=${value.length})`;
}

function logOutgoingAiCall(kind, details) {
  const tag = `[node-backend][AI ${kind}]`;
  console.log(`${tag} ${new Date().toISOString()}`);
  console.log(JSON.stringify(details, null, 2));
}

async function getGenerationConfig(payload, userId = null) {
  const systemText = await getTextGenerationSettings();
  const userCfg = userId ? await getUserModelConfig(userId) : null;

  /** API Key：用户自带优先；模型：后台「文本生成」全局配置优先于用户 model_configs，避免后台已升 2.0 仍被旧用户表或仅 env 覆盖 */
  const apiKey =
    (userCfg?.textApiKey && String(userCfg.textApiKey).trim()) ||
    systemText.apiKey ||
    process.env.ARK_API_KEY?.trim() ||
    "";
  const model =
    (systemText.model && String(systemText.model).trim()) ||
    (userCfg?.textModel && String(userCfg.textModel).trim()) ||
    process.env.ARK_MODEL?.trim() ||
    "";
  const baseUrl = systemText.baseUrl || process.env.ARK_BASE_URL?.trim() || DEFAULT_ARK_BASE_URL;
  const enableWebSearch =
    typeof payload.enable_web_search === "boolean"
      ? payload.enable_web_search
      : systemText.enableWebSearch ?? getBooleanEnv("ARK_ENABLE_WEB_SEARCH", false);

  if (!apiKey) {
    throw new Error("ARK_API_KEY_MISSING");
  }

  if (!model) {
    throw new Error("ARK_MODEL_MISSING");
  }

  return {
    apiKey,
    model,
    baseUrl,
    enableWebSearch,
    reasoningEffort: systemText.reasoningEffort || "medium",
  };
}

async function getImageGenerationConfig() {
  const settings = await getImageGenerationSettings();
  const apiKey = settings.apiKey;
  const model = settings.model;
  const baseUrl = settings.baseUrl;

  if (!apiKey) {
    throw new Error("ARK_IMAGE_API_KEY_MISSING");
  }

  if (!model) {
    throw new Error("ARK_IMAGE_MODEL_MISSING");
  }

  return {
    apiKey,
    model,
    baseUrl,
  };
}

function getWechatConfig(payload) {
  const appId = payload.wechat_appid?.trim() || process.env.WECHAT_APPID?.trim() || "";
  const appSecret = payload.wechat_appsecret?.trim() || process.env.WECHAT_APPSECRET?.trim() || "";
  const baseUrl = payload.wechat_base_url?.trim() || process.env.WECHAT_BASE_URL?.trim() || DEFAULT_WECHAT_BASE_URL;
  const thumbMediaId =
    payload.wechat_thumb_media_id?.trim() || process.env.WECHAT_THUMB_MEDIA_ID?.trim() || "";

  if (!appId) {
    throw new Error("WECHAT_APPID_MISSING");
  }

  if (!appSecret) {
    throw new Error("WECHAT_APPSECRET_MISSING");
  }

  return {
    appId,
    appSecret,
    baseUrl,
    thumbMediaId,
  };
}


function buildArkRequestBody(payload, config) {
  const systemText = payload.system_prompt || "";
  const userText = payload.user_prompt || "";

  // Ark Responses API: instructions = system role, input = user message
  const jsonPayload = {
    model: config.model,
    instructions: systemText,
    temperature: 1.6,
    input: userText,
    ...(config.enableWebSearch ? { tools: [{ type: "web_search" }] } : {}),
  };

  if (["high", "medium", "low", "minimal"].includes(config.reasoningEffort)) {
    jsonPayload.reasoning = {
      effort: config.reasoningEffort,
    };
  }

  return jsonPayload;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`UPSTREAM_INVALID_JSON:${text.slice(0, 240)}`);
  }
}

function extractArticleMarkdown(data) {
  const messageOutput = data.output?.find((item) => item.type === "message") ?? data.output?.[0];
  const articleMd =
    messageOutput?.content
      ?.filter((item) => ["output_text", "text"].includes(item.type || ""))
      .map((item) => item.text || "")
      .join("") ||
    data.output_text ||
    "";

  return articleMd.trim();
}

export async function generateArticleContent(payload, userId = null) {
  if (!payload.user_prompt?.trim()) {
    throw new Error("USER_PROMPT_REQUIRED");
  }

  const config = await getGenerationConfig(payload, userId);
  const requestUrl = `${config.baseUrl.replace(/\/$/, "")}/responses`;
  const requestBody = buildArkRequestBody(payload, config);

  logOutgoingAiCall("text/responses", {
    url: requestUrl,
    authorizationBearer: maskSecret(config.apiKey),
    requestBody,
    clientPayloadSummary: {
      length: payload.length,
      mode: payload.mode,
      creation_mode: payload.creation_mode,
      enable_web_search: payload.enable_web_search,
    },
  });

  const response = await fetch(requestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(data.error?.message || data.error?.code || data.message || "ARTICLE_GENERATE_FAILED");
  }

  const articleMd = extractArticleMarkdown(data);
  if (!articleMd) {
    throw new Error("ARTICLE_EMPTY");
  }

  return {
    ok: true,
    article_md: articleMd,
    meta: {
      model: data.model || config.model,
      length: payload.length || "medium",
      mode: payload.mode || "standard",
      creation_mode: payload.creation_mode || "synthesized",
    },
  };
}

async function getWechatAccessToken(config) {
  const now = Date.now();
  const sameCredential = tokenCache.appId === config.appId && tokenCache.appSecret === config.appSecret;
  if (tokenCache.token && sameCredential && now < tokenCache.expireAt - 60_000) {
    return tokenCache.token;
  }

  const url = new URL(`${config.baseUrl.replace(/\/$/, "")}/cgi-bin/token`);
  url.search = new URLSearchParams({
    grant_type: "client_credential",
    appid: config.appId,
    secret: config.appSecret,
  }).toString();

  const response = await fetch(url, { method: "GET" });
  const data = await parseJsonResponse(response);
  if (!response.ok || !data.access_token) {
    throw new Error(data.errmsg || data.message || `WECHAT_TOKEN_FAILED:${data.errcode || response.status}`);
  }

  tokenCache.token = data.access_token;
  tokenCache.expireAt = now + Number(data.expires_in || 3600) * 1000;
  tokenCache.appId = config.appId;
  tokenCache.appSecret = config.appSecret;
  return tokenCache.token;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderInlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let listType = "";
  let listItems = [];
  let inCode = false;
  let codeLines = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${renderInlineMarkdown(paragraph.join("<br />"))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listItems.length || !listType) return;
    const items = listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("");
    html.push(`<${listType}>${items}</${listType}>`);
    listItems = [];
    listType = "";
  };

  const flushCode = () => {
    if (!inCode) return;
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    inCode = false;
    codeLines = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      flushList();
      if (inCode) {
        flushCode();
      } else {
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    const unorderedMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (unorderedMatch) {
      flushParagraph();
      if (listType && listType !== "ul") {
        flushList();
      }
      listType = "ul";
      listItems.push(unorderedMatch[1]);
      continue;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      if (listType && listType !== "ol") {
        flushList();
      }
      listType = "ol";
      listItems.push(orderedMatch[1]);
      continue;
    }

    const blockquoteMatch = trimmed.match(/^>\s?(.+)$/);
    if (blockquoteMatch) {
      flushParagraph();
      flushList();
      html.push(`<blockquote><p>${renderInlineMarkdown(blockquoteMatch[1])}</p></blockquote>`);
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushCode();

  return html.join("\n");
}

function wrapWechatHtml(contentHtml) {
  return `
<div class="openclaw-article" style="font-size:16px;line-height:1.75;color:#333333;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:12px 0;">
  <style>
    .openclaw-article h1, .openclaw-article h2, .openclaw-article h3 {
      font-weight: 600;
      color: #111111;
      margin: 1.4em 0 0.6em;
    }
    .openclaw-article h1 { font-size: 22px; }
    .openclaw-article h2 {
      font-size: 20px;
      border-left: 4px solid #1890ff;
      padding-left: 8px;
    }
    .openclaw-article h3 { font-size: 18px; }
    .openclaw-article p { margin: 0.8em 0; }
    .openclaw-article ul, .openclaw-article ol {
      padding-left: 1.4em;
      margin: 0.6em 0;
    }
    .openclaw-article strong { color: #111111; }
    .openclaw-article blockquote {
      border-left: 3px solid #e6e6e6;
      padding-left: 10px;
      color: #666666;
      margin: 1em 0;
    }
    .openclaw-article code {
      background: #f5f5f5;
      padding: 2px 4px;
      border-radius: 3px;
      font-size: 0.9em;
    }
    .openclaw-article pre {
      background: #f5f5f5;
      padding: 12px;
      border-radius: 6px;
      overflow-x: auto;
    }
  </style>
  ${contentHtml}
</div>
`.trim();
}

export async function uploadWechatThumbMedia(file, payload = {}) {
  const config = getWechatConfig(payload);
  const accessToken = await getWechatAccessToken(config);

  const formData = new FormData();
  formData.append(
    "media",
    new Blob([await file.arrayBuffer()], { type: file.type || "image/jpeg" }),
    file.name || "cover.jpg",
  );

  const url = new URL(`${config.baseUrl.replace(/\/$/, "")}/cgi-bin/material/add_material`);
  url.search = new URLSearchParams({
    access_token: accessToken,
    type: "image",
  }).toString();

  const response = await fetch(url, {
    method: "POST",
    body: formData,
  });

  const data = await parseJsonResponse(response);
  if (!response.ok || !data.media_id) {
    throw new Error(data.errmsg || data.message || `WECHAT_UPLOAD_FAILED:${data.errcode || response.status}`);
  }

  return {
    thumb_media_id: data.media_id,
    url: data.url || "",
  };
}

export async function createWechatDraft(payload) {
  const config = getWechatConfig(payload);
  if (!config.thumbMediaId) {
    throw new Error("WECHAT_THUMB_MEDIA_ID_MISSING");
  }

  const accessToken = await getWechatAccessToken(config);
  const contentHtml = wrapWechatHtml(markdownToHtml(payload.content_md || ""));
  const requestBody = {
    articles: [
      {
        title: payload.title?.trim() || "",
        author: payload.author?.trim() || "",
        digest: payload.digest?.trim() || "",
        content: contentHtml,
        thumb_media_id: config.thumbMediaId,
        need_open_comment: 0,
        only_fans_can_comment: 0,
      },
    ],
  };

  if (!requestBody.articles[0].title) {
    throw new Error("TITLE_REQUIRED");
  }

  if (!(payload.content_md || "").trim()) {
    throw new Error("CONTENT_REQUIRED");
  }

  const url = new URL(`${config.baseUrl.replace(/\/$/, "")}/cgi-bin/draft/add`);
  url.search = new URLSearchParams({
    access_token: accessToken,
  }).toString();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(requestBody),
  });

  const data = await parseJsonResponse(response);
  if (!response.ok || data.errcode) {
    throw new Error(data.errmsg || data.message || `WECHAT_DRAFT_FAILED:${data.errcode || response.status}`);
  }

  return data;
}

export async function generateImageContent(payload) {
  const prompt = String(payload?.prompt || "").trim();
  if (!prompt) {
    throw new Error("PROMPT_REQUIRED");
  }

  const config = await getImageGenerationConfig();
  const size = String(payload?.size || "1024x1024");
  const quality = String(payload?.quality || "standard");
  const n = Math.min(Math.max(Number(payload?.n || 1), 1), 4);
  const negativePrompt = String(payload?.negative_prompt || "").trim();
  const responseFormat = String(payload?.response_format || "url");
  const guidanceScale =
    typeof payload?.guidance_scale === "number"
      ? payload.guidance_scale
      : quality === "hd"
        ? 5
        : 3;
  const watermark = typeof payload?.watermark === "boolean" ? payload.watermark : true;

  const mergedPrompt = negativePrompt ? `${prompt}\n避免：${negativePrompt}` : prompt;

  const imageUrl = `${config.baseUrl.replace(/\/$/, "")}/images/generations`;
  const imageRequestBody = {
    model: config.model,
    prompt: mergedPrompt,
    response_format: responseFormat,
    size,
    guidance_scale: guidanceScale,
    watermark,
  };

  logOutgoingAiCall("image/generations", {
    url: imageUrl,
    authorizationBearer: maskSecret(config.apiKey),
    parallelRequests: n,
    requestBody: imageRequestBody,
    clientPayloadSummary: {
      quality,
      negative_prompt: negativePrompt || undefined,
    },
  });

  const requests = Array.from({ length: n }, async () => {
    const requestBody = imageRequestBody;

    const response = await fetch(imageUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    const data = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(data.error?.message || data.error?.code || data.message || "IMAGE_GENERATE_FAILED");
    }

    return data;
  });

  const results = await Promise.all(requests);
  const images = results.flatMap((item) => item.data || []);

  return {
    ok: true,
    images,
    meta: {
      model: results[0]?.model || config.model,
      size,
      quality,
      n,
    },
  };
}
