import { checkYtDlpAvailable, parseVideoUrl } from "../src/video-parse-service.js";

async function runTests() {
  console.log("=== 运行 yt-dlp 视频解析测试 ===");

  // 1. 测试 yt-dlp 环境可用性
  console.log("\n[1] 检查系统环境 yt-dlp...");
  const status = await checkYtDlpAvailable();
  console.log("yt-dlp 检测结果:", JSON.stringify(status, null, 2));

  // 2. 测试参数校验：空 URL
  console.log("\n[2] 测试空 URL 参数校验...");
  try {
    await parseVideoUrl("");
    console.error("❌ 错误：预期抛出 VIDEO_URL_REQUIRED，但未抛出");
  } catch (err) {
    if (err.message === "VIDEO_URL_REQUIRED") {
      console.log("✅ 成功捕获 VIDEO_URL_REQUIRED 异常");
    } else {
      console.error("❌ 预期外异常:", err.message);
    }
  }

  // 3. 测试参数校验：非法 URL
  console.log("\n[3] 测试非法 URL 参数校验...");
  try {
    await parseVideoUrl("not-a-valid-url");
    console.error("❌ 错误：预期抛出 INVALID_VIDEO_URL，但未抛出");
  } catch (err) {
    if (err.message === "INVALID_VIDEO_URL") {
      console.log("✅ 成功捕获 INVALID_VIDEO_URL 异常");
    } else {
      console.error("❌ 预期外异常:", err.message);
    }
  }

  // 4. 若系统安装了 yt-dlp，测试解析演示视频
  if (status.available) {
    console.log("\n[4] 运行真实视频解析测试...");
    const testUrl = "https://www.youtube.com/watch?v=BaW_jenozKc";
    try {
      const result = await parseVideoUrl(testUrl);
      console.log("✅ 视频解析成功！");
      console.log("标题:", result.title);
      console.log("发布者:", result.uploader);
      console.log("时长(秒):", result.duration);
      console.log("提取格式数量:", result.formats_count);
      if (result.formats.length > 0) {
        console.log("首个格式示例:", {
          format_id: result.formats[0].format_id,
          ext: result.formats[0].ext,
          resolution: result.formats[0].resolution,
          has_url: Boolean(result.formats[0].url),
        });
      }
    } catch (err) {
      console.error("❌ 视频解析失败:", err.message);
    }
  } else {
    console.log("\n[4] 跳过真实视频解析测试（系统未安装 yt-dlp）");
    console.log("💡 提示：测试代码验证正确逻辑，若要解析真实视频，请安装 yt-dlp 并确保它在系统 PATH 或设置 YT_DLP_PATH");
  }

  console.log("\n=== 所有基础测试完成 ===");
}

runTests().catch((err) => {
  console.error("测试运行异常:", err);
  process.exit(1);
});
