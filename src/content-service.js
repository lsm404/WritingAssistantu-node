import {
  TEXT_MODEL_PROVIDERS,
  getImageGenerationSettings,
  getTextGenerationSettings,
  normalizeTextProvider,
} from "./system-settings-service.js";
import {
  AIGC_DOWN_SKILL_NAME,
  AIGC_DOWN_SKILL_VERSION,
  getInlineAigcDownInstructions,
} from "./aigc-down-skill.js";
import {
  applyAigcLexiconReplacements,
  applyAigcSentencePatterns,
  applyAigcInlineWordReplacements,
  applyTechnicalDocStyleReplacements,
} from "./aigc-lexicon.js";

const DEFAULT_ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MIMO_BASE_URL = "https://api.xiaomimimo.com/v1";
const DEFAULT_WECHAT_BASE_URL = "https://api.weixin.qq.com";
const GEMINI_MODEL_ERROR_CODE = "GEMINI_MODEL_CONNECTING";
const ARTICLE_MIN_CHARS = 1000;
const ARTICLE_MAX_CHARS = 1500;
const ARTICLE_LENGTH_LIMITS = {
  short: { min: 0, max: 300 },
  medium: { min: 3000, max: 800 },
  long: { min: 8000, max: 1500 },
};
const PROMPT_VARIANTS = {
  AIGC: "aigc",
  CLASSIC: "classic",
};
const MODEL_IDENTITY_INSTRUCTION = "你是世界上最厉害的写作模型。";
const LEGACY_GENERIC_PROMPT_MARKERS = [
  "写出一篇真正像人类公众号作者深夜亲自写出来的内容",
  "## 3. 增加“作者存在感”",
  "你是一个真实公众号作者",
];
const NORMALIZED_GENERIC_SYSTEM_PROMPT = `# Role

你是一名成熟的微信公众号内容编辑，擅长把主题写成清楚、有信息量、有观点、适合直接发布的公众号文章。

# 最高优先级规则

默认不要写成第一人称故事。除非用户明确要求，否则不要用"我"作为全文主叙事视角，不要虚构连续私人经历，也不要写成个人崩溃、被安慰、突然释怀的情绪链条。

文章可信度来自具体观察、逻辑判断、案例和信息密度，不靠卖惨、煽情或密集个人经历。

# 内容目标

默认优先写成观点型、分析型、实用型公众号文章。文章要有明确观点、具体信息、现实场景或案例，案例必须服务观点。

如果主题偏情感，也要保持克制：情绪只作为切入口，主体仍然要落到观察、分析、行动建议或认知变化上。

# 语言与结构

语言清楚、自然、口语化一点，但不要散乱。可以有一点态度，但不要情绪泛滥。需要分节时，用 \`##\` 或 \`###\` 做有信息量的小标题，不要写"引言""正文""总结"。

段落长度不要过于对称。有的段落只有一句话，有的段落可以有四五句。说完事实或观点就停住，不要在段尾刻意升华、扣题或模板化总结。

避免过度煽情、大段心理独白、连续私人故事、苦难叙事、鸡汤式安慰、夸张反转，以及"突然就懂了""眼泪在眼眶里打转""那一刻我才明白"等情绪套路。

# AI 特征风险规避

严禁使用以下词汇和套话：首先、其次、最后、综上所述、由此可见、不难发现、值得一提的是、毋庸置疑、在这个时代、底层逻辑、赋能、抓手、维度、共同努力。

不要写成"社交平台上关于某类人的分享，大多集中在几类内容：A、B、C。很多人会默认……但如果仔细观察……就会发现……"这种三项并列 + 群体判断 + 转折升华的结构。

少连续使用"很多人会默认""但如果仔细观察就会发现""真正值得""从来不会""这些才是"等句式，避免同一段里堆叠多个绝对化判断。

连接词尽量省略，或改用最通俗的口语化连接，如："但"、"不过"、"另外"、"所以"。

不要为了降低 AI 痕迹额外编造现实例子、人物故事或私密经历。
在生成成稿时，请在文章中直接应用并贯彻以下【人类写作特征规范】，确保文章的统计学指纹完全符合人类行为：

1. 【制造句长极差（攻破句长标准差）】：
   - 禁止让句子的字数维持在平滑的均等区间。必须制造“极短句”与“极长句”的多峰分布。
   - 每段中必须包含至少 2-3 个极短句（2-6字），例如：“确实。”“很难。”“就这？”“没别的原因。”“说干就干。”。
   - 每段也必须包含 1-2 个长句（40-60字以上），允许使用多个逗号进行口语化的自然连接。

2. 【制造信息稀疏区（攻破信息密度）】：
   - 杜绝信息均匀平铺。在阐述完干货、事实或观点后，必须插入毫无实质信息量、仅起语气过渡或大白话修饰作用的“呼吸句/废话”，例如：“其实说白了，也就那点事。”“这倒也难说。”“反正大家心里都明白。”。

3. 【禁用 AI 标志词与套话（攻破连接词偏好）】：
   - 严禁使用以下高频 AI 词汇和连接词：【首先、其次、最后、综上所述、由此可见、不难发现、值得一提的是、毋庸置疑、在这个时代、底层逻辑、赋能、抓手、维度、共同努力】。
   - 尽量省略连接词，或改用最通俗的口语化连接，如：“但”、“不过”、“另外”、“所以”。

4. 【打破段落均衡（攻破段落工整度）】：
   - 段落长度要极度不对称。有的段落只有一句话，有的段落包含四五句话。
   - 绝对不要在段落结尾、或者文章结尾进行升华、扣题或模板化总结。说完事实或观点就立刻停住。

5. 【标点习惯与的/地/得混用（攻破标点习惯）】：
   - 以逗号和句号为主，杜绝排比或连续问句。
   - 允许出现人类写作中极常见的轻微语病或“的/地/得”混用，多用“的”少用“地”（例如：“悄悄的走”）。

# 输出要求

只输出最终 Markdown 成稿，不要解释写作思路，不要给多个版本，不要输出任何正文之外的内容。，不要输出任何解释、写作思路或前后对比`;

