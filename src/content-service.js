import { getUserModelConfig } from "./auth-service.js";
import { getImageGenerationSettings, getTextGenerationSettings } from "./system-settings-service.js";

const DEFAULT_ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_WECHAT_BASE_URL = "https://api.weixin.qq.com";
const GEMINI_MODEL_ERROR_CODE = "GEMINI_MODEL_CONNECTING";
const ARTICLE_MIN_CHARS = 1000;
const ARTICLE_MAX_CHARS = 1500;
const PROMPT_VARIANTS = {
  AIGC: "aigc",
  CLASSIC: "classic",
};
const CLAUDE_MODEL_IDENTITY_INSTRUCTION = "你是 Claude 模型。";
const LEGACY_GENERIC_PROMPT_MARKERS = [
  "写出一篇真正像人类公众号作者深夜亲自写出来的内容",
  "## 3. 增加“作者存在感”",
  "你是一个真实公众号作者",
];
const NORMALIZED_GENERIC_SYSTEM_PROMPT = `你是一个写公众号的人，文化水平一般，说话比较啰嗦，不追求精炼。根据用户的主题写一篇微信公众号文章。

写作核心规则：

1. 全文至少5处用不常见的口语化说法替代标准书面语（每个说法只能出现一次，不准重复）。参考替换池："很多人"可以换成"大半""不少""一抓一大把"（挑一个用，下次换另一个）；"很难"换成"费老劲""不容易""够呛""悬"；"开始意识到"换成"琢磨过味儿来了""后来才反应过来""回过神来"；"非常重要"换成"差不了""少不了""马虎不得"。同一个词组全文只出现一次。

2. 多用语气词和虚词来模拟口语节奏，比如"嘛""呗""啊""吧""哦""嘛""呢""也是""这个""反正""其实""就是说""要我说""说白了""当然了""说起来"。每隔几句就自然地加一个，不要刻意堆砌，但也不能一个都没有。

3. 句子长度要自然变化。可以连续写两三个中等句子再来一个特别短的，也可以连续几个短句后来一个长的。不要机械地长-短-长-短交替。

4. 至少3处要省略主语。中文口语经常省略主语。比如不写"他回到家"写"回到家"，不写"我们发现"写"仔细一看"。

5. 至少2处要有未说完的话或自我修正。比如"本来想说——算了""这么讲也不全对""可能有点极端，但是"。

6. 开头不要描写场景画面，直接从一个判断或态度开始写。全文带主观偏见，不需要面面俱到，可以只讲你认同的那一面。不编造具体人物故事，但可以说"我见过""我碰到过"这种模糊引用。

7. 不要把每段都写得一样长，不要排比，不要用"首先其次最后""总而言之""不难发现""值得一提""众所周知""由此可见""底层逻辑""赋能""抓手""在这个XX的时代"。

8. 结尾不要升华不要喊口号。说完就停。

9. 绝对禁止使用任何特殊符号，包括：引号（""''「」『』""''）、省略号（……）、破折号（——）、书名号（《》〈〉）、分隔线（---或***）、任何箭头或特殊标点。全文只允许出现中文逗号（，）和中文句号（。），段落内部只能使用中文逗号，只有段落结尾才能使用中文句号。

10. 可以自然分段。每个段落内部以逗号连接，段尾用句号结束。段落之间直接换行，不要加连接词。

只输出 Markdown 成稿，不要输出标题（不要用 # 号）。`;
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
  "用词要接地气，土一点没关系。少用书面语，多用口头语。说话要啰嗦，多用语气词（嘛、呗、啊、吧、呢、反正、说白了、要我说等）。禁止使用任何引号、省略号、破折号、书名号等特殊符号，全文只允许中文逗号和中文句号。可以自然分段，段落内部只能用逗号连接，只在段落结尾用句号。";
const CLASSIC_DE_AI_TONE_INSTRUCTION =
  "我希望文本略有点生涩和稚嫩，用那种中文并不是很精通的人的语气撰写这个文本，稍微学术一点，态度端正一点，更多体现在语言上的大白话";
