import { prisma } from "./prisma.js";

const IMAGE_SETTING_KEYS = {
  apiKey: "image_api_key",
  model: "image_model",
  baseUrl: "image_base_url",
};

const TEXT_SETTING_KEYS = {
  apiKey: "text_api_key",
  model: "text_model",
  baseUrl: "text_base_url",
  enableWebSearch: "text_enable_web_search",
  reasoningEffort: "text_reasoning_effort",
};

/** 注册风控（供注册接口读取；管理员可在后台改，无需改代码） */
export const REGISTRATION_POLICY_KEYS = {
  ipWindowDays: "registration_ip_window_days",
  ipMaxCount: "registration_ip_max_count",
  subnetWindowDays: "registration_subnet_window_days",
  subnetMaxCount: "registration_subnet_max_count",
  maxAccountsPerDevice: "registration_max_accounts_per_device",
};

/** 普通用户：文字 / 图片额度按固定天数滚动刷新（非自然日/月） */
export const QUOTA_FREE_ROLLING_KEYS = {
  textPeriodDays: "quota_free_text_period_days",
  imagePeriodDays: "quota_free_image_period_days",
  textLimit: "quota_free_text_limit",
  imageLimit: "quota_free_image_limit",
  deAiLimit: "quota_free_de_ai_limit",
};

export async function ensureSystemSettingsTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function getSystemSettings(keys) {
  if (!keys.length) {
    return {};
  }

  const uniqueKeys = [...new Set(keys.filter((key) => key && String(key).trim()))];
  if (!uniqueKeys.length) {
    return {};
  }

  const placeholders = uniqueKeys.map((_, index) => `$${index + 1}`).join(", ");
  const rows = await prisma.$queryRawUnsafe(
    `SELECT key, value FROM system_settings WHERE key IN (${placeholders})`,
    ...uniqueKeys,
  );

  const result = {};
  for (const row of rows) {
    result[row.key] = row.value ?? "";
  }
  return result;
}

export async function upsertSystemSettings(entries) {
  const pairs = Object.entries(entries).filter(([, value]) => value !== undefined);
  if (!pairs.length) {
    return;
  }

  for (const [key, value] of pairs) {
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO system_settings (key, value, created_at, updated_at)
        VALUES ($1, $2, NOW(), NOW())
        ON CONFLICT (key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `,
      key,
      String(value ?? ""),
    );
  }
}

export async function getImageGenerationSettings() {
  const stored = await getSystemSettings(Object.values(IMAGE_SETTING_KEYS));

  return {
    apiKey: stored[IMAGE_SETTING_KEYS.apiKey] || process.env.ARK_IMAGE_API_KEY?.trim() || process.env.ARK_API_KEY?.trim() || "",
    model: stored[IMAGE_SETTING_KEYS.model] || process.env.ARK_IMAGE_MODEL?.trim() || "",
    baseUrl:
      stored[IMAGE_SETTING_KEYS.baseUrl] ||
      process.env.ARK_IMAGE_BASE_URL?.trim() ||
      process.env.ARK_BASE_URL?.trim() ||
      "https://ark.cn-beijing.volces.com/api/v3",
  };
}

export async function updateImageGenerationSettings(payload) {
  const next = {
    [IMAGE_SETTING_KEYS.apiKey]: String(payload.apiKey || "").trim(),
    [IMAGE_SETTING_KEYS.model]: String(payload.model || "").trim(),
    [IMAGE_SETTING_KEYS.baseUrl]: String(payload.baseUrl || "").trim(),
  };

  await upsertSystemSettings(next);
  return getImageGenerationSettings();
}

export async function getTextGenerationSettings() {
  const stored = await getSystemSettings(Object.values(TEXT_SETTING_KEYS));

  return {
    apiKey: stored[TEXT_SETTING_KEYS.apiKey] || process.env.ARK_API_KEY?.trim() || "",
    model: stored[TEXT_SETTING_KEYS.model] || process.env.ARK_MODEL?.trim() || "",
    baseUrl:
      stored[TEXT_SETTING_KEYS.baseUrl] ||
      process.env.ARK_BASE_URL?.trim() ||
      "https://ark.cn-beijing.volces.com/api/v3",
    enableWebSearch: stored[TEXT_SETTING_KEYS.enableWebSearch] === "true",
    reasoningEffort: stored[TEXT_SETTING_KEYS.reasoningEffort] || "medium",
  };
}

export async function updateTextGenerationSettings(payload) {
  const next = {
    [TEXT_SETTING_KEYS.apiKey]: String(payload.apiKey || "").trim(),
    [TEXT_SETTING_KEYS.model]: String(payload.model || "").trim(),
    [TEXT_SETTING_KEYS.baseUrl]: String(payload.baseUrl || "").trim(),
    [TEXT_SETTING_KEYS.enableWebSearch]: payload.enableWebSearch ? "true" : "false",
    [TEXT_SETTING_KEYS.reasoningEffort]: String(payload.reasoningEffort || "medium").trim(),
  };

  await upsertSystemSettings(next);
  return getTextGenerationSettings();
}

function parseStoredInt(raw, fallback) {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

/** 默认：IP/网段各 7 天窗口；单 IP 上限 10、单网段 40；单设备最多 3 个账号。可用环境变量覆盖初始默认（入库后以后台为准）。 */
export async function getRegistrationPolicySettings() {
  const stored = await getSystemSettings(Object.values(REGISTRATION_POLICY_KEYS));

  const envInt = (key, fb) =>
    Number.parseInt(String(process.env[key] ?? "").trim(), 10) || fb;

  return {
    ipWindowDays:
      parseStoredInt(stored[REGISTRATION_POLICY_KEYS.ipWindowDays], undefined) ||
      envInt("REGISTRATION_IP_WINDOW_DAYS", 7),
    ipMaxCount:
      parseStoredInt(stored[REGISTRATION_POLICY_KEYS.ipMaxCount], undefined) ||
      envInt("REGISTRATION_IP_MAX_COUNT", 10),
    subnetWindowDays:
      parseStoredInt(stored[REGISTRATION_POLICY_KEYS.subnetWindowDays], undefined) ||
      envInt("REGISTRATION_SUBNET_WINDOW_DAYS", 7),
    subnetMaxCount:
      parseStoredInt(stored[REGISTRATION_POLICY_KEYS.subnetMaxCount], undefined) ||
      envInt("REGISTRATION_SUBNET_MAX_COUNT", 40),
    maxAccountsPerDevice:
      parseStoredInt(stored[REGISTRATION_POLICY_KEYS.maxAccountsPerDevice], undefined) ||
      envInt("REGISTRATION_MAX_ACCOUNTS_PER_DEVICE", 3),
  };
}

function clampInt(label, value, min, max) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${label}_OUT_OF_RANGE`);
  }
  return n;
}

