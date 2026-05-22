import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAigcReplacementInstruction } from "./aigc-lexicon.js";

export const AIGC_DOWN_SKILL_NAME = "aigc-down-skill";
export const AIGC_DOWN_SKILL_VERSION = 1;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AIGC_DOWN_SKILL_FILE = path.join(__dirname, "..", "skills", AIGC_DOWN_SKILL_NAME, "SKILL.md");

const AIGC_DOWN_FALLBACK_RULES = `
# AIGC-Down：中文写作去 AI 味运行规则

你是一名中文写作编辑，负责在保留原文主题、结构、主要观点、段落顺序和大致长度的前提下，降低文本中的 AI 生成痕迹。不要重写成另一篇文章，不要新增事实、数据、案例、人物经历或引用。

这套规则来源于中文学术写作 AIGC-Down skill，但本系统用于文章生成时，必须保留原文体裁。如果原文是公众号文章，只迁移其中“打破模板化、减少 AI 写作模式”的方法，不要把它改成毕业论文或学术论文。

## 重点修复模式

1. 理论依据式起笔：减少“依据、基于、根据、按照、遵循”等公式化开头；需要保留理论、框架或观点时，把它移到段中，让现象、问题或判断先出现。
2. 段末套路总结：删除或改写“此案例印证了、此案例揭示了、由此可见、可以看出、这提示我们、综上所述”等重复性收尾。
3. 整齐并列结构：打破“首先、其次、再次、最后”和“三方面意义、三个维度、三重考量”等等长等重结构。让重要内容多说，次要内容少说。
4. 被动分析套话：减少“该设计基于、该处理体现了、这一做法展现了、上述选择印证了”等句式，改成更具体的判断、过程或理由。
5. 模板化问题陈述：少用“核心问题是、关键挑战在于、主要矛盾体现在”，改成具体情境、矛盾或设问。
6. 模糊归因：删除没有出处的“专家认为、研究表明、业内普遍认为、有观点认为、一些学者指出”。没有具体来源时，改为本文自己的分析判断。
7. 填充短语：删掉不承载信息的“值得注意的是、不难发现、需要指出的是、总体而言、事实上、与此同时”等。
8. 泛化积极结论：禁止用“具有重要意义、意义重大、意义深远、前景广阔、未来可期、提供了新思路、开辟了新方向”作空洞收尾。改成具体判断，或直接结束。
9. AI 高频词：每段控制在少量出现，优先替换“深刻揭示了、具有重要意义、综合运用、不可或缺、深入探讨、系统梳理、提供了理论支撑、有效解决了、充分说明、进一步”等。
10. 过度对仗和排比：减少四字并列、五字对偶、连续口号式表达，让句子长度有变化。
11. “作为/扮演/充当/发挥作用”堆砌：能直接说“是”的地方就直接说，不要绕。
12. 加粗和特殊格式：正文不要为了制造重点而大量加粗；保留原有 Markdown 结构，不新增装饰性格式。

## 改写原则

- 保真：不改变原文的论证方向、标题层级、核心观点和信息边界。
- 不编造：不新增真实世界案例、名人、数据、调查、论文、引用或私密经历。
- 有人味但不过度口语：加入自然的判断、限定、犹豫或转折，但不要故意写错字，不要生硬塞口头禅。
- 节奏有波动：长短句交替，允许少量轻微模式化作为自然噪声；不要把每段都改成同一种“人工风格”。
- 输出干净：只输出最终 Markdown 成稿，不要输出风险报告、解释、评分、自检清单或多个版本。
`.trim();

function readBundledSkill() {
  try {
    return fs.readFileSync(AIGC_DOWN_SKILL_FILE, "utf8").trim();
  } catch {
    return AIGC_DOWN_FALLBACK_RULES;
  }
}

function getAigcDownInstructions() {
  return [
    readBundledSkill(),
    "",
    buildAigcReplacementInstruction(),
    "",
    "## 部署运行补充",
    "",
    "本次调用发生在文章生成后的自动二次处理中。必须保留原文体裁；如果原文是公众号文章，不要改成论文。只输出最终 Markdown 成稿，不输出报告、评分、解释或多个版本。",
  ].join("\n");
}

export function buildAigcDownRequestBody(payload, config, articleMd, options = {}) {
  const topic = String(payload?.topic || "").trim();
  const mode = options.automatic ? "自动二次处理" : "手动去 AI 处理";

  const input = [
    `${mode}：请使用 AIGC-Down 规则处理下面这篇已经生成好的中文文章。`,
    topic ? `原主题：${topic}` : "",
    payload?.creation_mode ? `原创作模式：${payload.creation_mode}` : "",
    "",
    "硬性要求：",
    "1. 只输出改写后的最终 Markdown 成稿。",
    "2. 保留原文体裁、标题结构、段落顺序、主要观点和大致长度。",
    "3. 不要输出解释、报告、评分、前后对比或文件下载提示。",
    "4. 不要新增事实、数据、案例、引用、人物经历或外部信息。",
    "",
    "原文如下：",
    String(articleMd || "").trim(),
  ]
    .filter(Boolean)
    .join("\n");

  const requestBody = {
    model: config.model,
    instructions: getAigcDownInstructions(),
    temperature: 1.05,
    input,
  };

  if (["high", "medium", "low", "minimal"].includes(config.reasoningEffort)) {
    requestBody.reasoning = {
      effort: config.reasoningEffort,
    };
  }

  return requestBody;
}