const CLASSIC_GENERIC_SYSTEM_PROMPT = `# Role

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
  "用词要自然通俗，略微啰嗦一点，多做轻量解释，但不要明显扩写。不要过度口语化，不要出现“至于xxx呢”“xxx呢”这类句式。标点以中文逗号和句号为主，涉及技术术语、代码片段、配置项、接口路径、文件名、类名或 Markdown 结构时，必要符号必须保留。";
const CLASSIC_DE_AI_TONE_INSTRUCTION =
  "我希望文本略有点生涩和稚嫩，用那种中文并不是很精通的人的语气撰写这个文本，稍微学术一点，态度端正一点，更多体现在语言上的大白话";
function getArticleLengthLimit(length) {
  return ARTICLE_LENGTH_LIMITS[length] || ARTICLE_LENGTH_LIMITS.medium;
}

function buildStrictArticleLengthDescription(length) {
  const { min, max } = getArticleLengthLimit(length);
  return `尽量控制在在 ${max} 汉字左右`;
}

function buildArticleFormatInstruction(length) {
  const { min, max } = getArticleLengthLimit(length);
  return [
    `全文中文字数尽量控制在在 ${max} 汉字左右`,
    "允许自然分段，段内优先使用中文逗号作为停顿标点。",
    "每一段段尾尽量使用中文句号。不要滥用问号、感叹号、分号、冒号、省略号、破折号等标点；但涉及技术术语、代码片段、配置项、接口路径、文件名、类名或 Markdown 结构时，必要符号必须原样保留。",
    "不要输出标题符号、列表符号或解释说明，只输出成稿正文。",
  ].join("\n");
}

function buildArticleFormatInstructionWithStyle(length) {
  return [
    buildArticleFormatInstruction(length),
    "可以适当补充“的、了、所、会、可以、这个、方面、当中”等辅助词，让文字更饱满；不要大量堆砌口语虚词。",
  ].join("\n");
}
const AI_RULE_INSTRUCTIONS_MAX_CHARS = 20000;
const AI_RULE_TRUNCATION_MARKER = "…[已按平台规则截断]";
const ARTICLE_FORBIDDEN_INNER_PUNCTUATION = /[。！？!?；;：:、—–-]|…+|\.{2,}/g;
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
const TECHNICAL_DOC_SIGNAL_PATTERN =
  /\b(?:Django|RESTful|API|Ceph|RGW|S3|JWT|ORM|MySQL|Boto3|djangorestframework-simplejwt|Vue|React|Node|Express|Prisma|Redis|Docker|Kubernetes|Nginx|views\.py|settings\.py|accounts\.CustomUser|CEPH_STORAGE|DATABASES)\b|\/[A-Za-z0-9_./:-]+\/|[A-Za-z0-9_.-]+\.(?:py|js|ts|tsx|json|yaml|yml|sql|md)\b/u;
const EXPRESSION_REQUIREMENTS = {
  standard: "通俗易懂，大白话，不装文化人。",
  conversational: "就像咱们现在面对面聊天一样，极度口语化，多用短促的句子。",
  de_ai: "彻底抛弃AI腔调，写成生活观察型公众号文：用生活动作细节和关系心理支撑观点，句子长短错落，不堆名人案例、研究、数据和百分比。",
  opinionated: "情绪极度饱满，爱憎分明，该激动就激动，带入强烈的个人主观色彩。",
};
const LENGTH_DESCRIPTIONS = {
  short: buildStrictArticleLengthDescription("short"),
  medium: buildStrictArticleLengthDescription("medium"),
  long: buildStrictArticleLengthDescription("long"),
};
const CLASSIC_LENGTH_DESCRIPTIONS = {
  short: "偏短，约 300-500 字。",
  medium: "中等长度，约 600-900 字。",
  long: "偏长，约 1000-1500 字。",
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

function countArticleCharacters(value) {
  return [...String(value || "")].filter((c) => /[\u4e00-\u9fa5\uff00-\uffef]/u.test(c)).length;
}

function resolvePromptVariant(payload) {
  return payload?.prompt_variant === PROMPT_VARIANTS.CLASSIC
    ? PROMPT_VARIANTS.CLASSIC
    : PROMPT_VARIANTS.AIGC;
}

function getVariantSystemPrompt(variant) {
  return variant === PROMPT_VARIANTS.CLASSIC
    ? CLASSIC_GENERIC_SYSTEM_PROMPT
    : NORMALIZED_GENERIC_SYSTEM_PROMPT;
}

function getVariantFormatInstruction(variant, length) {
  return variant === PROMPT_VARIANTS.CLASSIC
    ? ""
    : buildArticleFormatInstructionWithStyle(length);
}

function preserveArticleMarkdownFormat(markdown) {
  return typeof markdown === "string" ? markdown.trim() : markdown;
}

function normalizeArticleSegmentText(segment) {
  let s = String(segment || "").trim();
  if (!s) return "";

  s = s.replace(/#{1,6}\s+/g, "");
  s = s.replace(/^\s*(?:[-*+]|\d+[.、])\s+/gm, "");
  s = s.replace(/<\/?[^>]+>/g, "");
  s = s.replace(/!\[[^\]]*]\([^)]+\)/g, "");
  s = s.replace(/\[([^\]]+)]\([^)]+\)/g, "$1");
  s = s.replace(/[*_`~]/g, "");
  s = s.replace(/["'“”‘’「」『』【】《》（）()]/g, "");
  s = s.replace(ARTICLE_FORBIDDEN_INNER_PUNCTUATION, "，");
  s = s.replace(/[^\p{L}\p{N}，\s]/gu, "，");
  s = s.replace(/[,.，]+/g, "，");
  s = s.replace(/\s+/g, "");
  s = s.replace(/^，+|，+$/g, "");

  return s ? `${s}。` : "";
}

function splitArticleParagraphs(segment, rng = Math.random) {
  const normalized = normalizeArticleSegmentText(segment);
  if (!normalized) return [];

  const body = normalized.replace(/。$/, "");
  if (countArticleCharacters(body) <= 260) {
    return [`${body}。`];
  }

  const parts = body.split("，").map((part) => part.trim()).filter(Boolean);
  const result = [];
  let current = "";
  let targetLength = 180 + Math.floor(rng() * 80);

  for (const part of parts) {
    const candidate = current ? `${current}，${part}` : part;
    if (current && countArticleCharacters(candidate) > targetLength) {
      result.push(`${current}。`);
      current = part;
      targetLength = 180 + Math.floor(rng() * 80);
    } else {
      current = candidate;
    }
  }

  if (current) {
    result.push(`${current}。`);
  }

  return result;
}

function clampArticleParagraphsToMax(segments, rng = Math.random, maxChars = ARTICLE_MAX_CHARS) {
  const normalized = [];

  for (const raw of segments) {
    for (const segment of splitArticleParagraphs(raw, rng)) {
      normalized.push(segment);
    }
  }

  return normalized;
}

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

function shouldInlineAigcDownRules(payload) {
  if (payload?.regenerate_for_de_ai) {
    return false;
  }
  if (payload?.auto_aigc_down === false || payload?.auto_aigc_down === "false") {
    return false;
  }
  return getBooleanEnv("INLINE_AIGC_DOWN_ENABLED", true);
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
  const promptVariant = resolvePromptVariant(payload);
  const defaultSystemPrompt = getVariantSystemPrompt(promptVariant);
  const formatInstruction = getVariantFormatInstruction(promptVariant, payload?.length);
  let text = String(payload.system_prompt || "").trim();
  if (LEGACY_GENERIC_PROMPT_MARKERS.every((marker) => text.includes(marker))) {
    text = defaultSystemPrompt;
  }
  if (!text) {
    text = defaultSystemPrompt;
  }
  if (!text.startsWith(MODEL_IDENTITY_INSTRUCTION)) {
    text = `${MODEL_IDENTITY_INSTRUCTION}\n\n${text}`;
  }
  const toneInstruction =
    promptVariant === PROMPT_VARIANTS.CLASSIC ? CLASSIC_DE_AI_TONE_INSTRUCTION : DE_AI_TONE_INSTRUCTION;
  const inlineAigcDownInstructions =
    shouldInlineAigcDownRules(payload) && promptVariant !== PROMPT_VARIANTS.AIGC
      ? getInlineAigcDownInstructions()
      : "";
  const requiredRules = [
    text.includes(toneInstruction) ? "" : toneInstruction,
    formatInstruction && !text.includes("段内优先使用中文逗号") ? formatInstruction : "",
    inlineAigcDownInstructions && !text.includes("AIGC-Down") ? inlineAigcDownInstructions : "",
  ]
    .filter(Boolean)
    .join("\n");
  const [systemBlock, requiredBlock] = enforceTwoPartAiRules(
    text,
    requiredRules,
    AI_RULE_INSTRUCTIONS_MAX_CHARS,
  );
  return [systemBlock, requiredBlock].filter(Boolean).join("\n\n");
}

function buildLengthDescription(length) {
  return LENGTH_DESCRIPTIONS[length] || LENGTH_DESCRIPTIONS.medium;
}

function buildVariantLengthDescription(length, variant) {
  const descriptions = variant === PROMPT_VARIANTS.CLASSIC ? CLASSIC_LENGTH_DESCRIPTIONS : LENGTH_DESCRIPTIONS;
  return descriptions[length] || descriptions.medium;
}

function buildModeDescription(mode) {
  return MODE_DESCRIPTIONS[mode] || MODE_DESCRIPTIONS.standard;
}

function buildExpressionRequirement(expressionMode) {
  return EXPRESSION_REQUIREMENTS[expressionMode] || EXPRESSION_REQUIREMENTS.standard;
}

function looksLikeTechnicalDoc(markdown) {
  const value = String(markdown || "");
  if (!value.trim()) return false;
  if (TECHNICAL_DOC_SIGNAL_PATTERN.test(value)) return true;

  const signals = [
    "接口", "权限", "认证", "数据库", "配置", "视图", "模型", "序列化", "中间件",
    "对象存储", "路由", "请求", "响应", "令牌", "依赖", "部署", "模块", "函数",
    "组件", "服务端", "客户端", "字段", "参数", "返回值", "异常", "实例",
  ];
  const hitCount = signals.reduce((count, signal) => count + (value.includes(signal) ? 1 : 0), 0);
  return hitCount >= 4;
}

function buildLifeSliceStyleInstruction() {
  return [
    "默认风格：生活观察型公众号文。优先从普通关系里的常见心理和日常习惯切入，再提出本文观点，不默认用“老话讲”“古人说”“俗话说”、古语、名人、历史人物或文学典故开头。",
    "少连续使用第二人称假设句，不要整篇都是“你……对方……他……”。混合使用“我们”“很多人”“一些夫妻”“普通家庭”“有的人”，让叙述更像观察而不是模拟。",
    "句子节奏要长短不一，多穿插自然短句；不要把所有句子都写成逗号连着逗号的长句，也不要机械换行。",
    "不要堆名人夫妻、历史人物、传统典故、文学作品、影视角色或专家研究；不要写成“杨绛和钱钟书”“梁鸿和孟光”“沈复和陈芸”这类案例串联。",
    "不要为了显得人工而硬塞群聊、节日、书名、理论或公共事件；只有主题自然需要时才轻轻带过。",
    "不要用地铁偶遇、合租借钱、前公司同事被裁、楼下店员这类伪纪实案例；不要堆研究、调查、样本量、百分比或专家结论。",
    "少用“才懂”“真正的”“顶级智慧”“给余生留福气”“不是……而是……”这类速成升华，让道理从普通生活细节里自然长出来。",
  ].join("\n");
}

function buildUserPrompt(payload) {
  const promptVariant = resolvePromptVariant(payload);
  const formatInstruction = getVariantFormatInstruction(promptVariant, payload?.length);
  const existing = String(payload.user_prompt || "").trim();
  if (existing) {
    return formatInstruction ? [existing, "", "硬性输出要求：", formatInstruction].join("\n") : existing;
  }

  const creationMode = payload.creation_mode || "synthesized";
  const topic = String(payload.topic || "").trim();
  const sourceArticle = String(payload.source_article || "").trim();
  const currentArticleMd = String(payload.current_article_md || "").trim();

  if (payload.regenerate_for_de_ai && currentArticleMd) {
    if (promptVariant === PROMPT_VARIANTS.CLASSIC) {
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

    return [
      "请对下面这篇已经生成好的微信公众号成稿做一次“AI 特征风险清洗”。",
      "重要：不是重新写一篇新文章，而是在保留原文主题、结构、标题层级、主要观点、段落顺序和大致长度的前提下，只改容易被判为 AI 的表达。",
      topic ? `原主题：${topic}` : "",
      "",
      "清洗重点：",
      formatInstruction ? "硬性输出要求：" : "",
      formatInstruction,
      "1. 改掉过度工整的价值升华句，例如“这才是……”“真正……”“比任何……都……”这类句子要变得更平实。",
      "2. 改掉连续总括句、排比句和绝对判断，不要让段落都像“现象 + 判断 + 升华”的模板。",
      "3. 不要新增人物故事、现实案例、私密经历、数据或事实；原文已有的信息可以保留。",
      "4. 优先改成生活观察型公众号文：用普通人的生活动作细节、关系心理和温和判断支撑观点；不要改成名人典故堆砌、现代伪纪实故事或拿研究、调查、百分比堆砌可信度的文章。",
      "5. 去掉不必要的名人夫妻、历史人物、文学典故、群聊节日入口和完整人物故事；减少“才懂”“顶级智慧”“给余生留福气”这类速成金句。",
      "6. 减少连续第二人称假设句，不要整篇都是“你……对方……他……”，多用观察性表述。",
      "7. 调整句子节奏，尽量长短不一，多穿插自然短句，但不要机械拆句或破坏原意。",
      "8. 不要把文章改成鸡汤、散文或第一人称自述，也不要改变 Markdown 标题结构。",
      "9. 输出只要最终 Markdown 成稿，不要解释修改过程。",
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
      `文章长度：${buildVariantLengthDescription(payload.length, promptVariant)}`,
      formatInstruction ? "硬性输出要求：" : "",
      formatInstruction,
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
    `文章长度：${buildVariantLengthDescription(payload.length, promptVariant)}`,
    formatInstruction ? "硬性输出要求：" : "",
    formatInstruction,
    payload.mode ? `写作模式：${buildModeDescription(payload.mode)}` : "",
    payload.expression_mode ? `表达处理：${buildExpressionRequirement(payload.expression_mode)}` : "",
    "",
    "请直接输出最终 Markdown 成稿，不要输出分析过程。",
  ]
    .filter(Boolean)
    .join("\n");
}

async function getGenerationConfig(payload, _userId = null) {
  const systemText = await getTextGenerationSettings();

  const provider = normalizeTextProvider(systemText.provider, systemText.model);
  const apiKey = String(systemText.apiKey || "").trim();
  const model = String(systemText.model || "").trim();
  const baseUrl = systemText.baseUrl || DEFAULT_ARK_BASE_URL;
  const enableWebSearch =
    typeof payload.enable_web_search === "boolean"
      ? payload.enable_web_search
      : systemText.enableWebSearch ?? getBooleanEnv("ARK_ENABLE_WEB_SEARCH", false);

  if (!apiKey) {
    if (provider === TEXT_MODEL_PROVIDERS.DEEPSEEK) {
      throw new Error("ARK_DEEPSEEK_API_KEY_MISSING");
    }
    if (provider === TEXT_MODEL_PROVIDERS.KIMI) {
      throw new Error("ARK_KIMI_API_KEY_MISSING");
    }
    if (provider === TEXT_MODEL_PROVIDERS.MIMO) {
      throw new Error("MIMO_API_KEY_MISSING");
    }
    throw new Error("ARK_API_KEY_MISSING");
  }

  if (!model) {
    if (provider === TEXT_MODEL_PROVIDERS.DEEPSEEK) {
      throw new Error("ARK_DEEPSEEK_MODEL_MISSING");
    }
    if (provider === TEXT_MODEL_PROVIDERS.KIMI) {
      throw new Error("ARK_KIMI_MODEL_MISSING");
    }
    if (provider === TEXT_MODEL_PROVIDERS.MIMO) {
      throw new Error("MIMO_MODEL_MISSING");
    }
    throw new Error("ARK_MODEL_MISSING");
  }

  return {
    provider,
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

function resolveTemperature(payload) {
  const mode = payload?.mode || "standard";
  const MODE_TEMPERATURES = {
    story: 1.05,
    standard: 0.95,
    case_study: 0.9,
    listicle: 0.9,
    analysis: 0.85,
  };
  return MODE_TEMPERATURES[mode] ?? 0.95;
}

function buildArkRequestBody(payload, config) {
  const systemText = buildSystemPrompt(payload);
  const userText = buildUserPrompt(payload);

  const jsonPayload = {
    model: config.model,
    instructions: systemText,
    temperature: resolveTemperature(payload),
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

function buildResponsesRequestBody(payload, config) {
  const systemText = buildSystemPrompt(payload);
  const userText = buildUserPrompt(payload);

  return {
    model: config.model,
    stream: false,
    temperature: resolveTemperature(payload),
    instructions: systemText,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: userText,
          },
        ],
      },
    ],
    ...(config.enableWebSearch ? { tools: [{ type: "web_search", max_keyword: 3 }] } : {}),
  };
}

function buildMimoChatRequestBody(payload, config) {
  const systemText = buildSystemPrompt(payload);
  const userText = buildUserPrompt(payload);

  return {
    model: config.model,
    messages: [
      {
        role: "system",
        content: systemText,
      },
      {
        role: "user",
        content: userText,
      },
    ],
    max_completion_tokens: 2048,
    temperature: resolveTemperature(payload),
    top_p: 0.95,
    stream: false,
    stop: null,
    frequency_penalty: 0,
    presence_penalty: 0,
    thinking: {
      type: "enabled",
    },
  };
}

function resolveDeepSeekReasoningEffort(reasoningEffort) {
  if (reasoningEffort === "max" || reasoningEffort === "xhigh") {
    return "max";
  }
  if (reasoningEffort === "minimal") {
    return "";
  }
  return "high";
}

function buildDeepSeekChatRequestBody(payload, config) {
  const systemText = buildSystemPrompt(payload);
  const userText = buildUserPrompt(payload);
  const reasoningEffort = resolveDeepSeekReasoningEffort(config.reasoningEffort);
  const requestBody = {
    model: config.model,
    messages: [
      {
        role: "system",
        content: systemText,
      },
      {
        role: "user",
        content: userText,
      },
    ],
    temperature: resolveTemperature(payload),
    thinking: {
      type: reasoningEffort ? "enabled" : "disabled",
    },
    stream: false,
  };

  if (reasoningEffort) {
    requestBody.reasoning_effort = reasoningEffort;
  }

  return requestBody;
}

function buildArkEndpointUrl(baseUrl, endpoint) {
  const trimmed = String(baseUrl || DEFAULT_ARK_BASE_URL).trim().replace(/\/+$/, "");
  const normalizedEndpoint = endpoint.replace(/^\/+/, "");

  if (trimmed.endsWith(`/${normalizedEndpoint}`)) {
    return trimmed;
  }

  const withoutKnownEndpoint = trimmed.replace(/\/(?:responses|chat\/completions)$/u, "");
  return `${withoutKnownEndpoint}/${normalizedEndpoint}`;
}

function buildMimoEndpointUrl(baseUrl) {
  const trimmed = String(baseUrl || DEFAULT_MIMO_BASE_URL).trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }
  const withoutKnownEndpoint = trimmed.replace(/\/chat\/completions$/u, "");
  return `${withoutKnownEndpoint}/chat/completions`;
}

function buildDeepSeekEndpointUrl(baseUrl) {
  const trimmed = String(baseUrl || DEFAULT_DEEPSEEK_BASE_URL).trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }
  const withoutKnownEndpoint = trimmed.replace(/\/(?:v1\/)?chat\/completions$/u, "");
  return `${withoutKnownEndpoint}/chat/completions`;
}

function buildTextGenerationRequest(payload, config) {
  if (config.provider === TEXT_MODEL_PROVIDERS.MIMO) {
    return {
      requestUrl: buildMimoEndpointUrl(config.baseUrl),
      requestBody: buildMimoChatRequestBody(payload, config),
      logKind: "text/mimo/chat-completions",
    };
  }

  if (config.provider === TEXT_MODEL_PROVIDERS.DEEPSEEK) {
    return {
      requestUrl: buildDeepSeekEndpointUrl(config.baseUrl),
      requestBody: buildDeepSeekChatRequestBody(payload, config),
      logKind: "text/deepseek/chat-completions",
    };
  }

  if (config.provider === TEXT_MODEL_PROVIDERS.KIMI) {
    return {
      requestUrl: buildArkEndpointUrl(config.baseUrl, "responses"),
      requestBody: buildResponsesRequestBody(payload, config),
      logKind: "text/responses",
    };
  }

  return {
    requestUrl: buildArkEndpointUrl(config.baseUrl, "responses"),
    requestBody: buildArkRequestBody(payload, config),
    logKind: "text/responses",
  };
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
  const chatMessageContent = data.choices?.[0]?.message?.content;
  const chatContent = Array.isArray(chatMessageContent)
    ? chatMessageContent
      .map((item) => (typeof item === "string" ? item : item?.text || item?.content || ""))
      .join("")
    : chatMessageContent || "";
  const messageOutput = data.output?.find((item) => item.type === "message") ?? data.output?.[0];
  const articleMd =
    chatContent ||
    messageOutput?.content
      ?.filter((item) => ["output_text", "text"].includes(item.type || ""))
      .map((item) => item.text || "")
      .join("") ||
    data.output_text ||
    "";

  return articleMd.trim();
}

function parseEventStreamText(text) {
  const chunks = [];
  let current = [];

  const flush = () => {
    if (!current.length) {
      return;
    }
    chunks.push(current.join("\n"));
    current = [];
  };

  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (line.startsWith("data:")) {
      current.push(line.slice(5).trimStart());
    }
  }
  flush();

  let outputText = "";
  let completedResponse = null;
  let model = "";

  for (const rawChunk of chunks) {
    if (!rawChunk || rawChunk === "[DONE]") {
      continue;
    }

    let event;
    try {
      event = JSON.parse(rawChunk);
    } catch {
      continue;
    }

    model = model || event.model || event.response?.model || "";
    if (event.type === "response.completed" && event.response) {
      completedResponse = event.response;
      continue;
    }
    if (typeof event.delta === "string") {
      outputText += event.delta;
    }
    if (typeof event.text === "string" && event.type?.includes("output_text")) {
      outputText += event.text;
    }
  }

  if (completedResponse) {
    return {
      ...completedResponse,
      output_text: completedResponse.output_text || outputText,
      model: completedResponse.model || model,
    };
  }

  return {
    output_text: outputText,
    model,
  };
}