export async function updateRegistrationPolicySettings(payload) {
  const p = payload && typeof payload === "object" ? payload : {};

  const ipWindowDays = clampInt("IP_WINDOW_DAYS", p.ipWindowDays ?? p.ip_window_days, 1, 90);
  const ipMaxCount = clampInt("IP_MAX_COUNT", p.ipMaxCount ?? p.ip_max_count, 1, 500_000);
  const subnetWindowDays = clampInt("SUBNET_WINDOW_DAYS", p.subnetWindowDays ?? p.subnet_window_days, 1, 90);
  const subnetMaxCount = clampInt("SUBNET_MAX_COUNT", p.subnetMaxCount ?? p.subnet_max_count, 1, 500_000);
  const maxAccountsPerDevice = clampInt(
    "MAX_ACCOUNTS_PER_DEVICE",
    p.maxAccountsPerDevice ?? p.max_accounts_per_device,
    1,
    500,
  );

  await upsertSystemSettings({
    [REGISTRATION_POLICY_KEYS.ipWindowDays]: String(ipWindowDays),
    [REGISTRATION_POLICY_KEYS.ipMaxCount]: String(ipMaxCount),
    [REGISTRATION_POLICY_KEYS.subnetWindowDays]: String(subnetWindowDays),
    [REGISTRATION_POLICY_KEYS.subnetMaxCount]: String(subnetMaxCount),
    [REGISTRATION_POLICY_KEYS.maxAccountsPerDevice]: String(maxAccountsPerDevice),
  });

  return getRegistrationPolicySettings();
}

/** 免费额度滚动周期：默认文字 3 天、图片 7 天（会员仍按自然日/自然月） */
export async function getQuotaFreeRollingSettings() {
  const stored = await getSystemSettings(Object.values(QUOTA_FREE_ROLLING_KEYS));
  const envInt = (key, fb) =>
    Number.parseInt(String(process.env[key] ?? "").trim(), 10) || fb;

  return {
    textPeriodDays:
      parseStoredInt(stored[QUOTA_FREE_ROLLING_KEYS.textPeriodDays], undefined) ||
      envInt("QUOTA_FREE_TEXT_PERIOD_DAYS", 7),
    imagePeriodDays:
      parseStoredInt(stored[QUOTA_FREE_ROLLING_KEYS.imagePeriodDays], undefined) ||
      envInt("QUOTA_FREE_IMAGE_PERIOD_DAYS", 7),
    textLimit:
      parseStoredInt(stored[QUOTA_FREE_ROLLING_KEYS.textLimit], undefined) ||
      envInt("QUOTA_FREE_TEXT_LIMIT", 2),
    imageLimit:
      parseStoredInt(stored[QUOTA_FREE_ROLLING_KEYS.imageLimit], undefined) ||
      envInt("QUOTA_FREE_IMAGE_LIMIT", 3),
    deAiLimit:
      parseStoredInt(stored[QUOTA_FREE_ROLLING_KEYS.deAiLimit], undefined) ||
      envInt("QUOTA_FREE_DE_AI_LIMIT", 1),
  };
}

export async function updateQuotaFreeRollingSettings(payload) {
  const p = payload && typeof payload === "object" ? payload : {};

  const textPeriodDays = clampInt(
    "FREE_TEXT_PERIOD_DAYS",
    p.textPeriodDays ?? p.text_period_days,
    1,
    365,
  );
  const imagePeriodDays = clampInt(
    "FREE_IMAGE_PERIOD_DAYS",
    p.imagePeriodDays ?? p.image_period_days,
    1,
    365,
  );

  const textLimit = clampInt(
    "FREE_TEXT_LIMIT",
    p.textLimit ?? p.text_limit,
    0,
    10000,
  );
  const imageLimit = clampInt(
    "FREE_IMAGE_LIMIT",
    p.imageLimit ?? p.image_limit,
    0,
    10000,
  );
  const deAiLimit = clampInt(
    "FREE_DE_AI_LIMIT",
    p.deAiLimit ?? p.de_ai_limit,
    0,
    10000,
  );

  await upsertSystemSettings({
    [QUOTA_FREE_ROLLING_KEYS.textPeriodDays]: String(textPeriodDays),
    [QUOTA_FREE_ROLLING_KEYS.imagePeriodDays]: String(imagePeriodDays),
    [QUOTA_FREE_ROLLING_KEYS.textLimit]: String(textLimit),
    [QUOTA_FREE_ROLLING_KEYS.imageLimit]: String(imageLimit),
    [QUOTA_FREE_ROLLING_KEYS.deAiLimit]: String(deAiLimit),
  });

  return getQuotaFreeRollingSettings();
}
