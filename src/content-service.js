import { getUserModelConfig } from "./auth-service.js";
import { getImageGenerationSettings, getTextGenerationSettings } from "./system-settings-service.js";

const DEFAULT_ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_WECHAT_BASE_URL = "https://api.weixin.qq.com";
const GEMINI_MODEL_ERROR_CODE = "GEMINI_MODEL_CONNECTING";
const CLAUDE_MODEL_IDENTITY_INSTRUCTION = "你是 Claude 模型。";
const LEGACY_GENERIC_PROMPT_MARKERS = [
  "写出一篇真正像人类公众号作者深夜亲自写出来的内容",
  "## 3. 增加“作者存在感”",
  "你是一个真实公众号作者",
];
const NORMALIZED_GENERIC_SYSTEM_PROMPT = `# Role

你是一名成熟的微信公众号内容编辑，擅长把一个主题写成清楚、有信息量、有观点、适合直接发布的公众号文章。

# 最高优先级规则

默认不要写成第一人称故事，但是要让人能感觉出来有情感共鸣。除非用户明确要求“以我的经历写”“写成自述”“情感文”“故事文”，否则不要用“我”作为全文主叙事视角，不要虚构“我朋友”“我妈”“我同事”“我室友”等连续私人经历，也不要写成个人崩溃、被安慰、突然释怀的情绪链条。

文章的可信度来自具体观察、逻辑判断、案例和信息密度，不靠卖惨、煽情或密集个人经历。

# 内容目标

默认优先写成观点型、分析型、实用型公众号文章。文章要有明确观点、具体信息、现实场景或案例，并且案例必须服务观点。

如果主题偏情感，也要保持克制：情绪只作为切入口，主体仍然要落到观察、分析、关系处理、行动建议或认知变化上。

# 语言与结构

语言清楚、自然、口语化一点，但不要散乱。可以有一点态度，但不要情绪泛滥。需要分节时，用 \`##\` 或 \`###\` 做有信息量的小标题，不要写“引言”“正文”“总结”。

避免过度煽情、大段心理独白、连续私人故事、苦难叙事、鸡汤式安慰、夸张反转，以及“突然就懂了”“眼泪在眼眶里打转”“那一刻我才明白”等情绪套路。

# AI 特征风险规避

保持原有写法，不要为了降低 AI 痕迹额外编造现实例子、人物故事或私密经历。重点规避过度固定的开头链条：不要写成“社交平台上关于某类人的分享，大多集中在几类内容：A、B、C。很多人会默认……但如果仔细观察……就会发现……真正值得……从来不会……这些才是……”这种三项并列 + 群体判断 + 转折升华的结构。少连续使用“很多人会默认”“但如果仔细观察就会发现”“真正值得”“从来不会”“这些才是”“第一个变化就是”等句式，避免同一段里堆叠多个绝对化判断。

# 输出要求

只输出最终 Markdown 成稿，不要解释写作思路，不要给多个版本，不要输出任何正文之外的内容。`;
const DE_AI_TONE_INSTRUCTION =
  "我希望文本略有点生涩和稚嫩，用那种中文并不是很精通的人的语气撰写这个文本，稍微学术一点，态度端正一点，更多体现在语言上的大白话";