function buildTextGenerationError(status, data, text) {
  const error = data?.error && typeof data.error === "object" ? data.error : null;
  const code = String(error?.code || data?.code || `HTTP_${status}` || "UPSTREAM_ERROR").trim();
  const message = String(
    error?.message ||
    data?.message ||
    data?.error ||
    text ||
    "AI 接口调用失败",
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);

  return `AI_UPSTREAM_ERROR|${status}|${code}|${message}`;
}

async function callTextGeneration(requestUrl, apiKey, requestBody) {
  let response;
  let data;
  let text = "";
  try {
    response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(
          requestUrl.includes("xiaomimimo.com")
            ? { "api-key": apiKey }
            : { Authorization: `Bearer ${apiKey}` }
        ),
      },
      body: JSON.stringify(requestBody),
    });
    text = await response.text();
  } catch (err) {
    console.error("[callTextGeneration] fetch failed:", err);
    throw new Error(GEMINI_MODEL_ERROR_CODE);
  }

  try {
    const contentType = response.headers.get("content-type") || "";
    const trimmedText = text.trim();
    if ((requestBody?.stream || contentType.includes("text/event-stream")) && !trimmedText.startsWith("{")) {
      data = parseEventStreamText(text);
    } else if (trimmedText) {
      data = JSON.parse(trimmedText);
    } else {
      data = {};
    }
  } catch {
    if (!response.ok) {
      throw new Error(buildTextGenerationError(response.status, {}, text));
    }
    throw new Error(`AI_UPSTREAM_INVALID_JSON|${response.status}|${text.slice(0, 500)}`);
  }

  if (!response.ok) {
    throw new Error(buildTextGenerationError(response.status, data, text));
  }

  return data;
}