const STRICT_ARTICLE_LENGTH_DESCRIPTION = `严格控制在 ${ARTICLE_MIN_CHARS}-${ARTICLE_MAX_CHARS} 字，正文不要低于 ${ARTICLE_MIN_CHARS} 字，也不要超过 ${ARTICLE_MAX_CHARS} 字。`;
const BASIC_ARTICLE_FORMAT_INSTRUCTION = [
  `全文字数必须在 ${ARTICLE_MIN_CHARS}-${ARTICLE_MAX_CHARS} 字之间。`,
  "允许自然分段，段内只能使用中文逗号作为停顿标点。",
  "每一段只有段尾可以出现一个中文句号，段内不能出现句号、问号、感叹号、分号、冒号、省略号、破折号或其他标点。",
  "不要输出标题符号、列表符号或解释说明，只输出成稿正文。",
].join("\n");
const ARTICLE_FORMAT_INSTRUCTION = [
  BASIC_ARTICLE_FORMAT_INSTRUCTION,
  "补充大量得的、了、来着、那个、也就、吧之类的口语虚词",
].join("\n");
const AI_RULE_INSTRUCTIONS_MAX_CHARS = 5000;
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
const EXPRESSION_REQUIREMENTS = {
  standard: "通俗易懂，大白话，不装文化人。",
  conversational: "就像咱们现在面对面聊天一样，极度口语化，多用短促的句子。",
  de_ai: "彻底抛弃AI腔调，写成生活观察型公众号文：用生活动作细节和关系心理支撑观点，句子长短错落，不堆名人案例、研究、数据和百分比。",
  opinionated: "情绪极度饱满，爱憎分明，该激动就激动，带入强烈的个人主观色彩。",
};
const LENGTH_DESCRIPTIONS = {
  short: STRICT_ARTICLE_LENGTH_DESCRIPTION,
  medium: STRICT_ARTICLE_LENGTH_DESCRIPTION,
  long: STRICT_ARTICLE_LENGTH_DESCRIPTION,
};
const CLASSIC_LENGTH_DESCRIPTIONS = {
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

function getVariantFormatInstruction(variant) {
  return variant === PROMPT_VARIANTS.CLASSIC
    ? ""
    : ARTICLE_FORMAT_INSTRUCTION;
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

function clampArticleParagraphsToMax(segments, rng = Math.random) {
  const normalized = [];
  let total = 0;

  for (const raw of segments) {
    for (const segment of splitArticleParagraphs(raw, rng)) {
      const currentLength = countArticleCharacters(segment);
      if (total + currentLength <= ARTICLE_MAX_CHARS) {
        normalized.push(segment);
        total += currentLength;
        continue;
      }

      const remaining = ARTICLE_MAX_CHARS - total;
      if (remaining >= 80) {
        const trimmed = normalizeArticleSegmentText(segment.slice(0, Math.max(0, remaining - 1)));
        if (trimmed) normalized.push(trimmed);
      }
      return normalized;
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
  const formatInstruction = getVariantFormatInstruction(promptVariant);
  let text = String(payload.system_prompt || "").trim();
  if (LEGACY_GENERIC_PROMPT_MARKERS.every((marker) => text.includes(marker))) {
    text = defaultSystemPrompt;
  }
  if (!text) {
    text = defaultSystemPrompt;
  }
  if (!text.startsWith(CLAUDE_MODEL_IDENTITY_INSTRUCTION)) {
    text = `${CLAUDE_MODEL_IDENTITY_INSTRUCTION}\n\n${text}`;
  }
  const toneInstruction =
    promptVariant === PROMPT_VARIANTS.CLASSIC ? CLASSIC_DE_AI_TONE_INSTRUCTION : DE_AI_TONE_INSTRUCTION;
  const requiredRules = [
    text.includes(toneInstruction) ? "" : toneInstruction,
    formatInstruction && !text.includes("段内只能使用中文逗号") ? formatInstruction : "",
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
  const formatInstruction = getVariantFormatInstruction(promptVariant);
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
      promptVariant === PROMPT_VARIANTS.CLASSIC ? "" : buildLifeSliceStyleInstruction(),
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
    promptVariant === PROMPT_VARIANTS.CLASSIC ? "" : buildLifeSliceStyleInstruction(),
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


/**
 * 反AI检测后处理器 v10 —— 突发性策略
 * 核心思路：AI文本的困惑度均匀（每句都"标准"），人类文本的困惑度波动大
 * （有的句子很书面，有的句子很随意）。
 * 做法：~45%句子完全不动，~55%句子做重度改写 → 制造困惑度波动（burstiness）
 */
function deAIStatisticalFingerprint(markdown) {
  if (!markdown || typeof markdown !== "string") return markdown;

  const rng = () => Math.random();
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const clen = countArticleCharacters;

  const used = new Set();
  const pickU = (arr) => {
    const a = arr.filter(x => !used.has(x));
    if (!a.length) return pick(arr);
    const c = pick(a); used.add(c); return c;
  };

  let text = markdown;

  // ====== 第一步：删除AI指纹短语 ======
  const NUKE = [
    "值得一提的是，", "值得一提的是", "不难发现，", "不难发现",
    "众所周知，", "众所周知", "综上所述，", "综上所述",
    "由此可见，", "由此可见", "显而易见，", "显而易见",
    "毫无疑问，", "毫无疑问", "毋庸置疑，", "毋庸置疑",
    "首先，", "其次，", "最后，", "总之，",
    "因此，", "此外，", "同时，", "事实上，",
    "换言之，", "也就是说，", "一方面，", "另一方面，",
    "归根结底，", "不可否认，", "换句话说，",
    "在当今社会，", "随着社会的发展，", "从某种意义上说，",
    "某种程度上，", "不言而喻，", "与此同时，",
  ];
  for (const p of NUKE) {
    while (text.includes(p)) text = text.replace(p, "");
  }

  // ====== 第二步：句式模板替换（100+ 条）======
  // --- A. 时代/背景套话 ---
  text = text.replace(/越来越多的人(开始)?/g, () => pickU(["不少人", "好多人", "一些人", "很多人", "身边不少人"]));
  text = text.replace(/在这个(.{2,15})的时代[，,]?/g, () => pickU(["现在这年头，", "这几年，", "现在嘛，", "如今，"]));
  text = text.replace(/随着(.{2,15})的(发展|变化|推进|深入|普及)[，,]?/g, (_, a) => a + "这几年变化挺大的，");
  text = text.replace(/在(当今|现代|当代|如今)社会[，,]?/g, () => pickU(["现在这社会，", "现在嘛，", "这年头，"]));
  text = text.replace(/时代的(洪流|浪潮|车轮)[，,]?/g, () => "大势所趋，");
  text = text.replace(/顺应时代(潮流|发展|趋势)[，,]?/g, () => "跟上时代，");
  text = text.replace(/新时代(背景下|的今天|里)[，,]?/g, () => "现在这会儿，");
  text = text.replace(/在(历史|时代|社会)的(长河|进程|发展)中[，,]?/g, () => "这些年来，");
  // --- B. 说教/升华句 ---
  text = text.replace(/让我们(共同|一起)?(努力|奋斗|前行|加油|成长)/g, () => pickU(["大家一块儿加油吧", "一起努力就行了", "反正一起扛呗", "各自加把劲吧"]));
  text = text.replace(/我们(都)?需要(认真)?(思考|反思|面对|正视|审视)/g, () => pickU(["值得好好想想", "真得琢磨琢磨", "得认真对待这事", "这个不能不想"]));
  text = text.replace(/这(一点|件事|个问题)值得我们(深思|重视|关注|思考)/g, () => pickU(["这个挺值得琢磨的", "这事真得好好想想", "这个问题其实挺重要的"]));
  text = text.replace(/每个人(都)?(应该|需要|必须)(去)?(面对|思考|承担|重视)/g, () => pickU(["这事谁都躲不开", "每个人都得面对这个", "谁都一样，跑不掉"]));
  text = text.replace(/只有这样[，,]?才能(.{2,20})/g, (_, a) => "这么做了，才有可能" + a);
  text = text.replace(/唯有(.{2,15})[，,]?才能(.{2,20})/g, (_, a, b) => "只有" + a + "，才可能" + b);
  text = text.replace(/活出(真正的|属于自己的)?人生(意义|价值|精彩)/g, () => pickU(["活得像自己", "活出点样来", "好好过自己的日子"]));
  text = text.replace(/成为(更好的|更优秀的)?自己/g, () => pickU(["让自己好一点", "往好了走", "自己进步"]));
  // --- C. 转折/递进套话 ---
  text = text.replace(/不仅仅是(.{2,20})[，,]?更是(.{2,20})/g, (_, a, b) => a + "，说到底也是" + b);
  text = text.replace(/不仅如此[，,]?(.{3,30})/g, (_, a) => "而且，" + a);
  text = text.replace(/更重要的是[，,]?(.{3,30})/g, (_, a) => "更关键的是，" + a);
  text = text.replace(/与此同时[，,]?(.{3,30})/g, (_, a) => pickU(["同时呢，", "另外，", "还有就是，"]) + a);
  text = text.replace(/除此之外[，,]?(.{3,30})/g, (_, a) => "另外，" + a);
  text = text.replace(/值得一提的是[，,]?(.{3,30})/g, (_, a) => "顺带说一句，" + a);
  text = text.replace(/值得注意的是[，,]?(.{3,30})/g, (_, a) => "要注意的是，" + a);
  text = text.replace(/更为重要的是[，,]?(.{3,30})/g, (_, a) => "更重要的一点，" + a);
  text = text.replace(/尤为值得(关注|重视|注意)的是[，,]?(.{3,30})/g, (_, x, b) => "尤其是，" + b);
  // --- D. 归因/论证套话 ---
  text = text.replace(/这(也|就)是为什么(.{3,20})(的原因)?/g, (_, x, b) => "所以才会" + b.replace(/的原因$/, ""));
  text = text.replace(/归根结底[，,]?(.{3,30})/g, (_, a) => pickU(["说到底，", "追根到底，", "根子上，"]) + a);
  text = text.replace(/从本质上(来说|来看|讲)[，,]?(.{3,30})/g, (_, x, b) => "说白了，" + b);
  text = text.replace(/从某种意义上(来说|来看|讲)[，,]?(.{3,30})/g, (_, x, b) => "某种程度上，" + b);
  text = text.replace(/从长远(来看|来说|角度)[，,]?(.{3,30})/g, (_, x, b) => "往长远了想，" + b);
  text = text.replace(/从根本上(来说|来看|讲)[，,]?(.{3,30})/g, (_, x, b) => "根本上，" + b);
  text = text.replace(/正(如|像)(.{2,15})(所)?说(的那样)?[，,]?/g, (_, x, b) => b + "这话说得对，");
  text = text.replace(/这(背后|深处)隐藏着?(.{2,20})/g, (_, x, b) => "这背后其实是" + b);
  text = text.replace(/这(无疑|确实)是(.{3,25})(的体现|的证明|的反映)/g, (_, x, b) => "这说明" + b);
  text = text.replace(/这(充分)?(说明|证明|表明|揭示)了?(.{3,25})/g, (_, x, y, c) => "这其实就是说，" + c);
  text = text.replace(/由此(可以)?(看出|得出|发现|推断)[，,]?(.{3,30})/g, (_, x, y, c) => "所以说，" + c);
  text = text.replace(/可以(看出|看到|发现|得出)[，,]?(.{3,30})/g, (_, x, b) => "能看出来，" + b);
  // --- E. 假设/条件句 ---
  text = text.replace(/假如(.{2,20})[，,]?那么(.{3,25})/g, (_, a, b) => "要是" + a + "，那" + b);
  text = text.replace(/一旦(.{2,20})[，,]?就(会|能|可能)?(.{3,25})/g, (_, a, x, b) => "等" + a + "了，就" + b);
  text = text.replace(/无论(.{2,12})(如何|怎样|怎么)[，,]?/g, (_, b) => "不管" + b + "咋样，");
  text = text.replace(/不管(遇到)?什么(样的)?(困难|挑战|问题|情况)[，,]?/g, () => "不管碰上什么事，");
  text = text.replace(/在任何(情况|时候|时刻)(下|里)?[，,]?/g, () => "任何时候，");
  // --- F. 强调/肯定套话 ---
  text = text.replace(/毫无疑问[，,]?(.{3,30})/g, (_, a) => pickU(["这个没跑，", "肯定，", "这毫无悬念，"]) + a);
  text = text.replace(/众所周知[，,]?(.{3,30})/g, (_, a) => pickU(["大家都知道，", "这个不用说，", "谁都知道，"]) + a);
  text = text.replace(/不可否认[，,]?(.{3,30})/g, (_, a) => pickU(["得承认，", "没法否认，", "这个确实，"]) + a);
  text = text.replace(/显而易见[，,]?(.{3,30})/g, (_, a) => pickU(["一眼就能看出来，", "很明显，", "这还用说，"]) + a);
  text = text.replace(/不言而喻[，,]?(.{3,30})/g, (_, a) => "这个不用解释，" + a);
  text = text.replace(/毋庸置疑[，,]?(.{3,30})/g, (_, a) => "这点不用怀疑，" + a);
  text = text.replace(/理所当然[，,]?(.{3,30})/g, (_, a) => "当然，" + a);
  text = text.replace(/无可厚非[，,]?(.{3,30})/g, (_, a) => "也说得过去，" + a);
  text = text.replace(/无可辩驳[，,]?(.{3,30})/g, (_, a) => "这个反驳不了，" + a);
  text = text.replace(/这是毋庸置疑的/g, () => "这个跑不掉");
  text = text.replace(/这是不争的(事实|道理)/g, () => "这是实打实的");
  // --- G. 承认/转折套话 ---
  text = text.replace(/我们(不得不|必须)承认[，,]?(.{3,30})/g, (_, x, b) => "不得不说，" + b);
  text = text.replace(/诚然[，,]?(.{3,30})/g, (_, a) => "当然了，" + a);
  text = text.replace(/固然[，,]?(.{3,30})/g, (_, a) => "确实，" + a);
  text = text.replace(/当然[，,]?这(并不|不)意味着(.{3,25})/g, (_, x, b) => "当然，这不是说" + b);
  text = text.replace(/尽管如此[，,]?(.{3,30})/g, (_, a) => "就算这样，" + a);
  text = text.replace(/话虽如此[，,]?(.{3,30})/g, (_, a) => "这么说是这么说，不过，" + a);
  text = text.replace(/即便如此[，,]?(.{3,30})/g, (_, a) => "就算这样，" + a);
  text = text.replace(/尽管(.{3,20})[，,]?但(是)?(.{3,25})/g, (_, a, x, b) => "虽说" + a + "，不过" + b);
  // --- H. 主语"我们"宣言句 ---
  text = text.replace(/我们(每个人)?(都)?(有责任|有义务|应该|需要)(.{2,20})/g, (_, x, y, z, d) => "大家都得" + d);
  text = text.replace(/我们(一起|共同)(创造|构建|打造|守护)(.{2,15})/g, (_, x, y, c) => "一块儿把" + c + "搞好");
  text = text.replace(/我们(坚信|相信|深信)(.{3,25})/g, (_, x, b) => "说真的，" + b + "，这个我是信的");
  // --- I. "这是一个X的X"结构 ---
  text = text.replace(/这是一个(.{2,15})的问题/g, (_, a) => "这事吧，" + a + "，确实不简单");
  text = text.replace(/这是一个(.{2,15})的时代/g, () => pickU(["现在这年头，", "如今这社会，"]));
  text = text.replace(/这种(现象|情况|问题).{0,10}(越来越|日益|逐渐)?(常见|普遍|突出|严重)/g, () => pickU(["这种事现在挺多的", "这情况也不少见", "这事其实挺普遍的"]));
  // --- J. 过程/阶段句 ---
  text = text.replace(/在(.{2,10})的过程中[，,]?我们?/g, (_, a) => "做" + a + "这件事的时候");
  text = text.replace(/经过(.{2,15})的(努力|积累|沉淀|磨练)[，,]?/g, (_, a) => "熬过了" + a + "之后，");
  text = text.replace(/经历了(.{2,15})之后[，,]?/g, (_, a) => a + "这一关过了，");
  text = text.replace(/在(.{2,10})的(道路|旅程|过程)上[，,]?/g, (_, a) => "走在" + a + "这条路上，");
  text = text.replace(/在(.{2,10})的(磨砺|锤炼|历练)中[，,]?/g, (_, a) => "经历过" + a + "之后，");
  // --- K. 方面/领域句 ---
  text = text.replace(/在(.{2,10})方面[，,]?/g, (_, a) => "说到" + a + "这块，");
  text = text.replace(/在(.{2,10})(领域|行业|范畴)[，,]?/g, (_, a) => a + "这行，");
  text = text.replace(/对于(.{2,15})(而言|来说|来讲)[，,]?/g, (_, a) => "对" + a + "来说，");
  text = text.replace(/就(.{2,15})(而言|来说|来讲)[，,]?/g, (_, a) => "说到" + a + "，");
  // --- L. 感受/无法描述句 ---
  text = text.replace(/(这|那)种(感觉|体验|心情|滋味)是无法(用语言)?(描述|言说|形容)的/g, () => pickU(["这感觉真说不出来", "怎么说呢，就是说不明白", "这个，嗯，真挺难描述"]));
  text = text.replace(/(这|那)种(感觉|体验|心情|滋味)难以(言说|言表|形容|描述)/g, () => "这个感受，说也说不清楚");
  text = text.replace(/内心(深处)?(的)?(感受|触动|共鸣|波动)/g, () => pickU(["心里那种感觉", "心里头", "内心里"]));
  text = text.replace(/让(人|我们)(感到|觉得)(无比)?(温暖|感动|震撼|欣慰)/g, (_, x, y, z, d) => "真挺" + d + "的");
  // --- M. 深度/意义句 ---
  text = text.replace(/其(深层|背后)(原因|逻辑|本质)[，,]?是(.{3,25})/g, (_, x, y, c) => "背后的原因嘛，是" + c);
  text = text.replace(/(值得|令人)(深思|深省|玩味|反思)(的是)?[，,]?(.{3,30})/g, (_, x, y, z, d) => "让人想想，" + d);
  text = text.replace(/折射出(.{3,25})/g, (_, a) => "其实反映了" + a);
  text = text.replace(/映射出(.{3,25})/g, (_, a) => "说明了" + a);
  text = text.replace(/这(其中|里面)蕴含着?(.{3,25})/g, (_, x, b) => "这里头其实有" + b);
  // --- N. 总结/收尾套话 ---
  text = text.replace(/综上所述[，,]?(.{3,30})/g, (_, a) => "总的来说，" + a);
  text = text.replace(/总而言之[，,]?(.{3,30})/g, (_, a) => pickU(["反正，", "总之，", "一句话，"]) + a);
  text = text.replace(/总(的来说|结一下|体来说)[，,]?(.{3,30})/g, (_, x, b) => "总的来说，" + b);
  text = text.replace(/一言以蔽之[，,]?(.{3,30})/g, (_, a) => "一句话，" + a);
  text = text.replace(/简而言之[，,]?(.{3,30})/g, (_, a) => "简单说就是，" + a);
  text = text.replace(/总体而言[，,]?(.{3,30})/g, (_, a) => "整体上，" + a);
  // --- O. 高频AI其他句式 ---
  text = text.replace(/这(充分)?(体现|彰显|展现)了?(.{3,25})(的重要性|的价值|的意义)?/g, (_, x, y, c) => "这说明" + c + "确实重要");
  text = text.replace(/我们(应该|需要|必须)(正视|审视|重视|关注)(.{2,20})/g, (_, x, y, c) => "这个" + c + "，得好好对待");
  text = text.replace(/在(.{2,10})的(指引|引领|带领|推动)(下|之下)[，,]?/g, (_, a) => "靠着" + a + "，");
  text = text.replace(/以(.{2,10})为(导向|目标|核心|宗旨)[，,]?/g, (_, a) => "奔着" + a + "去，");
  text = text.replace(/(.{2,12})的(重要性|必要性|紧迫性)(不言而喻|显而易见|毋庸置疑)/g, (_, a) => a + "这事，还是挺重要的");
  text = text.replace(/我们(正处于|处于|身处)(.{2,15})(的)?(时代|阶段|时期|关键节点)/g, () => pickU(["现在这时候，", "这年头，", "如今，"]));
  text = text.replace(/面对(.{2,15})(的)?(挑战|压力|困境|困难)[，,]?/g, (_, a) => "碰上" + a + "这事，");
  text = text.replace(/(.{2,15})的(核心|关键|本质|精髓)(在于|是)(.{3,25})/g, (_, a, x, y, d) => a + "最关键的，其实是" + d);
  text = text.replace(/这(给我们|提醒我们|告诉我们)(.{3,30})/g, (_, x, b) => "这说明，" + b);
  text = text.replace(/由此(可见|可知|可以看出)[，,]?(.{3,30})/g, (_, x, b) => "这么一来就知道，" + b);
  text = text.replace(/这(就|也)意味着(.{3,30})/g, (_, x, b) => "这也就是说，" + b);
  text = text.replace(/换(句话说|言之|个角度)[，,]?(.{3,30})/g, (_, x, b) => "说白了，" + b);
  text = text.replace(/说到底[，,]?(.{3,30})/g, (_, a) => "说白了，" + a);
  text = text.replace(/这(是|也是)(一种|一个)(必然|必然的)(结果|趋势|选择)/g, () => "这也没啥好奇怪的");
  text = text.replace(/(不断|持续)(提升|提高|改善|优化)(.{2,15})/g, (_, x, y, c) => "把" + c + "慢慢做好");
  text = text.replace(/实现(.{2,15})(的)?(目标|梦想|愿望|理想)/g, (_, a) => "把" + a + "做成");
  text = text.replace(/(.{2,10})是(我们|每个人|大家)(共同)?(追求|向往|渴望)的/g, (_, a) => "大家都想要" + a);
  text = text.replace(/这(说明|表明|证明)了?一个道理[，,]?(.{3,30})/g, (_, x, b) => "这事其实说明，" + b);
  text = text.replace(/很多时候[，,]?(.{3,30})/g, (_, a) => pickU(["有时候，", "不少时候，", "很多情况下，"]) + a);
  text = text.replace(/在某种程度上[，,]?(.{3,30})/g, (_, a) => "多少有点，" + a);
  text = text.replace(/从某种角度(来)?(看|说|讲)[，,]?(.{3,30})/g, (_, x, y, c) => "换个角度看，" + c);
  text = text.replace(/事实上[，,]?(.{3,30})/g, (_, a) => pickU(["其实，", "说真的，", "讲真，"]) + a);
  text = text.replace(/实际上[，,]?(.{3,30})/g, (_, a) => pickU(["其实，", "说白了，", "实话说，"]) + a);
  text = text.replace(/追根溯源[，,]?(.{3,30})/g, (_, a) => "往根儿上追，" + a);
  text = text.replace(/殊不知[，,]?(.{3,30})/g, (_, a) => "其实人不知道的是，" + a);
  text = text.replace(/其实不然[，,]?(.{3,30})/g, (_, a) => "其实不是这回事，" + a);
  text = text.replace(/恰恰相反[，,]?(.{3,30})/g, (_, a) => "反倒是，" + a);
  text = text.replace(/出乎意料(的是)?[，,]?(.{3,30})/g, (_, x, b) => "没想到，" + b);
  text = text.replace(/令人(惊讶|惊喜|意外|诧异)(的是)?[，,]?(.{3,30})/g, (_, x, y, c) => "没想到，" + c);

  // ====== 第三步：词汇替换（保留，这部分有用）======
  const S = [
    ["然而", ["可", "但", "不过", "话说回来"]],
    ["因此", ["所以", "那", "这么一来"]],
    ["此外", ["另外", "还有", "对了"]],
    ["尽管", ["虽说", "虽然", "就算"]],
    ["但是", ["但", "可", "不过", "偏偏"]],
    ["并且", ["而且", "还", "加上"]],
    ["非常", ["挺", "特别", "贼", "太"]],
    ["实际上", ["其实", "说白了", "讲真"]],
    ["逐渐", ["慢慢", "一点点"]],
    ["导致", ["搞得", "弄得", "闹得"]],
    ["如果", ["要是", "万一"]],
    ["往往", ["动不动就", "总", "老"]],
    ["已经", ["都", "早就", "早"]],
    ["需要", ["得", "要"]],
    ["能够", ["能", "可以"]],
    ["进行", ["做", "搞", "弄"]],
    ["那么", ["那", "那样的话"]],
    ["或许", ["可能", "没准", "说不定"]],
    ["获得", ["拿到", "得到"]],
    ["关于", ["说到", "讲到", "提到"]],
    ["总是", ["老是", "动不动就", "一直"]],
    ["并非", ["不是", "也不算"]],
    ["通常", ["一般", "多半"]],
    ["显然", ["明摆着", "一看就"]],
    ["大量", ["一堆", "好多"]],
    ["频繁", ["老是", "三天两头"]],
    ["持续", ["一直", "没断过"]],
    ["迅速", ["很快", "麻溜"]],
    ["普遍", ["到处都是", "哪都有"]],
    ["充分", ["好好", "彻底"]],
    ["面临", ["碰上", "遇到"]],
    ["目前", ["现在", "眼下"]],
    ["仿佛", ["好像", "像"]],
    ["似乎", ["好像", "感觉"]],
    ["困难", ["费劲", "够呛", "头疼"]],
    ["有效", ["管用", "好使"]],
    ["必然", ["肯定", "跑不了"]],
    ["潜移默化", ["不知不觉"]],
    ["大多数", ["多半", "基本上都"]],
    ["几乎", ["差不多", "基本上"]],
    ["越来越", ["慢慢"]],
    ["经常", ["三天两头", "动不动"]],
    ["尤其", ["更别说", "特别是"]],
    ["或者", ["要不", "不然"]],
    ["存在", ["有", "出了"]],
    ["极其", ["特别", "贼"]],
    ["引发", ["惹出", "招来"]],
    ["具备", ["有", "带着"]],
    ["明显", ["明摆着", "一看就知道"]],
    ["严重", ["不轻", "够受的"]],
    ["丰富", ["花样多", "五花八门"]],
    ["偶尔", ["隔三差五", "有时候"]],
  ];

  for (const [w, alts] of S) {
    if (text.includes(w)) {
      text = text.split(w).map((p, i, a) =>
        i === a.length - 1 ? p : p + (rng() < 0.85 ? pickU(alts) : w)
      ).join("");
    }
  }

  // ====== 第四步（核心）：选择性重度改写 → 制造burstiness ======
  const paragraphs = text.split(/\n\n+/);
  const output = [];

  // 句子级重度改写函数
  function heavyRewrite(sent) {
    let s = sent;
    const ops = []; // 收集可执行的操作，随机执行1-3个

    // a) 句末加反问
    if (clen(s) > 10) ops.push(() => {
      s = s.replace(/[。]$/, "") + pick(["，是吧？", "，对吧？", "，你说呢？"]);
    });
    // c) 句首加语气词
    // ops.push(() => {
    //   s = pick(["其实吧，", "说真的，", "讲真，", "你看，", "话说，", "说白了，", "不瞒你说，", "怎么说呢，", "你别说，", "坦白讲，"]) + s;
    // });
    // d) 的/得混用
    ops.push(() => { s = s.replace(/得([很挺特真])/, "的$1"); });
    // d) 句号改感叹号（不用省略号和破折号）
    ops.push(() => { s = s.replace(/。$/, pick(["。", "。", "。", "！"])); });
    // f) 句内犹豫/修正（用逗号不用破折号）
    // if (clen(s) > 25) ops.push(() => {
    //   const commas = [];
    //   for (let k = 0; k < s.length; k++) if (s[k] === '，') commas.push(k);
    //   if (commas.length > 0) {
    //     const pos = commas[0];
    //     s = s.substring(0, pos) + pick(["，不对，", "，等等，", "，算了，"]) + s.substring(pos + 1);
    //   }
    // });
    // g) 把"不"变成"又不是""也不"
    ops.push(() => {
      s = s.replace(/不([是会能想要])/, (m, c) => rng() < 0.5 ? "又不" + c : "也不" + c);
    });
    // i) 加口语尾巴
    ops.push(() => {
      s = s.replace(/。$/, pick(["嘛。", "呗。", "啊。", "罢了。"]));
    });

    // j) 句中加填充词（口语高频特征）
    if (clen(s) > 22) ops.push(() => {
      const commas = [];
      for (let k = 0; k < s.length; k++) if (s[k] === '，') commas.push(k);
      if (commas.length > 0) {
        const pos = commas[Math.floor(rng() * commas.length)];
        const filler = pick(["就是那个", "怎么说呢", "反正就是"]);
        s = s.substring(0, pos + 1) + filler + "，" + s.substring(pos + 1);
      }
    });

    // 随机执行1-2个操作（不要太多，避免过度改写）
    const count = 1 + Math.floor(rng() * Math.min(2, ops.length));
    const shuffled = ops.sort(() => rng() - 0.5).slice(0, count);
    for (const op of shuffled) op();

    return s;
  }

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const para = paragraphs[pi].trim();
    if (!para) continue;

    // 标题/列表不动
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

      // 保留句子，避免后处理把正文压到 1000 字以下。

      // 55%概率重度改写
      // if (rng() < 0.55 && clen(sent) > 8) {
      //   rebuilt.push(heavyRewrite(sent));
      // } else {
      //   rebuilt.push(sent);
      // }
      rebuilt.push(sent);
    }

    if (rebuilt.length) {
      output.push(rebuilt.join(""));
    }
  }

  let finalParagraphs = clampArticleParagraphsToMax(output, rng);
  if (finalParagraphs.length === 0) {
    finalParagraphs = clampArticleParagraphsToMax([text], rng);
  }

  return finalParagraphs.join("\n\n").trim();
}

function classicArticlePostprocess(markdown) {
  return typeof markdown === "string" ? markdown.trim() : markdown;
}

function postprocessArticleMarkdown(markdown, payload) {
  return resolvePromptVariant(payload) === PROMPT_VARIANTS.CLASSIC
    ? classicArticlePostprocess(markdown)
    : deAIStatisticalFingerprint(markdown);
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
      prompt_variant: resolvePromptVariant(payload),
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

  const promptVariant = resolvePromptVariant(payload);
  const articleMd = postprocessArticleMarkdown(extractArticleMarkdown(data), payload);
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
      prompt_variant: promptVariant,
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