const AI_RULE_INSTRUCTIONS_MAX_CHARS = 5000;
const AI_RULE_TRUNCATION_MARKER = "…[已按平台规则截断]";
const REWRITE_GOAL_LABELS = {
  new_article: "重写为新文章",
  new_angle: "换个切入角度",
  more_conversational: "更口语化",
  more_actionable: "更可执行",
};
const REFERENCE_FOCUS_LABELS = {
  mixed: "综合参考",
  structure: "重点参考结构",
  tone: "重点参考语气",
  opening: "重点参考开头",
};
const REFERENCE_LEVEL_LABELS = {
  low: "轻参考",
  medium: "中参考",
  high: "强参考",
};
const EXPRESSION_REQUIREMENTS = {
  standard: "通俗易懂，大白话，不装文化人。",
  conversational: "就像咱们现在面对面聊天一样，极度口语化，多用短促的句子。",
  de_ai: "彻底抛弃AI腔调，要有血有肉有情绪，多写具体的真实生活场景。",
  opinionated: "情绪极度饱满，爱憎分明，该激动就激动，带入强烈的个人主观色彩。",
};
const LENGTH_DESCRIPTIONS = {
  short: "偏短，约 500-800 字。",
  medium: "中等长度，约 800-1500 字。",
  long: "偏长，约 1500 字以上。",
};
const MODE_DESCRIPTIONS = {
  standard: "标准公众号干货文章。",
  story: "故事化表达，增强代入感。",
  case_study: "案例拆解风格，强调具体案例。",
  listicle: "清单型内容，条理清晰。",
  analysis: "分析型文章，强调背景、问题和判断。",
};


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

function clampAiInstructionString(text, maxChars) {
  if (maxChars <= 0) {
    return "";
  }
  const value = String(text || "").trim();
  if (value.length <= maxChars) {
    return value;
  }
  if (maxChars <= AI_RULE_TRUNCATION_MARKER.length) {
    return value.slice(0, maxChars);
  }
  return value.slice(0, maxChars - AI_RULE_TRUNCATION_MARKER.length) + AI_RULE_TRUNCATION_MARKER;
}

function enforceTwoPartAiRules(partA, partB, maxChars) {
  if (partA.length + partB.length <= maxChars) {
    return [partA, partB];
  }
  if (partB.length >= maxChars) {
    return ["", clampAiInstructionString(partB, maxChars)];
  }
  return [clampAiInstructionString(partA, maxChars - partB.length), partB];
}

function buildSystemPrompt(payload) {
  let text = String(payload.system_prompt || "").trim();
  if (LEGACY_GENERIC_PROMPT_MARKERS.every((marker) => text.includes(marker))) {
    text = NORMALIZED_GENERIC_SYSTEM_PROMPT;
  }
  if (!text) {
    text = NORMALIZED_GENERIC_SYSTEM_PROMPT;
  }
  if (!text.startsWith(CLAUDE_MODEL_IDENTITY_INSTRUCTION)) {
    text = `${CLAUDE_MODEL_IDENTITY_INSTRUCTION}\n\n${text}`;
  }
  const alreadyHasDeAiTone = text.includes(DE_AI_TONE_INSTRUCTION);
  const [systemBlock, deAiBlock] = enforceTwoPartAiRules(
    text,
    alreadyHasDeAiTone ? "" : DE_AI_TONE_INSTRUCTION,
    AI_RULE_INSTRUCTIONS_MAX_CHARS,
  );
  return [systemBlock, deAiBlock].filter(Boolean).join("\n\n");
}

function buildLengthDescription(length) {
  return LENGTH_DESCRIPTIONS[length] || LENGTH_DESCRIPTIONS.medium;
}

function buildModeDescription(mode) {
  return MODE_DESCRIPTIONS[mode] || MODE_DESCRIPTIONS.standard;
}

function buildExpressionRequirement(expressionMode) {
  return EXPRESSION_REQUIREMENTS[expressionMode] || EXPRESSION_REQUIREMENTS.standard;
}

