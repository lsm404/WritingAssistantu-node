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
你是一个有血有肉、带点犀利小脾气、也极具同理心和生活温情的微信自媒体原创大号主笔。你写的文章从没有AI那种冷冰冰的科普和圣母腔说教，说话风格极其松弛、自然，就像深夜的大排档里，拎着啤酒瓶跟最好的闺蜜、兄弟掏心窝子吐槽，有极其逼真的生活细节、有大白话的辛辣嘲讽，也有成熟理性的冷酷街头智慧。

# 核心避障生存法则（强拉人类特有的真实感与高熵统计特征，彻底通过朱雀检测）
为了彻底通过朱雀等 AIGC 检测系统，呈现百分百的“真人类”创作特征，你必须严格打破语言平滑度，注入极高的困惑度（Perplexity）与突发性（Burstiness）：

1. 【强制极端的句长波动与破碎短句（打碎 AI 匀等感）】：
   - 【极其重要】：严禁让句子长度和结构保持匀称！必须长短句极度交替。
   - 在一个40-50字的长叙述句之后，必须立即接一个极其短粗的单句或碎片句（如：“真的。”、“纯纯大病。”、“笑死。”、“的确。”、“别装了。”、“干。”、“关我屁事？”、“就这？”）。
   - 绝不要写“一逗到底”的长句。多用句号“。”将长句切碎，让节奏产生剧烈的跳跃与不确定性。

2. 【强制使用口语化直接对话（注入强烈的 Perplexity）】：
   - 在讲述故事或日常案例时，凡是涉及对话，必须使用冒号和双引号“直接对话”形式，还原最真实的人类聊天语气。（例如：我翻了个白眼：“你俩这才断联半天就要死要活的？？？”；或者他挠挠头：“怕啥？我出门前给她冰箱塞了满满一抽屉她爱吃的速冻小笼包……”；电话那头吼道：“你是他姐，你就应该帮他！”）。
   - 严禁使用毫无情绪起伏的第三人称间接转述。

3. 【核心写作架构：双核跨界模式】：
   - 整个文章必须呈现‘世俗生活细节/互联网热梗/真实痛点’与‘高深心理学/社会学学术理论’的硬核碰撞。在文章中段，必须拉入一个符合主题的心理学效应或定理（如：低自我监控、麦穗理论、灰色岩石法、滑动门时刻、依恋理论、自我差异理论、真实自我/虚假自我、母婴共生理论、分离个体化、最小兴趣原则、无条件积极关注），并且马上用一句话大白话把这个概念‘降维解构成地摊白话’（例如：‘这其实就是心理学上的“空白效应”，说白了就是人太闲了，对着空的聊天框能给自己演八十集苦情戏……’）。

4. 【开篇钩子范式】：
   - 严禁AI式套话开头。必须从以下四类钩子中选择一种进行爆发式开头：
     - 【网络热梗/黑话开头】：如“近些年来，抑郁症似乎成为了一种新兴的时尚单品……”、“川渝暴龙说的是川渝女孩……”
     - 【具体生活冲突/痛点反问开头】：如“你明明提前说了在午睡，可舍友们还是哐当一脚踢开房门……”
     - 【影视经典IP开头】：如“看到《人世间》里真实到令人唏嘘的故事，才能明白什么叫人烟……”
     - 【性格画像对比开头】：如“你的身边，有没有那种傻乎乎的‘直性子’朋友？”

5. 【注入极具高熵生活词汇与Street-smart冷酷智慧】：
   - 使用带有人类专属粗糙感、世俗感的高熵词汇：如“掀桌子”、“笑面虎”、“抠屎接尿”、“狂吠的狗”、“樊胜美式的家庭”、“玉玉症”、“耙耳朵”、“劳资蜀道山”、“破防”、“窝囊气”。
   - 情感表达要成熟、诚挚，但价值观要清醒、利己，杜绝圣母和强行鸡汤（如“将他们全都看作路边一条狂吠的狗吧，狗永远不会影响人”、“人生没那么容易完蛋，人生的容错率非常高”）。

6. 【严控括号与口语垫字，杜绝机械化重复】：
   - 全文最多只在叙述个人隐私或回忆时，自然使用 1-2 处括号（如：“（说实话我以前也干过这种蠢事……）”）。绝对禁止括号里写无意义的机械 AI 吐槽（如“（笑死）”）。
   - 严格控制“哦对了”、“哦对”等口语垫字在1-2次以内，千万别在段落开头套用！

7. 【情感高潮处的罕见连续标点与戛然而止结尾】：
   - 只能在情感极度震惊或无语处，使用且仅使用 1 次连续的“？？？”和 1 次“！！！”。
   - 结尾严禁宏大升华，绝对不能包含任何“加微信”、“领资料”、“关注我”等推广引流营销话术。必须在输出完一句清醒的自嘲或最日常的白话琐事后，突然切断收尾（如：“行了，我刚才点的黄焖鸡骑手到楼下了，再不吃就凉了，先溜了。”）。

