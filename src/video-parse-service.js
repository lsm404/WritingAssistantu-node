import { youtubeDl, create as createYoutubeDl, constants } from "youtube-dl-exec";
import fs from "node:fs";

/**
 * 获取 yt-dlp 可执行文件路径
 * 优先读取环境变量 YT_DLP_PATH，否则使用 youtube-dl-exec 内置路径
 */
export function getYtDlpPath() {
  return process.env.YT_DLP_PATH || constants.YOUTUBE_DL_PATH;
}

/**
 * 检查 yt-dlp 是否可用
 */
export async function checkYtDlpAvailable() {
  const binPath = getYtDlpPath();
  const binExists = fs.existsSync(binPath);

  if (!binExists) {
    return {
      available: false,
      version: null,
      binPath,
      error: "yt-dlp 可执行文件不存在，请将 yt-dlp.exe 放置到: " + binPath,
    };
  }

  try {
    const ytdlp = createYoutubeDl(binPath);
    const version = await ytdlp("--version", {}, { shell: false });
    return {
      available: true,
      version: String(version).trim(),
      binPath,
    };
  } catch (error) {
    return {
      available: false,
      version: null,
      binPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 清洗格式数据项
 */
function cleanFormatItem(fmt) {
  if (!fmt || typeof fmt !== "object") return null;

  const hasVideo = fmt.vcodec && fmt.vcodec !== "none";
  const hasAudio = fmt.acodec && fmt.acodec !== "none";

  let resolution = fmt.resolution || null;
  if (!resolution && fmt.width && fmt.height) {
    resolution = `${fmt.width}x${fmt.height}`;
  }

  return {
    format_id: fmt.format_id || null,
    format_note: fmt.format_note || null,
    ext: fmt.ext || null,
    resolution: resolution,
    width: fmt.width || null,
    height: fmt.height || null,
    fps: fmt.fps || null,
    filesize: fmt.filesize || fmt.filesize_approx || null,
    tbr: fmt.tbr || null,
    vcodec: fmt.vcodec || null,
    acodec: fmt.acodec || null,
    url: fmt.url || null,
    is_video: Boolean(hasVideo),
    is_audio: Boolean(hasAudio),
    protocol: fmt.protocol || null,
    container: fmt.container || null,
  };
}

/**
 * 解析视频 URL 元数据
 * @param {string} videoUrl 目标视频 URL
 * @param {object} options 可选配置（timeout, proxy, userAgent 等）
 */
export async function parseVideoUrl(videoUrl, options = {}) {
  const rawUrl = String(videoUrl || "").trim();
  if (!rawUrl) {
    throw new Error("VIDEO_URL_REQUIRED");
  }

  // 基础 URL 格式校验
  try {
    new URL(rawUrl);
  } catch {
    throw new Error("INVALID_VIDEO_URL");
  }

  const binPath = getYtDlpPath();

  // 先检测 yt-dlp 文件是否存在
  if (!fs.existsSync(binPath)) {
    throw new Error("YT_DLP_NOT_FOUND");
  }

  const ytdlp = createYoutubeDl(binPath);
  const timeoutMs = options.timeout || 45000;

  // 构建参数对象（youtube-dl-exec 会将 camelCase 自动转成 --flag-name）
  const flags = {
    dumpSingleJson: true,
    noWarnings: true,
    noPlaylist: true,
  };

  if (options.proxy) {
    flags.proxy = options.proxy;
  }

  if (options.userAgent) {
    flags.userAgent = options.userAgent;
  }

  try {
    // youtube-dl-exec 会自动将 dumpSingleJson 解析为 JSON 对象返回
    const rawData = await Promise.race([
      ytdlp(rawUrl, flags),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("VIDEO_PARSE_TIMEOUT")), timeoutMs)
      ),
    ]);

    if (!rawData || typeof rawData !== "object") {
      throw new Error("EMPTY_PARSER_RESPONSE");
    }

    // 格式化输出主要信息
    const formatsRaw = Array.isArray(rawData.formats) ? rawData.formats : [];
    const cleanedFormats = formatsRaw
      .map(cleanFormatItem)
      .filter((item) => item !== null && item.url);

    // 计算最佳预览图
    let bestThumbnail = rawData.thumbnail || null;
    if (!bestThumbnail && Array.isArray(rawData.thumbnails) && rawData.thumbnails.length > 0) {
      bestThumbnail = rawData.thumbnails[rawData.thumbnails.length - 1].url || null;
    }

    return {
      id: rawData.id || null,
      title: rawData.title || "",
      description: rawData.description || "",
      thumbnail: bestThumbnail,
      duration: typeof rawData.duration === "number" ? rawData.duration : null,
      duration_string: rawData.duration_string || null,
      uploader: rawData.uploader || rawData.channel || rawData.uploader_id || null,
      uploader_url: rawData.uploader_url || rawData.channel_url || null,
      upload_date: rawData.upload_date || null,
      webpage_url: rawData.webpage_url || rawUrl,
      extractor: rawData.extractor || null,
      extractor_key: rawData.extractor_key || null,
      view_count: rawData.view_count || null,
      like_count: rawData.like_count || null,
      comment_count: rawData.comment_count || null,
      formats_count: cleanedFormats.length,
      formats: cleanedFormats,
    };
  } catch (error) {
    if (error instanceof Error) {
      const msg = error.message;
      if (msg === "VIDEO_PARSE_TIMEOUT") throw error;
      if (msg === "YT_DLP_NOT_FOUND") throw error;
      if (msg.includes("ENOENT")) throw new Error("YT_DLP_NOT_FOUND");
    }
    const errText = String(error?.stderr || error?.message || error);
    const customErr = new Error(`VIDEO_PARSE_FAILED: ${errText.slice(0, 300)}`);
    customErr.rawError = error;
    throw customErr;
  }
}

