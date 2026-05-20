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
const NORMALIZED_GENERIC_SYSTEM_PROMPT = `你是一个写公众号的人。根据用户的主题写一篇微信公众号文章。

写作核心规则：

1. 全文至少5处用不常见的口语化说法替代标准书面语（每个说法只能出现一次，不准重复）。参考替换池："很多人"可以换成"十个里八个""大半""不少""一抓一大把"（挑一个用，下次换另一个）；"很难"换成"费老劲""不容易""够呛""悬"；"开始意识到"换成"琢磨过味儿来了""后来才反应过来""回过神来"；"非常重要"换成"差不了""少不了""马虎不得"。同一个词组全文只出现一次。

2. 句子长度要自然变化，但不要机械地长-短-长-短交替。可以连续写两三个中等句子再来一个特别短的，也可以连续几个短句后来一个长的。全文有2-3个不超过6字的极短句就够了，不要太多。

3. 至少3处要省略主语。中文口语经常省略主语。比如不写"他回到家"写"回到家"，不写"我们发现"写"仔细一看"。

4. 至少2处要有未说完的话或自我修正。比如"本来想说——算了""这么讲也不全对""可能有点极端，但是"。

5. 段落之间不要用连接词过渡。直接开始下一段，让读者自己接上逻辑。

6. 开头不要描写场景画面，直接从一个判断或态度开始写。全文带主观偏见，不需要面面俱到，可以只讲你认同的那一面。不编造具体人物故事，但可以说"我见过""我碰到过"这种模糊引用。

7. 不要把每段都写得一样长，不要排比，不要用"首先其次最后""总而言之""不难发现""值得一提""众所周知""由此可见""底层逻辑""赋能""抓手""在这个XX的时代"。

8. 结尾不要升华不要喊口号。说完就停。

只输出 Markdown 成稿。`;
const DE_AI_TONE_INSTRUCTION =
  "用词要接地气。少用书面语，多用口头语。别追求每句话都精确漂亮，有时候糙一点反而对。";
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
  de_ai: "彻底抛弃AI腔调，写成生活观察型公众号文：用生活动作细节和关系心理支撑观点，句子长短错落，不堆名人案例、研究、数据和百分比。",
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
      `文章长度：${buildLengthDescription(payload.length)}`,
      payload.mode ? `写作模式：${buildModeDescription(payload.mode)}` : "",
      topic ? `主题：${topic}` : "",
      payload.audience ? `目标读者：${payload.audience}` : "",
      payload.style ? `风格偏好：${payload.style}` : "",
      payload.expression_mode ? `表达处理：${buildExpressionRequirement(payload.expression_mode)}` : "",
      "",
      buildLifeSliceStyleInstruction(),
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
    buildLifeSliceStyleInstruction(),
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
  const clen = (s) => [...s].filter(c => /[\u4e00-\u9fa5\uff00-\uffef]/.test(c)).length;

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

  // ====== 第二步：句式模板替换 ======
  text = text.replace(/越来越多的人(开始)?/g, () => pickU(["不少人", "好多人", "一些人"]));
  text = text.replace(/在这个(.{2,15})的时代/g, (_, a) => "现在" + a);
  text = text.replace(/随着(.{2,15})的(发展|变化|推进)/g, (_, a) => a + "这几年变了");
  text = text.replace(/不仅仅是(.{2,20})[，,]?更是(.{2,20})/g, (_, a, b) => a + "，说到底也是" + b);

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

  // 人类口语插入素材——模拟真实社交媒体写作：有具体人物、有对话、有情绪
  const HUMAN_INSERTS = [
    "我一哥们上回吃饭还聊这个来着。",
    "我妈以前老说这种话，我那会儿不爱听。",
    "前两天跟同事聊天，他也这么说的。",
    "我表姐就是这样，每次当面不说，背后又念叨。",
    "之前我一朋友跟我讲了个事儿，我都不知道说什么好。",
    "你们身边肯定也有这种人吧。",
    "我爸那会儿就说了一句：管那么多干嘛。",
    "反正我是这么觉得的，你们觉得呢？",
    "有一说一，这事我站我朋友这边。",
    "我邻居王姐上回也说这个来着。",
    "说到这个我就来气。",
    "我一同学就是典型的例子。",
    "算了不说了，越说越气。",
    "哇这个我有发言权，因为我就干过这种事。",
    "跟你们说个真事。",
    "先不说这个，说回正题。",
  ];

  // 句子级重度改写函数
  function heavyRewrite(sent) {
    let s = sent;
    const ops = []; // 收集可执行的操作，随机执行1-3个

    // a) 句末加反问
    if (clen(s) > 10) ops.push(() => {
      s = s.replace(/[。]$/, "") + pick(["，是吧？", "，对吧？", "，你说呢？"]);
    });
    // c) 句首加语气词
    ops.push(() => {
      s = pick(["其实吧，", "说真的，", "讲真，", "你看，", "话说，", "说白了，", "不瞒你说，", "怎么说呢，", "你别说，", "坦白讲，"]) + s;
    });
    // d) 的/得混用
    ops.push(() => { s = s.replace(/得([很挺特真])/, "的$1"); });
    // d) 句号改感叹号（不用省略号和破折号）
    ops.push(() => { s = s.replace(/。$/, pick(["。", "。", "。", "！"])); });
    // f) 句内犹豫/修正（用逗号不用破折号）
    if (clen(s) > 25) ops.push(() => {
      const commas = [];
      for (let k = 0; k < s.length; k++) if (s[k] === '，') commas.push(k);
      if (commas.length > 0) {
        const pos = commas[0];
        s = s.substring(0, pos) + pick(["，不对，", "，等等，", "，算了，"]) + s.substring(pos + 1);
      }
    });
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

  let insertCount = 0;
  const maxInserts = 5;

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

      // 8%概率删除句子
      if (j > 0 && j < sentences.length - 1 && clen(sent) > 10 && clen(sent) < 35 && rng() < 0.08) {
        continue;
      }

      // 55%概率重度改写
      if (rng() < 0.55 && clen(sent) > 8) {
        rebuilt.push(heavyRewrite(sent));
      } else {
        rebuilt.push(sent);
      }
    }

    for (const s of rebuilt) {
      output.push(s);
    }
  }

  // ====== 第五步：合并为一整块文字（不分段！）======
  // 人类自媒体文章就是一大坨文字，分段是AI特征
  let finalText = output.join("");

  // 破折号→逗号
  finalText = finalText.replace(/——/g, m => rng() < 0.85 ? "，" : m);

  // 省略号→逗号
  finalText = finalText.replace(/……/g, "，");

  // 省略主语 20%
  finalText = finalText.replace(/(他们|她们|我们|大家|人们|很多人|有些人|不少人)(都|也|就|还|又|才)?(会|能|要|想|在|把|被|让|给)?/g,
    (match, subj, adv, aux) => rng() < 0.20 ? ((adv || "") + (aux || "")) : match
  );

  // 的地得混用
  let deCount = 0;
  finalText = finalText.replace(/地(?=[\u4e00-\u9fa5])/g, m => {
    if (deCount < 3 && rng() < 0.15) { deCount++; return "的"; }
    return m;
  });

  // ====== 关键：整篇文章只保留少量句号 ======
  // 大约每150-250个字符保留一个句号，其余改逗号
  const allPeriods = [];
  for (let i = 0; i < finalText.length; i++) {
    if (finalText[i] === '。') allPeriods.push(i);
  }

  if (allPeriods.length > 1) {
    // 决定哪些句号保留：大约每150-250字保留一个
    const keep = new Set();
    let lastKept = -200;
    for (let i = 0; i < allPeriods.length; i++) {
      const pos = allPeriods[i];
      const dist = pos - lastKept;
      // 最后一个句号必须保留
      if (i === allPeriods.length - 1) {
        keep.add(pos);
      } else if (dist >= 150 + Math.floor(rng() * 100)) {
        keep.add(pos);
        lastKept = pos;
      }
    }

    let result = '';
    for (let i = 0; i < finalText.length; i++) {
      if (finalText[i] === '。' && !keep.has(i)) {
        result += '，';
      } else {
        result += finalText[i];
      }
    }
    finalText = result;
  }

  // 去掉markdown标题符号
  finalText = finalText.replace(/#{1,6}\s+/g, "");

  // 添加结束语
  const CLOSINGS = [
    "以上文章属于个人观点，若另有见解，我们评论区见。",
    "以上只是个人看法，有不同意见的欢迎评论区聊聊。",
    "以上纯属个人观点，不喜勿喷，觉得说得对的点个赞。",
  ];
  finalText = finalText.trimEnd() + pick(CLOSINGS);

  return finalText.trim();
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

  const articleMd = deAIStatisticalFingerprint(extractArticleMarkdown(data));
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