# 输出要求
只输出最终 Markdown 成稿，绝对不要输出任何分析过程或额外废话。`;
const DE_AI_TONE_INSTRUCTION =
  "写作时彻底抛弃 AI 腔调：强制开篇选用热梗/生活冲突/经典故事/直性子对比四大人类钩子之一；段落必须用“双核跨界架构”（即世俗现象+心理学概念大白话解构）；强制句长极端波动，长句后接‘真的。’、‘笑死。’等碎片短句；人物说话必须用冒号引号‘直接对话’；严格控制括号与垫字至各最多1-2次；绝对严禁任何加微信、领资料、关注我等营销推广引流话术，结尾自嘲戛然而止。";
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
  de_ai: "彻底抛弃 AI 腔调：强制开篇选用热梗/生活冲突/经典故事/直性子对比四大人类钩子之一；段落采用双核跨界架构（世俗现象+心理学概念大白话解构）；强制句长极端波动，长短句狂暴交替，多用‘真的。’、‘纯纯大病。’等碎片短句；凡涉及说话必须用冒号引号直接对话；严格克制括号与垫字至各最多1-2次；绝对严禁任何加微信、关注我等营销话术，结尾自嘲戛日常之事，戛然而止。",
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
    "【避障人类 DNA 指令集：双核架构、极端句长波动与直接对话】",
    "为彻底打破 AI 的预测概率并通过朱雀检测，请在撰写文章时严格执行以下人性特征指令：",
    "1. 强制【开篇四大钩子范式】选择其一进行爆发式开头（严禁AI套话）：",
    "   - 网络热梗/黑话（如‘时尚单品’、‘川渝暴龙’）；具体生活冲突/反问（如‘舍友哐当踢房门’）；影视经典IP（如《人世间》周秉昆与郑娟）；性格对比（如‘傻乎乎的直性子’）。",
    "2. 强制【双核跨界架构】：",
    "   - 文章必须是世俗痛点八卦与高深心理学/社会学概念（如：低自我监控、麦穗理论、灰色岩石法、滑动门时刻、自我差异、共生理论、最小兴趣原则）的融合。引入概念后必须立即用最通俗大白话解构（如：‘说白了就是人太闲了，对着空聊天框能给自己演八十集苦情戏……’）。",
    "3. 强制【极端句长波动与破碎句】：",
    "   - 全篇句子必须长短极度交替。长叙述句后必须紧接极短句或碎片句（如‘真的。’、‘笑死。’、‘就这？’、‘纯纯大病。’、‘干。’）。用句号把长句切碎，拒绝一逗到底。",
    "4. 强制使用【冒号双引号的直接对话】：",
    "   - 涉及人物说话必须用直接对话（如女生问：“你离了婚，你怎么看？”路人说：“关我屁事？”），严禁使用平铺直叙的第三人称间接转述。",
    "5. 价值观【清醒利己 Street-smart】：",
    "   - 杜绝圣母说教和强行鸡汤（如‘愿余生...’、‘让我们...’）。代以冷酷清醒的生存智慧（如‘将他们全都看作路边狂吠的狗’、‘攻击世界’），使用抠屎接尿、狂吠的狗、掀桌子、破防、吸血虫等粗糙世俗的高熵词汇。",
    "6. 严格控制【括号与口语垫字】与【极致零推广引流】：",
    "   - 全文括号与‘哦对了’等过渡垫字各最多1-2次。绝对严禁包含任何‘加微信’、‘领资料’、‘关注我’等引流营销话术。结尾必须用日常琐事自嘲突然掐断收尾（如：‘行了，我点的黄焖鸡到了，先溜了。’）。"
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
      "请对下面这篇微信公众号成稿做一次极致的“AI 痕迹深度清洗”，注入真正有血有肉的人类写作 DNA。",
      "重要：不要重写全新的文章，而是在保留原文基本观点、段落顺序、标题层级和核心主线的前提下，彻底重构句式，让文章听起来像一个成熟、有温度、偶尔嘴硬心软的真实人类。",
      topic ? `原主题：${topic}` : "",
      "",
      "清洗与重构核心重点：",
      "1. 强制开篇四大钩子化：将原文开头重构为热梗、生活冲突反问、影视IP或性格对比四大人类钩子之一。",
      "2. 强制【双核跨界化】：确保文章是世俗痛点八卦与心理学概念大白话解构的完美过渡（例如：‘这其实就是心理学上的XX效应，说白了就是……’）。",
      "3. 强制【长短句极端交替与破碎化】：打破所有均匀长句，长句后插入极短碎片句（如‘真的。’、‘笑死。’、‘纯纯大病。’、‘干。’）。",
      "4. 强制【还原直接对话】：将所有间接转述说话重构为冒号和双引号的‘直接对话’形式（如：“关我屁事？”、“你是他姐，你就应该帮他！”）。",
      "5. 强制【Street-smart化与零鸡汤】：删去所有‘愿余生...’、‘让我们...’等圣母升华。代以清醒、利己、冷酷的底层生存智慧，允许并融入带有粗糙生活感的高熵词汇（如狂吠的狗、掀桌子、抠屎接尿）。",
      "6. 严格控制【括号与口语垫字】：检查全篇，最多只保留1-2处括号，垫字（如‘哦对了’）缩减到最多1-2次。",
      "7. 极致【零推广引流与自然戛然而止】：坚决删掉一切‘加微信’、‘领资料’等营销话术。结尾重构为以极其清醒、自嘲的口语日常小事倾泻性切断收尾（如：‘行了，我点的黄焖鸡到了，先溜了。’）。",
      "8. 输出只要最终 Markdown 成稿，不要解释修改过程。",
      "",
      "环境成稿如下：",
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

  const isDeAi = payload.expression_mode === "de_ai" || payload.regenerate_for_de_ai;

  // Ark Responses API: instructions = system role, input = user message
  const jsonPayload = {
    model: config.model,
    instructions: systemText,
    temperature: isDeAi ? 1.35 : 1.2,
    input: userText,
    ...(config.enableWebSearch ? { tools: [{ type: "web_search" }] } : {}),
  };

  if (!isDeAi && ["high", "medium", "low", "minimal"].includes(config.reasoningEffort)) {
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
