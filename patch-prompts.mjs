import { readFileSync, writeFileSync } from "fs";

const file = "d:/auto/node-backend/src/content-service.js";
let src = readFileSync(file, "utf8");

// ── 1. 修复 buildArkRequestBody：system prompt → instructions 字段，user 只发用户请求 ──
src = src.replace(
  /function buildArkRequestBody\(payload, config\) \{[\s\S]*?\n\}/,
  `function buildArkRequestBody(payload, config) {
  const systemText = buildSystemPrompt(payload);
  const userText = buildUserPrompt(payload);

  // Ark Responses API: instructions = system role, input = user message
  return {
    model: config.model,
    instructions: systemText,
    temperature: 1.1,
    input: userText,
    ...(config.enableWebSearch ? { tools: [{ type: "web_search" }] } : {}),
  };
}`
);

// ── 2. buildSystemPrompt：用户 system_prompt 直接透传，不加任何规范化内容 ──
src = src.replace(
  /function buildSystemPrompt\(payload\) \{[\s\S]*?\n\}/,
  `function buildSystemPrompt(payload) {
  return (
    payload.system_prompt?.trim() ||
    "我是个写了好几年公号的人。写完直接给稿。"
  );
}`
);

// ── 3. buildUserPrompt：把字数硬限制和「像人一样写」都写进去 ──
src = src.replace(
  /function buildUserPrompt\(payload\) \{[\s\S]*?\n\}/,
  `function buildUserPrompt(payload) {
  const lengthStr = buildLengthDescription(payload.length);
  const extras = [
    payload.audience?.trim() ? \`读者是\${payload.audience.trim()}\` : "",
    payload.style?.trim() ? \`感觉上偏\${payload.style.trim()}\` : "",
    payload.mode && payload.mode !== "standard" ? buildModeDescription(payload.mode) : "",
    payload.expression_mode && payload.expression_mode !== "standard"
      ? buildExpressionDescription(payload.expression_mode)
      : "",
  ]
    .filter(Boolean)
    .join("，");

  const humanInstructions = [
    "字数" + lengthStr + "，宁少勿多，严格控制在1000字以内。",
    "句子长短不均匀，有的段落就一两句，有的多几句，不要平均分布。",
    "至少有一处明显的岔题——说着说着扯到另一件事，再拉或不拉回来都行。",
    "结尾不给总结，说完就停。",
    "标点可以随意，逗号接逗号也行，不用每段都用句号收。",
  ].join(" ");

  if (payload.creation_mode === "rewrite") {
    const topic = payload.topic?.trim() ? \`，方向是\${payload.topic.trim()}\` : "";
    const rewriteMeta = \`改写目标：\${payload.rewrite_goal || "new_article"}，参考重点：\${payload.reference_focus || "mixed"}，参考强度：\${payload.reference_level || "medium"}。\`;
    const lead = extras
      ? \`下面这篇拿去改一下\${topic}，\${extras}，\${rewriteMeta}\`
      : \`下面这篇拿去改一下\${topic}，\${rewriteMeta}\`;
    return [lead, humanInstructions, "", payload.source_article?.trim() || ""].filter(Boolean).join("\\n");
  }

  const topic = payload.topic.trim();
  const lead = extras
    ? \`聊一下「\${topic}」，\${extras}。\`
    : \`聊一下「\${topic}」。\`;
  return \`\${lead}\\n\${humanInstructions}\`;
}`
);

// ── Verify ──
console.log("instructions field:", src.includes("instructions: systemText"));
console.log("temperature 1.1:", src.includes("temperature: 1.1"));
console.log("1000字:", src.includes("严格控制在1000字以内"));
console.log("岔题:", src.includes("至少有一处明显的岔题"));
console.log("buildUserPrompt ok:", src.includes("humanInstructions"));

writeFileSync(file, src, "utf8");
console.log("Done.");
