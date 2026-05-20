import fs from 'fs';

const file = 'src/content-service.js';
let code = fs.readFileSync(file, 'utf8');
const hasCRLF = code.includes('\r\n');
if (hasCRLF) code = code.replace(/\r\n/g, '\n');

// 找到函数位置
const fnStart = code.indexOf('function deAIStatisticalFingerprint');
const fnEnd = code.indexOf('\nexport async function generateArticleContent');
if (fnStart === -1 || fnEnd === -1) { console.error('Not found'); process.exit(1); }
const commentStart = code.lastIndexOf('/**', fnStart);
const actualStart = (commentStart > fnStart - 500 && commentStart !== -1) ? commentStart : fnStart;

const NEW_FN = `/**
 * 反AI检测后处理器 v4
 * 
 * 针对朱雀检测的5项核心指标逐一攻破：
 * 1. 句长标准差（人类是多峰平铺，AI是单峰钟形）
 * 2. 信息密度疏密（人类疏密相间，AI过度平滑）
 * 3. 连接词偏好集中度
 * 4. 段落结构工整度
 * 5. 术语密度均匀度
 */
function deAIStatisticalFingerprint(markdown) {
  if (!markdown || typeof markdown !== "string") return markdown;

  const rng = () => Math.random();
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  
  // 计算中文字符数
  const clen = (s) => [...s].filter(c => /[\\u4e00-\\u9fa5\\uff00-\\uffef]/.test(c)).length;

  let text = markdown;

  // ====== 预处理：删除AI指纹词 ======
  const NUKE = [
    "值得一提的是，", "值得一提的是", "不难发现，", "不难发现",
    "众所周知，", "众所周知", "综上所述，", "综上所述",
    "由此可见，", "由此可见", "显而易见，", "显而易见",
    "毫无疑问，", "毫无疑问", "毋庸置疑，", "毋庸置疑",
    "首先，", "其次，", "最后，", "总之，",
    "因此，", "此外，", "同时，", "事实上，",
    "换言之，", "也就是说，", "一方面，", "另一方面，",
    "归根结底，", "不可否认，",
  ];
  for (const p of NUKE) {
    while (text.includes(p)) text = text.replace(p, "");
  }

  // AI词替换
  const SWAPS = [
    ["然而", ["可", "但", "不过"]],
    ["因此", ["所以", "那"]],
    ["此外", ["另外", "还有"]],
    ["实际上", ["其实", "说白了"]],
    ["非常", ["挺", "特别", "贼"]],
    ["逐渐", ["慢慢", "一点点"]],
    ["导致", ["搞得", "弄得"]],
    ["如果", ["要是", "万一"]],
    ["往往", ["动不动就", "总"]],
    ["已经", ["都", "早就"]],
    ["需要", ["得", "要"]],
    ["能够", ["能", "可以"]],
    ["进行", ["做", "搞"]],
  ];
  for (const [w, alts] of SWAPS) {
    if (text.includes(w)) {
      text = text.split(w).map((p, i, a) =>
        i === a.length - 1 ? p : p + (rng() < 0.75 ? pick(alts) : w)
      ).join("");
    }
  }

  // ====== 指标1攻破：句长标准差 ======
  // 目标：制造极短句(<6字)和极长句(>60字)的双峰分布
  // AI倾向于15-30字的钟形分布，我们要打破这个
  const paragraphs = text.split(/\\n\\n+/);
  const processed = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    
    // 跳过结构化内容
    if (/^#{1,6}\\s/.test(trimmed) || /^[-*+]\\s/.test(trimmed) ||
        /^\\d+[.\u3001]\\s/.test(trimmed) || /^>/.test(trimmed)) {
      processed.push(trimmed);
      continue;
    }

    // 把段落拆成句子
    const sentences = trimmed.split(/(?<=[。！？])/g).filter(s => s.trim());
    if (sentences.length === 0) { processed.push(trimmed); continue; }

    const newSentences = [];
    for (let j = 0; j < sentences.length; j++) {
      const sent = sentences[j].trim();
      const len = clen(sent);

      // 策略A：中等长度的句子(15-30字)有40%概率被拆成两句
      // 在逗号/分号处拆开，制造极短句
      if (len >= 15 && len <= 30 && rng() < 0.40) {
        const splitPoints = [];
        for (let k = 0; k < sent.length; k++) {
          if (sent[k] === '，' || sent[k] === '；') splitPoints.push(k);
        }
        if (splitPoints.length > 0) {
          const sp = splitPoints[Math.floor(rng() * splitPoints.length)];
          const part1 = sent.substring(0, sp) + '。';
          const part2 = sent.substring(sp + 1);
          newSentences.push(part1);
          if (part2.trim()) newSentences.push(part2);
          continue;
        }
      }

      // 策略B：两个相邻短句(各<15字)有35%概率合并成一个长句
      if (len < 15 && j + 1 < sentences.length && clen(sentences[j + 1]) < 15 && rng() < 0.35) {
        const combined = sent.replace(/[。！？]$/, '，') + sentences[j + 1].trim();
        newSentences.push(combined);
        j++; // 跳过下一句
        continue;
      }

      newSentences.push(sent);
    }

    // 把处理后的句子重新组成段落
    // 策略C：每3-5句强制断段，制造不等长段落
    const chunked = [];
    let chunk = [];
    let chunkTarget = 2 + Math.floor(rng() * 4); // 2-5句一段
    
    for (const s of newSentences) {
      chunk.push(s);
      if (chunk.length >= chunkTarget) {
        chunked.push(chunk.join(""));
        chunk = [];
        chunkTarget = 1 + Math.floor(rng() * 5); // 下一段1-5句
      }
    }
    if (chunk.length > 0) chunked.push(chunk.join(""));
    
    for (const c of chunked) processed.push(c);
  }

  // ====== 指标2攻破：信息密度疏密 ======
  // 在段落之间随机插入"低信息密度"的短句段落
  // 这些是语气词、感叹、口语化碎片，制造"稀疏区域"
  const SPARSE_INSERTS = [
    "挺有意思的。",
    "就是这么个事。",
    "没想到吧。",
    "说起来挺简单。",
    "也不一定。",
    "这话讲出来可能有人不爱听。",
    "想想也是。",
    "不好说。",
    "有一说一。",
    "就这样。",
    "话是这么说。",
    "谁知道呢。",
    "怎么说呢。",
    "也行吧。",
    "都一样。",
    "反正就那回事。",
    "说白了就这么点事。",
  ];

  const withSparse = [];
  for (let i = 0; i < processed.length; i++) {
    withSparse.push(processed[i]);
    // 每隔2-4个段落，25%概率插入一个低密度短句
    if (i > 0 && i < processed.length - 1 && 
        !/^#{1,6}\\s/.test(processed[i]) && 
        rng() < 0.25) {
      withSparse.push(pick(SPARSE_INSERTS));
    }
  }

  // ====== 指标4攻破：段落结构工整度 ======
  // 随机交换10-12%的相邻内容段落
  for (let i = 1; i < withSparse.length - 1; i++) {
    const curr = withSparse[i];
    const next = withSparse[i + 1];
    if (curr && next &&
        !/^#{1,6}\\s/.test(curr) && !/^#{1,6}\\s/.test(next) &&
        clen(curr) > 8 && clen(next) > 8 && rng() < 0.12) {
      withSparse[i] = next;
      withSparse[i + 1] = curr;
      i++;
    }
  }

  // ====== 指标3攻破：标点和连接模式 ======
  let finalText = withSparse.join("\\n\\n");
  
  // 随机改变标点
  finalText = finalText.replace(/，/g, m => {
    const r = rng();
    if (r < 0.04) return "——";
    if (r < 0.07) return "；";
    return m;
  });

  // 句尾变化
  finalText = finalText.replace(/。(?=\\n|$)/g, m => {
    if (rng() < 0.12) return pick(["。", "——", "……", "吧。"]);
    return m;
  });

  // 的/得/地 混淆（人类常犯错误）
  let mc = 0;
  finalText = finalText.replace(/地(?=[\\u4e00-\\u9fa5])/g, m => {
    if (mc < 3 && rng() < 0.15) { mc++; return "的"; }
    return m;
  });

  return finalText.replace(/\\n{4,}/g, "\\n\\n\\n").trim();
}

`;

code = code.substring(0, actualStart) + NEW_FN + code.substring(fnEnd + 1);

// 验证集成
if (!code.includes('deAIStatisticalFingerprint(extractArticleMarkdown')) {
  code = code.replace(
    'const articleMd = extractArticleMarkdown(data);',
    'const articleMd = deAIStatisticalFingerprint(extractArticleMarkdown(data));'
  );
}

if (hasCRLF) code = code.replace(/\n/g, '\r\n');
fs.writeFileSync(file, code, 'utf8');

const v = fs.readFileSync(file, 'utf8');
console.log('Has fn:', v.includes('function deAIStatisticalFingerprint'));
console.log('Has SPARSE_INSERTS:', v.includes('SPARSE_INSERTS'));
console.log('Has integration:', v.includes('deAIStatisticalFingerprint(extractArticleMarkdown'));
console.log('File size:', v.length);
console.log('\\n✅ v4 applied');