/**
 * 从可能包含杂质的分享文本中提取出干净的 http(s) 链接
 * @param {string} text 
 * @returns {string}
 */
export function extractPureUrl(text) {
  if (!text) return "";
  const clean = String(text).replace(/锟斤拷|锟|斤|拷/g, "").trim();
  const match = clean.match(/https?:\/\/[^\s\u4e00-\u9fa5]+/i);
  return match ? match[0] : clean;
}

/**
 * 识别视频 URL 所属平台
 * @param {string} url
 * @returns {'douyin'|'kuaishou'|'bilibili'|'youtube'|'xiaohongshu'|'instagram'|'other'}
 */
export function detectPlatform(url) {
  const raw = extractPureUrl(url).toLowerCase();
  if (raw.includes("douyin.com") || raw.includes("v.douyin.com")) return "douyin";
  if (raw.includes("kuaishou.com") || raw.includes("v.kuaishou.com") || raw.includes("kwai.com")) return "kuaishou";
  if (raw.includes("bilibili.com") || raw.includes("b23.tv")) return "bilibili";
  if (raw.includes("youtube.com") || raw.includes("youtu.be")) return "youtube";
  if (raw.includes("xiaohongshu.com") || raw.includes("xhslink.com")) return "xiaohongshu";
  if (raw.includes("instagram.com")) return "instagram";
  return "other";
}

/**
 * 抖音直连 API 解析（无需 yt-dlp）
 * @param {string} inputUrl 抖音原始链接或短链接
 */