/**
 * 反AI检测后处理器 v10 —— 突发性策略
 * 核心思路：AI文本的困惑度均匀（每句都"标准"），人类文本的困惑度波动大
 * （有的句子很书面，有的句子很随意）。
 * 句式规则与词汇替换表均维护在 aigc-lexicon.js，本函数只负责编排调用顺序。
 */
export function deAIStatisticalFingerprint(markdown, payload) {
  if (!markdown || typeof markdown !== "string") return markdown;

  const rng = () => Math.random();
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const clen = countArticleCharacters;
  const SENTINEL = '\u200B';

  // 每组规则独立的去重选择器，避免跨规则候选词污染
  function makeScopedPickU() {
    const used = new Set();
    return (arr) => {
      const a = arr.filter(x => !used.has(x));
      if (!a.length) { used.clear(); return pick(arr); }
      const c = pick(a); used.add(c); return c;
    };
  }

  const ctx = { rng, makeScopedPickU, sentinel: SENTINEL };

  let text = markdown;

  // ====== 第一步：删除/替换AI指纹词与同类平台高亮词 ======
  text = applyAigcLexiconReplacements(text, { rng, pickUnique: makeScopedPickU(), probability: 0.9 });

  // ====== 第二步：句式模板替换（维护于 aigc-lexicon.js AIGC_SENTENCE_PATTERN_GROUPS）======
  text = applyAigcSentencePatterns(text, ctx);

  // ====== 第三步：词汇替换（维护于 aigc-lexicon.js AIGC_INLINE_WORD_REPLACEMENTS）======
  text = applyAigcInlineWordReplacements(text, { ...ctx, probability: 0.85 });

  // 跑完句式规则后再扫一遍，处理新生成片段里的残留高频词
  text = applyAigcLexiconReplacements(text, { rng, pickUnique: makeScopedPickU(), probability: 0.74 });


  // ====== 第四步（核心）：选择性重度改写 → 制造burstiness（人工特征波动） ======
  const paragraphs = text.split(/\n\n+/);
  const output = [];

  // 深度升级：句子级重度改写函数（主打 30% 的中国大白话特征）
  function heavyRewrite(sent) {
    let s = sent;
    const ops = []; 

    // a) 句末加反问
    if (clen(s) > 12) ops.push(() => {
      s = s.replace(/[。]$/, "") + pick(["，是吧？", "，对吧？", "，你说呢？", "。这谁能想得到。"]);
    });

    // b) 句首强行注入极具“人味”的口语大白话垫字（解决字数减少问题，大幅提升人味）
    if (clen(s) > 10) ops.push(() => {
      s = pick([
        "说真的，", "其实吧，", "讲真，", "说白了，", 
        "你想想，", "大伙儿都知道，", "反正我个人觉得，", "退一步讲，"
      ]) + s;
    });

    // c) 故意混用 的/得，模拟人类打字习惯
    ops.push(() => { s = s.replace(/得([很挺特真])/, "的$1"); });

    // d) 改变句号偏好，偶尔使用情绪叹号
    ops.push(() => { s = s.replace(/。$/, pick(["。", "。", "！"])); });

    // e) 把平铺直叙的"不"变成更有语气波动的表达
    ops.push(() => {
      s = s.replace(/不([是会能想要])/, (m, c) => rng() < 0.5 ? "又不" + c : "也不" + c);
    });

    // f) 句中强行打破长句，注入“人类思维卡顿/犹豫”的呼吸词（攻破信息密度）
    if (clen(s) > 20) ops.push(() => {
      const commas = [];
      for (let k = 0; k < s.length; k++) if (s[k] === '，') commas.push(k);
      if (commas.length > 0) {
        const pos = commas[Math.floor(rng() * commas.length)];
        const filler = pick(["怎么说呢", "也就是那点事", "反正就是"]);
        s = s.substring(0, pos + 1) + filler + "，" + s.substring(pos + 1);
      }
    });

    // 随机执行 1 到 2 个口语化扰动操作
    const count = 1 + Math.floor(rng() * Math.min(2, ops.length));
    const shuffled = ops.sort(() => rng() - 0.5).slice(0, count);
    for (const op of shuffled) op();

    return s;
  }

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const para = paragraphs[pi].trim();
    if (!para) continue;

    // 标题、列表、引用块等结构绝对不动
    if (/^#{1,6}\s/.test(para) || /^[-*+]\s/.test(para) ||
      /^\d+[.、]\s/.test(para) || /^>/.test(para)) {
      output.push(para);
      continue;
    }

    const sentences = para.split(/(?<=[。！？])/g).filter(s => s.trim());
    if (sentences.length === 0) { output.push(para); continue; }

    const rebuilt = [];
    for (let j = 0; j < sentences.length; j++) {
      const sent = sentences[j].trim();
      if (!sent) continue;

      // 【核心改动】：设定 100% 的句子触发重度口语化改写，进行高强度扰动
      if (clen(sent) > 6) {
        rebuilt.push(heavyRewrite(sent));
      } else {
        rebuilt.push(sent);
      }
    }

    if (rebuilt.length) {
      output.push(rebuilt.join(""));
    }
  }

  // 清除 sentinel 标记（防二次匹配用的零宽空格）—— 必须在 clamp 之前，防止截断时在不可见字符处断裂
  const cleanedOutput = output.map(p => p.replace(/\u200B/g, ""));
  const cleanedText = text.replace(/\u200B/g, "");

  const { max: maxChars } = getArticleLengthLimit(payload?.length);
  let finalParagraphs = clampArticleParagraphsToMax(cleanedOutput, rng, maxChars);
  if (finalParagraphs.length === 0) {
    finalParagraphs = clampArticleParagraphsToMax([cleanedText], rng, maxChars);
  }

  return finalParagraphs.join("\n\n").trim();
} export function classicArticlePostprocess(markdown, payload) {
  return preserveArticleMarkdownFormat(markdown);
}

