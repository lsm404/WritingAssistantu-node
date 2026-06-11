import { randomUUID } from "node:crypto";
import { prisma } from "./prisma.js";

const MINIAPP_STYLE_NAMES = {
  funny: "幽默",
  sincere: "真诚",
  professional: "专业",
  poetry: "诗词",
  aesthetic: "唯美",
  romantic: "浪漫",
};

function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function rowCount(row) {
  return toInt(row?.count ?? row?._count ?? 0);
}

function toIsoDate(value) {
  if (!value) return "";
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function todayStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function daysAgoStart(days) {
  const start = todayStart();
  start.setDate(start.getDate() - days);
  return start;
}

export async function recordAiCallLog({
  source = "unknown",
  endpoint = "",
  status = "success",
  style = "",
  maxChars = null,
  inputChars = 0,
  outputChars = 0,
  model = "",
  errorCode = "",
  clientIp = "",
} = {}) {
  await prisma.$executeRaw`
    INSERT INTO ai_call_logs (
      id,
      source,
      endpoint,
      status,
      style,
      max_chars,
      input_chars,
      output_chars,
      model,
      error_code,
      client_ip,
      created_at
    )
    VALUES (
      ${randomUUID()},
      ${String(source || "unknown").trim().slice(0, 40) || "unknown"},
      ${String(endpoint || "").trim().slice(0, 120)},
      ${status === "failed" ? "failed" : "success"},
      ${String(style || "").trim().slice(0, 40) || null},
      ${maxChars == null ? null : toInt(maxChars)},
      ${Math.max(0, toInt(inputChars))},
      ${Math.max(0, toInt(outputChars))},
      ${String(model || "").trim().slice(0, 120) || null},
      ${String(errorCode || "").trim().slice(0, 160) || null},
      ${String(clientIp || "").trim().slice(0, 80) || null},
      NOW()
    )
  `;
}

export async function getAiCallStats() {
  const today = todayStart();
  const sevenDaysStart = daysAgoStart(6);

  const [
    totalRows,
    todayRows,
    sevenDayRows,
    successRows,
    failedRows,
    styleRows,
    lengthRows,
    dailyRows,
    recentRows,
  ] = await Promise.all([
    prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM ai_call_logs`,
    prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM ai_call_logs WHERE created_at >= ${today}`,
    prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM ai_call_logs WHERE created_at >= ${sevenDaysStart}`,
    prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM ai_call_logs WHERE status = 'success'`,
    prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM ai_call_logs WHERE status = 'failed'`,
    prisma.$queryRaw`
      SELECT COALESCE(style, 'unknown') AS style, COUNT(*)::int AS count
      FROM ai_call_logs
      GROUP BY COALESCE(style, 'unknown')
      ORDER BY count DESC, style ASC
    `,
    prisma.$queryRaw`
      SELECT COALESCE(max_chars, 0)::int AS "maxChars", COUNT(*)::int AS count
      FROM ai_call_logs
      GROUP BY COALESCE(max_chars, 0)
      ORDER BY "maxChars" ASC
    `,
    prisma.$queryRaw`
      SELECT TO_CHAR(created_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
      FROM ai_call_logs
      WHERE created_at >= ${sevenDaysStart}
      GROUP BY date
      ORDER BY date ASC
    `,
    prisma.$queryRaw`
      SELECT id, source, endpoint, status, style, max_chars AS "maxChars",
             input_chars AS "inputChars", output_chars AS "outputChars",
             model, error_code AS "errorCode", client_ip AS "clientIp", created_at AS "createdAt"
      FROM ai_call_logs
      ORDER BY created_at DESC
      LIMIT 30
    `,
  ]);

  return {
    summary: {
      total: rowCount(totalRows[0]),
      today: rowCount(todayRows[0]),
      last7Days: rowCount(sevenDayRows[0]),
      success: rowCount(successRows[0]),
      failed: rowCount(failedRows[0]),
    },
    byStyle: styleRows.map((row) => ({
      style: row.style,
      label: MINIAPP_STYLE_NAMES[row.style] || row.style || "未知",
      count: rowCount(row),
    })),
    byLength: lengthRows.map((row) => ({
      maxChars: toInt(row.maxChars),
      count: rowCount(row),
    })),
    daily: dailyRows.map((row) => ({
      date: row.date,
      count: rowCount(row),
    })),
    recent: recentRows.map((row) => ({
      id: row.id,
      source: row.source,
      endpoint: row.endpoint,
      status: row.status,
      style: row.style || "",
      styleLabel: MINIAPP_STYLE_NAMES[row.style] || row.style || "未知",
      maxChars: row.maxChars == null ? null : toInt(row.maxChars),
      inputChars: toInt(row.inputChars),
      outputChars: toInt(row.outputChars),
      model: row.model || "",
      errorCode: row.errorCode || "",
      clientIp: row.clientIp || "",
      createdAt: toIsoDate(row.createdAt),
    })),
  };
}