export async function parseDouyinDirect(inputUrl) {
  const pureUrl = extractPureUrl(inputUrl);
  let resolvedUrl = pureUrl;

  // 1. 短链接重定向解析
  if (pureUrl.includes("v.douyin.com")) {
    try {
      const res = await fetch(pureUrl, {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" },
      });
      resolvedUrl = res.url;
    } catch {
      /* 失败则使用原 URL */
    }
  }

  // 2. 提取 video ID（兼容 /video/，/note/，aweme_id，modal_id，和 18-20 位纯数字）
  let videoId = null;
  const match1 = resolvedUrl.match(/\/(video|note)\/(\d+)/) || pureUrl.match(/\/(video|note)\/(\d+)/);
  if (match1) {
    videoId = match1[2];
  } else {
    const match2 = resolvedUrl.match(/(\d{18,20})/) || pureUrl.match(/(\d{18,20})/);
    if (match2) videoId = match2[1];
  }

  if (!videoId) throw new Error("DOUYIN_VIDEO_ID_NOT_FOUND");

  // 3. 尝试多通道抓取元数据
  let detail = null;

  // 策略 A: 抖音移动端 Feed API (秒级解析，免 Cookie / 无 WAF 干扰)
  try {
    const apiUrl = `https://api.amemv.com/aweme/v1/feed/?aweme_id=${videoId}`;
    const response = await fetch(apiUrl, {
      headers: {
        "User-Agent": "Aweme/28.0.0 (iPhone; iOS 16.6; Scale/3.00)",
      },
    });
    const data = await response.json();
    if (data && Array.isArray(data.aweme_list) && data.aweme_list.length > 0) {
      const matched = data.aweme_list.find((item) => String(item.aweme_id) === String(videoId));
      detail = matched || data.aweme_list[0];
    }
  } catch {
    /* 尝试策略 B */
  }

  // 策略 B: 抖音 Web API（带 cookie 绕过 WAF）
  if (!detail) {
    try {
      const apiUrl = `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${videoId}&aid=6383&device_platform=webapp`;
      const response = await fetch(apiUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Referer": "https://www.douyin.com/",
          "Cookie": "passport_csrf_token=1; ttwid=1%7Ccsh%7C1;"
        },
      });
      const text = await response.text();
      if (text && text.startsWith("{")) {
        const data = JSON.parse(text);
        if (data.aweme_detail) detail = data.aweme_detail;
      }
    } catch {
      /* 尝试策略 C */
    }
  }

  // 策略 C: 移动端 H5 提取 (_ROUTER_DATA)
  if (!detail) {
    try {
      const h5Url = `https://www.iesdouyin.com/share/video/${videoId}/`;
      const res = await fetch(h5Url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        },
      });
      const html = await res.text();
      const match = html.match(/window\._ROUTER_DATA\s*=\s*({[\s\S]+?});?\s*<\/script>/);
      if (match) {
        const routerData = JSON.parse(match[1]);
        const loader = routerData.loaderData || {};
        const pageKey = Object.keys(loader).find((k) => k.includes("video_") || k.includes("note_"));
        if (pageKey && loader[pageKey]?.videoInfoRes?.item_list?.[0]) {
          detail = loader[pageKey].videoInfoRes.item_list[0];
        }
      }
    } catch {
      /* 尝试策略 C */
    }
  }

  if (!detail) throw new Error("DOUYIN_API_PARSE_FAILED");

  const video = detail.video || {};

  // 4. 构建格式列表（按清晰度降序）
  const qualityMap = new Map();
  if (video.bit_rate?.length > 0) {
    video.bit_rate.forEach((br, index) => {
      if (!br.play_addr?.url_list?.[0]) return;
      const match = br.gear_name?.match(/(\d+)/);
      const quality = match ? `${match[1]}p` : `${br.height || 0}p`;
      const qualityKey = match ? match[1] : String(br.height || index);
      const height = match ? parseInt(match[1]) : br.height || 0;
      const existing = qualityMap.get(qualityKey);
      const filesize = br.data_size || 0;
      if (!existing || filesize > existing.filesize) {
        qualityMap.set(qualityKey, {
          format_id: `dy_${index}`,
          format_note: quality,
          ext: "mp4",
          resolution: `${br.width || 0}x${height}`,
          width: br.width || 0,
          height,
          fps: br.fps || 30,
          filesize,
          url: br.play_addr.url_list[0].replace("http://", "https://"),
          is_video: true,
          is_audio: true,
        });
      }
    });
  }

  if (qualityMap.size === 0 && video.play_addr?.url_list?.[0]) {
    qualityMap.set("default", {
      format_id: "dy_default",
      format_note: "默认高清",
      ext: "mp4",
      resolution: null,
      width: video.play_addr.width || 0,
      height: video.play_addr.height || 0,
      fps: 30,
      filesize: video.play_addr.data_size || 0,
      url: video.play_addr.url_list[0].replace("http://", "https://"),
      is_video: true,
      is_audio: true,
    });
  }

  // 图文/图片笔记兜底
  if (qualityMap.size === 0 && detail.images?.length > 0) {
    detail.images.forEach((img, idx) => {
      if (img.url_list?.[0]) {
        qualityMap.set(`img_${idx}`, {
          format_id: `img_${idx}`,
          format_note: `图片 ${idx + 1}`,
          ext: "jpeg",
          resolution: null,
          width: img.width || 0,
          height: img.height || 0,
          filesize: 0,
          url: img.url_list[0].replace("http://", "https://"),
          is_video: false,
          is_audio: false,
        });
      }
    });
  }

  const formats = Array.from(qualityMap.values())
    .filter((f) => f.url)
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  return {
    id: detail.aweme_id || videoId,
    title: detail.desc || "抖音作品",
    description: detail.desc || "",
    thumbnail:
      detail.video?.cover?.url_list?.[0] || detail.video?.dynamic_cover?.url_list?.[0] || detail.images?.[0]?.url_list?.[0] || null,
    duration: detail.video?.duration ? Math.floor(detail.video.duration / 1000) : null,
    duration_string: null,
    uploader: detail.author?.nickname || null,
    uploader_url: null,
    upload_date: null,
    webpage_url: resolvedUrl,
    extractor: "douyin",
    extractor_key: "Douyin",
    view_count: null,
    like_count: null,
    comment_count: null,
    formats_count: formats.length,
    formats,
  };
}

/**
 * 快手直连 GraphQL API 解析（无需 yt-dlp）
 * @param {string} inputUrl 快手原始链接或短链接
 */