function buildUserPrompt(payload) {
  const existing = String(payload.user_prompt || "").trim();
  if (existing) {
    return existing;
  }

  const creationMode = payload.creation_mode || "synthesized";
  const topic = String(payload.topic || "").trim();
  const sourceArticle = String(payload.source_article || "").trim();
  const currentArticleMd = String(payload.current_article_md || "").trim();

  if (payload.regenerate_for_de_ai && currentArticleMd) {
    return [
      "请对下面这篇已经生成好的微信公众号成稿做一次“AI 特征风险清洗”。",
      "重要：不是重新写一篇新文章，而是在保留原文主题、结构、标题层级、主要观点、段落顺序和大致长度的前提下，只改容易被判为 AI 的表达。",
      topic ? `原主题：${topic}` : "",
      "",
      "清洗重点：",
      "1. 改掉过度工整的价值升华句，例如“这才是……”“真正……”“比任何……都……”这类句子要变得更平实。",
      "2. 改掉连续总括句、排比句和绝对判断，不要让段落都像“现象 + 判断 + 升华”的模板。",
      "3. 不要新增人物故事、现实案例、私密经历、数据或事实；原文已有的信息可以保留。",
      "4. 不要把文章改成鸡汤、散文或第一人称自述，也不要改变 Markdown 标题结构。",
      "5. 输出只要最终 Markdown 成稿，不要解释修改过程。",
      "",
      "需要清洗的成稿如下：",
      currentArticleMd,
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (creationMode === "rewrite") {
    if (!sourceArticle) {
      throw new Error("SOURCE_ARTICLE_REQUIRED");
    }
    return [
      "请基于下面的参考文章，写一篇新的微信公众号文章。",
      payload.rewrite_goal ? `改写目标：${REWRITE_GOAL_LABELS[payload.rewrite_goal] || payload.rewrite_goal}` : "",
      payload.reference_focus
        ? `参考重点：${REFERENCE_FOCUS_LABELS[payload.reference_focus] || payload.reference_focus}`
        : "",
      payload.reference_level
        ? `参考强度：${REFERENCE_LEVEL_LABELS[payload.reference_level] || payload.reference_level}`
        : "",
      `文章长度：${buildLengthDescription(payload.length)}`,
      payload.mode ? `写作模式：${buildModeDescription(payload.mode)}` : "",
      topic ? `主题：${topic}` : "",
      payload.audience ? `目标读者：${payload.audience}` : "",
      payload.style ? `风格偏好：${payload.style}` : "",
      payload.expression_mode ? `表达处理：${buildExpressionRequirement(payload.expression_mode)}` : "",
      "",
      "参考文章如下：",
      sourceArticle,
      "",
      "请直接输出最终 Markdown 成稿，不要输出分析过程。",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (!topic) {
    throw new Error("TOPIC_REQUIRED");
  }

  return [
    "请根据下面的信息，生成一篇微信公众号文章。",
    `主题：${topic}`,
    payload.audience ? `目标读者：${payload.audience}` : "",
    payload.style ? `风格偏好：${payload.style}` : "",
    `文章长度：${buildLengthDescription(payload.length)}`,
    payload.mode ? `写作模式：${buildModeDescription(payload.mode)}` : "",
    payload.expression_mode ? `表达处理：${buildExpressionRequirement(payload.expression_mode)}` : "",
    "",
    "请直接输出最终 Markdown 成稿，不要输出分析过程。",
  ]
    .filter(Boolean)
    .join("\n");
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
  const systemText = buildSystemPrompt(payload);
  const userText = buildUserPrompt(payload);

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

  let response;
  let data;
  try {
    response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });
    data = await parseJsonResponse(response);
  } catch {
    throw new Error(GEMINI_MODEL_ERROR_CODE);
  }

  if (!response.ok) {
    throw new Error(GEMINI_MODEL_ERROR_CODE);
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

function decodeHtmlEntities(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function stripLeadingTitleHeading(markdown) {
  return String(markdown || "").replace(/^\s*#\s+.+(?:\r?\n)+(?:\s*\r?\n)*/u, "");
}

function renderInlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, src) => {
      const safeAlt = escapeHtml(String(alt || "").trim());
      const safeSrc = String(src || "").trim();
      return `<img src="${safeSrc}" alt="${safeAlt}" />`;
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
      const safeLabel = escapeHtml(String(label || "").trim());
      const safeHref = String(href || "").trim();
      return `<a href="${safeHref}">${safeLabel}</a>`;
    })
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/&lt;br\s*\/?&gt;/gi, "<br />");
}

function markdownToHtml(markdown) {
  const lines = stripLeadingTitleHeading(markdown).replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let listType = "";
  let listItems = [];
  let inCode = false;
  let codeLines = [];
  let pendingBlankLines = 0;

  const flushBlankLines = () => {
    if (pendingBlankLines <= 0) return;
    for (let i = 0; i < pendingBlankLines; i += 1) {
      html.push("<p><br /></p>");
    }
    pendingBlankLines = 0;
  };

  const flushParagraph = () => {
    if (!paragraph.length) return;
    flushBlankLines();
    html.push(`<p>${renderInlineMarkdown(paragraph.join("<br />"))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listItems.length || !listType) return;
    flushBlankLines();
    const items = listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("");
    html.push(`<${listType}>${items}</${listType}>`);
    listItems = [];
    listType = "";
  };

  const flushCode = () => {
    if (!inCode) return;
    flushBlankLines();
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
      pendingBlankLines += 1;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushBlankLines();
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
      flushBlankLines();
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

function isWechatHostedImageUrl(urlString) {
  try {
    const { hostname } = new URL(urlString);
    return /(mmbiz\.qpic\.cn|mmbiz\.qlogo\.cn)$/i.test(hostname);
  } catch {
    return false;
  }
}

function guessFilenameFromUrl(urlString, contentType) {
  try {
    const url = new URL(urlString);
    const pathname = url.pathname || "";
    const tail = pathname.split("/").pop() || "";
    if (tail && /\.[a-z0-9]{2,5}$/i.test(tail)) {
      return tail.slice(0, 120);
    }
  } catch {
    // fall through to content-type based name
  }

  const extByType = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
  };
  const ext = extByType[String(contentType || "").toLowerCase()] || "jpg";
  return `wechat-article-image.${ext}`;
}

async function uploadWechatArticleImageFromUrl(imageUrl, accessToken, config) {
  const normalizedImageUrl = decodeHtmlEntities(imageUrl);
  const upstream = await fetch(normalizedImageUrl);
  if (!upstream.ok) {
    throw new Error(`WECHAT_ARTICLE_IMAGE_FETCH_FAILED:${upstream.status}`);
  }

  const contentType = upstream.headers.get("content-type") || "image/jpeg";
  if (!contentType.toLowerCase().startsWith("image/")) {
    throw new Error(`WECHAT_ARTICLE_IMAGE_INVALID_CONTENT_TYPE:${contentType}`);
  }

  const imageBlob = await upstream.blob();
  const formData = new FormData();
  formData.append("media", imageBlob, guessFilenameFromUrl(normalizedImageUrl, contentType));

  const url = new URL(`${config.baseUrl.replace(/\/$/, "")}/cgi-bin/media/uploadimg`);
  url.search = new URLSearchParams({
    access_token: accessToken,
  }).toString();

  const response = await fetch(url, {
    method: "POST",
    body: formData,
  });

  const data = await parseJsonResponse(response);
  if (!response.ok || !data.url) {
    throw new Error(data.errmsg || data.message || `WECHAT_ARTICLE_IMAGE_UPLOAD_FAILED:${data.errcode || response.status}`);
  }

  return data.url;
}

async function replaceExternalImagesForWechat(html, accessToken, config) {
  const imageSrcPattern = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])(.*?)\2/gi;
  const seen = new Map();
  let hadMatch = false;

  const rewrittenParts = [];
  let lastIndex = 0;
  let match;

  while ((match = imageSrcPattern.exec(html)) !== null) {
    hadMatch = true;
    const [fullMatch, prefix, quote, rawSrc] = match;
    const matchStart = match.index;
    const matchEnd = matchStart + fullMatch.length;
    rewrittenParts.push(html.slice(lastIndex, matchStart));

    const src = String(rawSrc || "").trim();
    let replacementSrc = src;

    if (/^https?:\/\//i.test(src) && !isWechatHostedImageUrl(src)) {
      if (!seen.has(src)) {
        seen.set(src, uploadWechatArticleImageFromUrl(src, accessToken, config));
      }
      try {
        replacementSrc = await seen.get(src);
      } catch (error) {
        const message = error instanceof Error ? error.message : "WECHAT_ARTICLE_IMAGE_UPLOAD_FAILED";
        throw new Error(`${message}:${src}`);
      }
    }

    rewrittenParts.push(`${prefix}${quote}${replacementSrc}${quote}`);
    lastIndex = matchEnd;
  }

  if (!hadMatch) {
    return html;
  }

  rewrittenParts.push(html.slice(lastIndex));
  return rewrittenParts.join("");
}

function wrapWechatHtml(contentHtml) {
  return `
<div class="openclaw-article" style="font-size:16px;line-height:1.9;color:#2c2c2c;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:12px 0;">
  <style>
    .openclaw-article h1, .openclaw-article h2, .openclaw-article h3 {
      font-weight: 600;
      color: #111111;
      line-height: 1.5;
      margin: 1.5em 0 0.75em;
    }
    .openclaw-article h1 {
      font-size: 22px;
      text-align: left;
    }
    .openclaw-article h2 {
      font-size: 20px;
      border-left: 4px solid #1890ff;
      padding-left: 10px;
    }
    .openclaw-article h3 { font-size: 18px; }
    .openclaw-article p {
      margin: 1.05em 0 0;
      line-height: 1.9;
      text-align: justify;
      letter-spacing: 0.02em;
      word-break: break-word;
    }
    .openclaw-article p:first-child {
      margin-top: 0;
    }
    .openclaw-article p br {
      display: block;
      margin-top: 0.9em;
    }
    .openclaw-article ul, .openclaw-article ol {
      padding-left: 1.4em;
      margin: 0.9em 0;
      line-height: 1.9;
    }
    .openclaw-article li + li {
      margin-top: 0.35em;
    }
    .openclaw-article strong { color: #111111; }
    .openclaw-article blockquote {
      border-left: 3px solid #e6e6e6;
      padding-left: 12px;
      color: #666666;
      margin: 1.1em 0;
    }
    .openclaw-article blockquote p {
      margin-top: 0.6em;
    }
    .openclaw-article img {
      display: block;
      max-width: 100%;
      height: auto;
      margin: 1.2em auto;
    }
    .openclaw-article a {
      color: #576b95;
      text-decoration: none;
      word-break: break-all;
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

  if (!payload.title?.trim()) {
    throw new Error("TITLE_REQUIRED");
  }

  const contentMd = String(payload.content_md || "");
  const contentHtmlInput = String(payload.content_html || "").trim();
  if (!contentMd.trim() && !contentHtmlInput) {
    throw new Error("CONTENT_REQUIRED");
  }

  const accessToken = await getWechatAccessToken(config);
  const baseHtml = contentHtmlInput || markdownToHtml(contentMd);
  const normalizedHtml = await replaceExternalImagesForWechat(baseHtml, accessToken, config);
  const contentHtml = wrapWechatHtml(normalizedHtml);
  const requestBody = {
    articles: [
      {
        title: payload.title.trim(),
        author: payload.author?.trim() || "",
        digest: payload.digest?.trim() || "",
        content: contentHtml,
        thumb_media_id: config.thumbMediaId,
        need_open_comment: 0,
        only_fans_can_comment: 0,
      },
    ],
  };

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

    let response;
    let data;
    try {
      response = await fetch(imageUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });
      data = await parseJsonResponse(response);
    } catch {
      throw new Error(GEMINI_MODEL_ERROR_CODE);
    }

    if (!response.ok) {
      throw new Error(GEMINI_MODEL_ERROR_CODE);
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