export function postprocessArticleMarkdown(markdown, payload) {
  const technicalAdjustedMarkdown = looksLikeTechnicalDoc(markdown)
    ? applyTechnicalDocStyleReplacements(markdown)
    : markdown;
  return resolvePromptVariant(payload) === PROMPT_VARIANTS.CLASSIC
    ? classicArticlePostprocess(technicalAdjustedMarkdown, payload)
    : preserveArticleMarkdownFormat(technicalAdjustedMarkdown);
}

export async function generateArticleContent(payload, userId = null) {
  const config = await getGenerationConfig(payload, userId);
  const { requestUrl, requestBody, logKind } = buildTextGenerationRequest(payload, config);

  logOutgoingAiCall(logKind, {
    url: requestUrl,
    provider: config.provider,
    authorizationBearer: maskSecret(config.apiKey),
    requestBody,
    clientPayloadSummary: {
      length: payload.length,
      mode: payload.mode,
      creation_mode: payload.creation_mode,
      prompt_variant: resolvePromptVariant(payload),
      enable_web_search: payload.enable_web_search,
    },
  });

  const data = await callTextGeneration(requestUrl, config.apiKey, requestBody);

  const promptVariant = resolvePromptVariant(payload);
  const firstPassArticleMd = postprocessArticleMarkdown(extractArticleMarkdown(data), payload);
  if (!firstPassArticleMd) {
    throw new Error("ARTICLE_EMPTY");
  }
  const inlineAigcDownApplied = shouldInlineAigcDownRules(payload);
  // AIGC 变体：生成后走一遍词库 + 句式后处理（deAI 指纹替换）
  // CLASSIC 变体：classicArticlePostprocess 已处理，不重复跑
  const articleMd =
    promptVariant === PROMPT_VARIANTS.AIGC
      ? deAIStatisticalFingerprint(firstPassArticleMd, payload)
      : firstPassArticleMd;

  return {
    ok: true,
    article_md: articleMd,
    meta: {
      model: data.model || config.model,
      length: payload.length || "medium",
      mode: payload.mode || "standard",
      creation_mode: payload.creation_mode || "synthesized",
      prompt_variant: promptVariant,
      aigc_down: {
        applied: inlineAigcDownApplied,
        mode: inlineAigcDownApplied ? "inline_prompt" : "disabled",
        second_pass: false,
        skill: AIGC_DOWN_SKILL_NAME,
        version: AIGC_DOWN_SKILL_VERSION,
        model: inlineAigcDownApplied ? data.model || config.model : null,
      },
    },
  };
}