export async function parseKuaishouDirect(inputUrl) {
  const pureUrl = extractPureUrl(inputUrl);
  let videoId = null;

  // 1. 尝试从路径提取 videoId
  const shortVideoMatch = pureUrl.match(/\/short-video\/([^?&#]+)/);
  if (shortVideoMatch) videoId = shortVideoMatch[1];

  // 2. 短链接重定向
  if (!videoId) {
    try {
      const res = await fetch(pureUrl, {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      });
      const redirectedUrl = res.url;
      const newMatch = redirectedUrl.match(/\/short-video\/([^?&#]+)/);
      if (newMatch) videoId = newMatch[1];
    } catch {
      /* 忽略重定向失败 */
    }
  }

  if (!videoId) throw new Error("KUAISHOU_VIDEO_ID_NOT_FOUND");

  // 3. 调用 GraphQL API
  const query = {
    operationName: "VisionVideoDetail",
    variables: { photoId: videoId },
    query: `query VisionVideoDetail($photoId: String!) {
      visionVideoDetail(photoId: $photoId) {
        status
        photo {
          id duration caption likeCount viewCount realLikeCount
          coverUrl photoUrl photoH265Url
          manifest {
            adaptationSet {
              representation { id url width height avgBitrate size type }
            }
          }
        }
      }
    }`,
  };

  const response = await fetch("https://www.kuaishou.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    body: JSON.stringify(query),
  });
  const result = await response.json();
  const photo = result?.data?.visionVideoDetail?.photo;
  if (!photo) throw new Error("KUAISHOU_API_PARSE_FAILED");

  const formats = [];
  const reps = photo.manifest?.adaptationSet?.representation || [];
  reps.forEach((rep, idx) => {
    if (!rep.url) return;
    const durationSec = photo.duration ? photo.duration / 1000 : 0;
    let filesize = rep.size || 0;
    if (!filesize && durationSec && rep.avgBitrate) {
      filesize = Math.floor((rep.avgBitrate * durationSec) / 8);
    }
    formats.push({
      format_id: `ks_${idx}`,
      format_note: `${rep.height}p`,
      ext: "mp4",
      resolution: `${rep.width || 0}x${rep.height || 0}`,
      width: rep.width || 0,
      height: rep.height || 0,
      fps: 30,
      filesize,
      url: rep.url,
      is_video: true,
      is_audio: true,
    });
  });
  if (formats.length === 0 && photo.photoUrl) {
    formats.push({
      format_id: "ks_default",
      format_note: "默认",
      ext: "mp4",
      resolution: null,
      width: 0,
      height: 0,
      fps: 30,
      filesize: 0,
      url: photo.photoUrl,
      is_video: true,
      is_audio: true,
    });
  }
  formats.sort((a, b) => (b.height || 0) - (a.height || 0));

  return {
    id: photo.id,
    title: photo.caption || "快手视频",
    description: photo.caption || "",
    thumbnail: photo.coverUrl || null,
    duration: photo.duration ? Math.floor(photo.duration / 1000) : null,
    duration_string: null,
    uploader: null,
    uploader_url: null,
    upload_date: null,
    webpage_url: `https://www.kuaishou.com/short-video/${videoId}`,
    extractor: "kuaishou",
    extractor_key: "Kuaishou",
    view_count: photo.viewCount || null,
    like_count: photo.likeCount || null,
    comment_count: null,
    formats_count: formats.length,
    formats,
  };
}

/**
 * 统一视频解析入口（自动路由到不同解析器）
 * @param {string} videoUrl
 * @param {object} options
 */
export async function parseVideoUrlAuto(videoUrl, options = {}) {
  let pureUrl = extractPureUrl(videoUrl);
  if (!pureUrl) throw new Error("VIDEO_URL_REQUIRED");

  // 如果传入的是纯数字 Video ID，自动转换为标准抖音 URL
  if (/^\d{18,20}$/.test(pureUrl)) {
    pureUrl = `https://www.douyin.com/video/${pureUrl}`;
  }

  try {
    new URL(pureUrl);
  } catch {
    throw new Error("INVALID_VIDEO_URL");
  }

  const platform = detectPlatform(pureUrl);

  // 优先使用直连 API（速度快、无需 yt-dlp 依赖）
  if (platform === "douyin") {
    try {
      return await parseDouyinDirect(pureUrl);
    } catch (e) {
      console.warn("[video-parse] 抖音直连失败，降级 yt-dlp:", e.message);
    }
  }
  if (platform === "kuaishou") {
    try {
      return await parseKuaishouDirect(pureUrl);
    } catch (e) {
      console.warn("[video-parse] 快手直连失败，降级 yt-dlp:", e.message);
    }
  }

  // 兜底：yt-dlp 通用解析
  return await parseVideoUrl(pureUrl, options);
}

