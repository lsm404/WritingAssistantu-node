import fs from 'fs';
import path from 'path';

const filePath = path.resolve('src/content-service.js');
let code = fs.readFileSync(filePath, 'utf8');

const startMarker = 'function deAIStatisticalFingerprint(markdown) {';
const endMarker = 'export async function generateArticleContent(payload, userId = null) {';

const startIndex = code.indexOf(startMarker);
const endIndex = code.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
  console.error('Error: Could not find start or end marker!');
  process.exit(1);
}

const replacement = `function deAIStatisticalFingerprint(markdown) {
  if (!markdown || typeof markdown !== "string") return markdown;

  const rng = () => Math.random();
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

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
  text = text.replace(/越来越多的人(开始)?/g, () => pick(["不少人", "好多人", "一些人"]));
  text = text.replace(/在这个(.{2,15})的时代/g, (_, a) => "现在" + a);
  text = text.replace(/随着(.{2,15})的(发展|变化|推进)/g, (_, a) => a + "这几年变了");
  text = text.replace(/不仅仅是(.{2,20})[，,]?更是(.{2,20})/g, (_, a, b) => a + "，说到底也是" + b);

  // ====== 第三步：词汇替换（临时禁用，防止破坏段落结构） ======

  // ====== 第四步（核心）：段落处理（恢复随机/自然分段，段内只允许逗号，结尾才是句号） ======
  const paragraphs = text.split(/\\n\\n+/);
  const outputParagraphs = [];

  for (let pi = 0; pi < paragraphs.length; pi++) {
    let para = paragraphs[pi].trim();
    if (!para) continue;

    // 标题/列表/引用等特殊格式不动
    if (/^#{1,6}\\s/.test(para) || /^[-*+]\\s/.test(para) ||
        /^\\d+[.、]\\s/.test(para) || /^>/.test(para)) {
      outputParagraphs.push(para);
      continue;
    }

    // A) 破折号、省略号转换为逗号
    para = para.replace(/——/g, m => rng() < 0.85 ? "，" : m);
    para = para.replace(/……/g, "，");

    // B) 主语省略 & 的地得混用
    para = para.replace(/(他们|她们|我们|大家|人们|很多人|有些人|不少人)(都|也|就|还|又|才)?(会|能|要|想|在|把|被|让|给)?/g,
      (match, subj, adv, aux) => rng() < 0.20 ? ((adv || "") + (aux || "")) : match
    );
    let deCount = 0;
    para = para.replace(/地(?=[\\u4e00-\\u9fa5])/g, m => {
      if (deCount < 3 && rng() < 0.15) { deCount++; return "的"; }
      return m;
    });

    // C) 段内只允许逗号，结尾才是句号
    // 将所有句末/句内句号、感叹号、问号替换成逗号
    para = para.replace(/[。！？!?]/g, "，");

    // 合并连续的逗号
    para = para.replace(/，+/g, "，");
    para = para.replace(/,+/g, "，");

    // 去除段尾的所有逗号和空格
    para = para.trim().replace(/[，,]+$/, "");

    // 段尾强制加上中文句号
    if (para) {
      para += "。";
    }

    outputParagraphs.push(para);
  }

  // ====== 第五步：合并段落并返回 ======
  let finalText = outputParagraphs.join("\\n\\n");

  // 引号删除（引号是AI指纹）
  finalText = finalText.replace(/["'“”‘’「」『』【】]/g, "");

  // 去掉markdown标题符号（保留原有逻辑）
  finalText = finalText.replace(/#{1,6}\\s+/g, "");

  // 添加结束语
  const CLOSINGS = [
    "以上文章属于个人观点，若另有见解，我们评论区见。",
    "以上只是个人看法，有不同意见的欢迎评论区聊聊。",
    "以上纯属个人观点，不喜勿喷，觉得说得对的点个赞。",
  ];
  finalText = finalText.trimEnd() + "\\n\\n" + pick(CLOSINGS);

  return finalText.trim();
}

`;

const newCode = code.slice(0, startIndex) + replacement + '\n\n' + code.slice(endIndex);
fs.writeFileSync(filePath, newCode, 'utf8');
console.log('Successfully patched src/content-service.js!');