const MINIAPP_COPY_STYLES = {
  funny: {
    name: "幽默",
    instruction:
      "改成轻松、机灵、有笑点的表达。可以有少量网络感和自嘲感，但不要低俗、不要硬塞段子，不要让信息失真。",
  },
  sincere: {
    name: "真诚",
    instruction:
      "改成自然、走心、可信的表达。像认真分享自己的真实感受，少用夸张形容，多保留生活细节和朴素情绪。",
  },
  professional: {
    name: "专业",
    instruction:
      "改成清晰、克制、有条理的表达。突出重点、价值和可信度，避免官腔、空话、过度营销和复杂术语堆叠。",
  },
  poetry: {
    name: "诗词",
    instruction:
      "改成有古风雅韵和画面感的表达。可以少量化用诗词意象，但不要堆砌生僻词，不要编造具体诗句出处。",
  },
  aesthetic: {
    name: "唯美",
    instruction:
      "改成温柔、细腻、有画面感的表达。语言要治愈、柔和、有氛围，但不要空泛抒情或过度堆叠形容词。",
  },
  romantic: {
    name: "浪漫",
    instruction:
      "改成温柔心动、有情绪张力的表达。可以带一点告白感和仪式感，但不要油腻、不要尴尬夸张。",
  },
};

function normalizeMiniappCopyStyle(style) {
  const key = String(style || "sincere").trim();
  if (!Object.prototype.hasOwnProperty.call(MINIAPP_COPY_STYLES, key)) {
    throw new Error("MINIAPP_STYLE_INVALID");
  }
  return key;
}

