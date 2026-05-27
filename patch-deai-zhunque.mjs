import fs from 'fs';

const filePath = 'src/content-service.js';
let code = fs.readFileSync(filePath, 'utf8');

const hasCRLF = code.includes('\r\n');
if (hasCRLF) code = code.replace(/\r\n/g, '\n');

// 1. Replace NORMALIZED_GENERIC_SYSTEM_PROMPT if present
const systemPromptStart = code.indexOf('const NORMALIZED_GENERIC_SYSTEM_PROMPT = `');
const systemPromptEnd = code.indexOf('const CLASSIC_GENERIC_SYSTEM_PROMPT = `');

if (systemPromptStart !== -1 && systemPromptEnd !== -1) {
  const newSystemPrompt = `const NORMALIZED_GENERIC_SYSTEM_PROMPT = \`你是一个中文内容生成和改写助手。你的目标是直接生成自然、极具人类真实写作特征的公众号文章，能够完美避开所有 AI 文本检测系统（如朱雀检测）。

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

只输出最终的 Markdown 文本成稿，不要输出标题（不要用 # 号），不要输出任何解释、写作思路或前后对比。\`;\n\n`;

  code = code.slice(0, systemPromptStart) + newSystemPrompt + code.slice(systemPromptEnd);
  console.log('✅ Replaced NORMALIZED_GENERIC_SYSTEM_PROMPT');
} else {
  console.log('⚠️ NORMALIZED_GENERIC_SYSTEM_PROMPT already replaced or markers not found');
}

// 2. Replace buildSystemPrompt logic if present
const systemPromptLogicTarget = `  const inlineAigcDownInstructions = shouldInlineAigcDownRules(payload) ? getInlineAigcDownInstructions() : "";`;
const systemPromptLogicReplacement = `  const inlineAigcDownInstructions =
    shouldInlineAigcDownRules(payload) && promptVariant !== PROMPT_VARIANTS.AIGC
      ? getInlineAigcDownInstructions()
      : "";`;

if (code.includes(systemPromptLogicTarget)) {
  code = code.replace(systemPromptLogicTarget, systemPromptLogicReplacement);
  console.log('✅ Replaced buildSystemPrompt inline logic');
} else {
  console.log('⚠️ buildSystemPrompt inline logic already replaced');
}

// 3. Replace temperature in buildArkRequestBody if present
const tempTarget = `    temperature: 1.6,`;
const tempReplacement = `    temperature: 1.1,`;
if (code.includes(tempTarget)) {
  code = code.replace(tempTarget, tempReplacement);
  console.log('✅ Replaced temperature target to 1.1');
} else {
  console.log('⚠️ temperature target already replaced');
}

if (hasCRLF) code = code.replace(/\n/g, '\r\n');

fs.writeFileSync(filePath, code, 'utf8');
console.log('✅ Script execution complete!');