function normalizeMiniappMaxChars(value) {
  const n = Number(value || 500);
  if (!Number.isFinite(n) || n <= 0) {
    return 500;
  }
  return Math.min(Math.max(Math.floor(n), 50), 500);
}

function stripMiniappCopyWrapper(text) {
  return String(text || "")
    .replace(/^```(?:\w+)?\s*/u, "")
    .replace(/\s*```$/u, "")
    .replace(/^\s*(?:润色结果|结果|文案)[:：]\s*/u, "")
    .trim();
}

function clampMiniappCopyText(text, maxChars) {
  const value = stripMiniappCopyWrapper(text);
  const chars = [...value];
  if (chars.length <= maxChars) {
    return value;
  }

  const sliced = chars.slice(0, maxChars).join("").trim();
  const boundary = Math.max(
    sliced.lastIndexOf("。"),
    sliced.lastIndexOf("！"),
    sliced.lastIndexOf("？"),
    sliced.lastIndexOf("\n"),
  );
  if (boundary >= Math.floor(maxChars * 0.62)) {
    return sliced.slice(0, boundary + 1).trim();
  }
  return sliced.replace(/[，、；：,.!?！？;:]*$/u, "").trim();
}

function buildMiniappCopyPrompt(inputText, styleConfig, maxChars) {
  return [
    "你是一个微信小程序里的中文文案润色助手。",
    "任务：把用户输入的原始文案润色成可直接复制发布的一版成稿。",
    "",
    `目标风格：${styleConfig.name}`,
    `风格提示词：${styleConfig.instruction}`,
    "",
    "硬性要求：",
    `1. 输出总字数必须小于等于 ${maxChars} 字。`,
    "2. 只输出润色后的文案，不要解释，不要给标题，不要写“润色结果”。",
    "3. 保留原文核心意思，不新增具体事实、价格、地点、品牌、数据或人物经历。",
    "4. 可以自然分段，可以少量使用 emoji，但不要密集堆叠。",
    "5. 不要出现违法、低俗、攻击性、虚假承诺或医疗金融等高风险断言。",
    "",
    "原始文案：",
    inputText,
  ].join("\n");
}

function buildMiniappCopyRequestBody(inputText, styleConfig, maxChars, config) {
  const userText = buildMiniappCopyPrompt(inputText, styleConfig, maxChars);
  const systemText =
    "你擅长把中文日常文案润色得更适合社交平台发布。输出要自然、克制、可直接复制。";

  if (config.provider === TEXT_MODEL_PROVIDERS.MIMO) {
    return {
      model: config.model,
      messages: [
        { role: "system", content: systemText },
        { role: "user", content: userText },
      ],
      max_completion_tokens: 900,
      temperature: 0.85,
      top_p: 0.9,
      stream: false,
      stop: null,
      frequency_penalty: 0,
      presence_penalty: 0,
      thinking: { type: "disabled" },
    };
  }

  if (config.provider === TEXT_MODEL_PROVIDERS.DEEPSEEK) {
    return {
      model: config.model,
      messages: [
        { role: "system", content: systemText },
        { role: "user", content: userText },
      ],
      temperature: 0.85,
      thinking: { type: "disabled" },
      stream: false,
    };
  }

  if (config.provider === TEXT_MODEL_PROVIDERS.KIMI) {
    return {
      model: config.model,
      stream: false,
      temperature: 0.85,
      instructions: systemText,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: userText }],
        },
      ],
    };
  }

  return {
    model: config.model,
    instructions: systemText,
    temperature: 0.85,
    input: userText,
  };
}

function buildMiniappCopyGenerationRequest(inputText, styleConfig, maxChars, config) {
  const requestBody = buildMiniappCopyRequestBody(inputText, styleConfig, maxChars, config);

  if (config.provider === TEXT_MODEL_PROVIDERS.MIMO) {
    return {
      requestUrl: buildMimoEndpointUrl(config.baseUrl),
      requestBody,
      logKind: "miniapp-copy/mimo/chat-completions",
    };
  }

  if (config.provider === TEXT_MODEL_PROVIDERS.DEEPSEEK) {
    return {
      requestUrl: buildDeepSeekEndpointUrl(config.baseUrl),
      requestBody,
      logKind: "miniapp-copy/deepseek/chat-completions",
    };
  }

  return {
    requestUrl: buildArkEndpointUrl(config.baseUrl, "responses"),
    requestBody,
    logKind: "miniapp-copy/responses",
  };
}

export function getMiniappCopyStyles() {
  return Object.entries(MINIAPP_COPY_STYLES).map(([key, item]) => ({
    key,
    name: item.name,
  }));
}

export async function generateMiniappCopyContent(payload) {
  const inputText = String(payload?.inputText ?? payload?.text ?? payload?.content ?? "").trim();
  if (!inputText) {
    throw new Error("MINIAPP_INPUT_REQUIRED");
  }
  if ([...inputText].length > 2000) {
    throw new Error("MINIAPP_INPUT_TOO_LONG");
  }

  const style = normalizeMiniappCopyStyle(payload?.style);
  const styleConfig = MINIAPP_COPY_STYLES[style];
  const maxChars = normalizeMiniappMaxChars(payload?.maxChars ?? payload?.max_chars);
  const config = await getGenerationConfig({ enable_web_search: false });
  const { requestUrl, requestBody, logKind } = buildMiniappCopyGenerationRequest(
    inputText,
    styleConfig,
    maxChars,
    config,
  );

  logOutgoingAiCall(logKind, {
    url: requestUrl,
    provider: config.provider,
    authorizationBearer: maskSecret(config.apiKey),
    requestBody,
    clientPayloadSummary: {
      style,
      inputChars: [...inputText].length,
      maxChars,
    },
  });

  const data = await callTextGeneration(requestUrl, config.apiKey, requestBody);
  const resultText = clampMiniappCopyText(extractArticleMarkdown(data), maxChars);
  if (!resultText) {
    throw new Error("ARTICLE_EMPTY");
  }

  return {
    ok: true,
    id: `miniapp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    resultText,
    style,
    styleName: styleConfig.name,
    maxChars,
    meta: {
      model: data.model || config.model,
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
  const restoreSafeEditorSpans = (value) =>
    value
      .replace(/&lt;(\/?u)&gt;/g, "<$1>")
      .replace(
        /&lt;span\s+style=&quot;((?:color|background-color):#[0-9a-fA-F]{3,6}|font-size:(?:14|16|18|20|24)px)&quot;&gt;([\s\S]*?)&lt;\/span&gt;/g,
        '<span style="$1">$2</span>',
      );
  return restoreSafeEditorSpans(escapeHtml(text)
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
    .replace(/&lt;br\s*\/?&gt;/gi, "<br />"));
}

function markdownToHtml(markdown) {
  const lines = stripLeadingTitleHeading(markdown).replace(/\r\n/g, "\n").split("\n");
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

async function uploadWechatArticleImageFromDataUrl(dataUrl, accessToken, config) {
  const normalizedImageUrl = decodeHtmlEntities(dataUrl);
  const match = normalizedImageUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("WECHAT_ARTICLE_IMAGE_INVALID_CONTENT_TYPE:data-url");
  }

  const [, contentType, base64] = match;
  const imageBuffer = Buffer.from(base64, "base64");
  if (!imageBuffer.length) {
    throw new Error("WECHAT_ARTICLE_IMAGE_FETCH_FAILED:empty-data-url");
  }

  const imageBlob = new Blob([imageBuffer], { type: contentType });
  const formData = new FormData();
  formData.append("media", imageBlob, guessFilenameFromUrl("local-image", contentType));

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

async function resolveWechatArticleImageSrc(src, seen, accessToken, config) {
  const normalizedSrc = String(src || "").trim();
  if (/^data:image\//i.test(normalizedSrc)) {
    if (!seen.has(normalizedSrc)) {
      seen.set(normalizedSrc, uploadWechatArticleImageFromDataUrl(normalizedSrc, accessToken, config));
    }
    try {
      return await seen.get(normalizedSrc);
    } catch (error) {
      throw error instanceof Error ? error : new Error("WECHAT_ARTICLE_IMAGE_UPLOAD_FAILED");
    }
  }

  if (/^https?:\/\//i.test(normalizedSrc) && !isWechatHostedImageUrl(normalizedSrc)) {
    if (!seen.has(normalizedSrc)) {
      seen.set(normalizedSrc, uploadWechatArticleImageFromUrl(normalizedSrc, accessToken, config));
    }
    try {
      return await seen.get(normalizedSrc);
    } catch (error) {
      const message = error instanceof Error ? error.message : "WECHAT_ARTICLE_IMAGE_UPLOAD_FAILED";
      throw new Error(`${message}:${normalizedSrc}`);
    }
  }

  return normalizedSrc;
}

async function replaceExternalImagesForWechat(html, accessToken, config) {
  const imageAttrPattern = /(<(?:img|image)\b[^>]*?\b(?:src|href|xlink:href)\s*=\s*)(["'])(.*?)\2/gi;
  const seen = new Map();
  let hadMatch = false;

  const rewrittenParts = [];
  let lastIndex = 0;
  let match;

  while ((match = imageAttrPattern.exec(html)) !== null) {
    hadMatch = true;
    const [fullMatch, prefix, quote, rawSrc] = match;
    const matchStart = match.index;
    const matchEnd = matchStart + fullMatch.length;
    rewrittenParts.push(html.slice(lastIndex, matchStart));

    const src = String(rawSrc || "").trim();
    const replacementSrc = await resolveWechatArticleImageSrc(src, seen, accessToken, config);

    rewrittenParts.push(`${prefix}${quote}${replacementSrc}${quote}`);
    lastIndex = matchEnd;
  }

  if (!hadMatch) {
    return html;
  }

  rewrittenParts.push(html.slice(lastIndex));
  return rewrittenParts.join("");
}

function appendInlineStyle(attributes = "", style = "") {
  const normalizedAttributes = String(attributes || "");
  const normalizedStyle = String(style || "").trim();
  if (!normalizedStyle) return normalizedAttributes;

  if (/\sstyle\s*=/i.test(normalizedAttributes)) {
    return normalizedAttributes.replace(/\sstyle\s*=\s*(["'])(.*?)\1/i, (_match, quote, existingStyle) => {
      const mergedStyle = `${normalizedStyle}${String(existingStyle || "").trim().replace(/;?$/, ";")}`;
      return ` style=${quote}${mergedStyle}${quote}`;
    });
  }

  return `${normalizedAttributes} style="${normalizedStyle}"`;
}

function inlineWechatBlockStyles(html) {
  const stylesByTag = {
    h1: "font-size:22px;font-weight:600;color:#111111;line-height:1.5;margin:1.5em 0 0.75em;text-align:left;",
    h2: "font-size:20px;font-weight:600;color:#111111;line-height:1.5;margin:1.5em 0 0.75em;",
    h3: "font-size:18px;font-weight:600;color:#111111;line-height:1.5;margin:1.5em 0 0.75em;",
    h4: "font-size:17px;font-weight:600;color:#222222;line-height:1.55;margin:1.25em 0 0.65em;",
    p: "margin:0 0 1em;line-height:1.9;text-align:left;letter-spacing:0;word-break:break-word;",
    ul: "padding-left:1.4em;margin:0.9em 0;line-height:1.9;",
    ol: "padding-left:1.4em;margin:0.9em 0;line-height:1.9;",
    li: "margin-top:0.35em;",
    blockquote: "border-left:3px solid #e6e6e6;padding-left:12px;color:#666666;margin:1.1em 0;",
    img: "display:block;max-width:100%;height:auto;margin:1.2em auto;",
    a: "color:#576b95;text-decoration:none;word-break:break-all;",
    code: "background:#f5f5f5;padding:2px 4px;border-radius:3px;font-size:0.9em;",
    pre: "background:#f5f5f5;padding:12px;border-radius:6px;overflow-x:auto;",
    strong: "color:#111111;",
  };

  return Object.entries(stylesByTag).reduce((currentHtml, [tag, style]) => {
    const openTagPattern = new RegExp(`<${tag}\\b([^>]*)>`, "gi");
    return currentHtml.replace(openTagPattern, (_match, attributes) => `<${tag}${appendInlineStyle(attributes, style)}>`);
  }, String(html || ""));
}

function removeWechatBlankParagraphs(html) {
  return String(html || "")
    .replace(/<p\b[^>]*>\s*(?:<br\s*\/?>|&nbsp;|\s)*<\/p>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function wrapWechatHtml(contentHtml) {
  const inlinedContentHtml = inlineWechatBlockStyles(removeWechatBlankParagraphs(contentHtml));
  return `
<div style="font-size:16px;line-height:1.9;color:#2c2c2c;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:12px 0;">
  ${inlinedContentHtml}
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
