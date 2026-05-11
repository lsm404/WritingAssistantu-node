import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DATA_DIR = path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "license-store.json");
const LEGACY_STORE_PATH = path.resolve(process.cwd(), "..", "backend", "data", "license-store.json");

function createEmptyStore() {
  return { licenses: [] };
}

async function ensureStoreFile() {
  await mkdir(DATA_DIR, { recursive: true });

  try {
    await readFile(STORE_PATH, "utf8");
  } catch {
    try {
      const legacyStore = await readFile(LEGACY_STORE_PATH, "utf8");
      await writeFile(STORE_PATH, legacyStore, "utf8");
    } catch {
      await writeFile(STORE_PATH, JSON.stringify(createEmptyStore(), null, 2), "utf8");
    }
  }
}

function migrateLicenseRecord(item) {
  const code = typeof item?.code === "string" ? item.code : null;
  if (!code) {
    return null;
  }

  const rawStatus = typeof item?.status === "string" ? item.status : "available";
  const status =
    rawStatus === "activated" || rawStatus === "disabled" || rawStatus === "available"
      ? rawStatus
      : rawStatus === "assigned"
        ? "activated"
        : "available";

  const machineId =
    typeof item?.machineId === "string"
      ? item.machineId
      : typeof item?.assignedTo === "string"
        ? item.assignedTo
        : null;

  const activatedAt =
    typeof item?.activatedAt === "string"
      ? item.activatedAt
      : typeof item?.assignedAt === "string"
        ? item.assignedAt
        : null;

  return {
    code,
    status,
    createdAt: typeof item?.createdAt === "string" ? item.createdAt : new Date().toISOString(),
    machineId,
    activatedAt,
    note: typeof item?.note === "string" ? item.note : null,
  };
}

async function readStore() {
  await ensureStoreFile();
  const raw = await readFile(STORE_PATH, "utf8");

  try {
    const parsed = JSON.parse(raw);
    return {
      licenses: Array.isArray(parsed?.licenses)
        ? parsed.licenses.map((item) => migrateLicenseRecord(item)).filter(Boolean)
        : [],
    };
  } catch {
    return createEmptyStore();
  }
}

async function writeStore(store) {
  await ensureStoreFile();
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

async function updateEnvFile(filePath, key, value) {
  let content = "";

  try {
    content = await readFile(filePath, "utf8");
  } catch {
    content = "";
  }

  const line = `${key}=${value}`;

  if (!content.trim()) {
    await writeFile(filePath, `${line}\n`, "utf8");
    return;
  }

  const lines = content.split(/\r?\n/);
  let replaced = false;
  const nextLines = lines.map((item) => {
    if (item.trimStart().startsWith(`${key}=`)) {
      replaced = true;
      return line;
    }

    return item;
  });

  if (!replaced) {
    if (nextLines[nextLines.length - 1] !== "") {
      nextLines.push("");
    }
    nextLines.push(line);
  }

  await writeFile(filePath, `${nextLines.join("\n").replace(/\n+$/, "\n")}`, "utf8");
}

function randomChunk(length) {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => CODE_CHARS[byte % CODE_CHARS.length]).join("");
}

function createLicenseCode(prefix = "CLAW") {
  return `${prefix.toUpperCase()}-${randomChunk(4)}-${randomChunk(4)}-${randomChunk(4)}`;
}

function sanitizePrefix(prefix = "CLAW") {
  const normalized = String(prefix).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized || "CLAW";
}

function getOpenClawDir() {
  const configured = process.env.OPENCLAW_DIR?.trim();
  return configured ? path.resolve(configured) : path.resolve(process.cwd(), "..", "openClaw");
}

function getOpenClawDbPath() {
  const configured = process.env.OPENCLAW_DB_PATH?.trim();
  return configured ? path.resolve(configured) : path.join(getOpenClawDir(), "data", "license.db");
}

function getOpenClawSyncFiles() {
  const configured = process.env.OPENCLAW_SYNC_FILES?.trim();
  if (configured) {
    return configured
      .split(/[;,]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => path.resolve(item));
  }

  const openClawDir = getOpenClawDir();
  return [
    path.join(openClawDir, ".env"),
    path.join(openClawDir, "local_activation_codes.env"),
  ];
}

export function normalizeLicenseCode(code) {
  return String(code).replace(/[\s-]+/g, "").toUpperCase();
}

function filterLicensesByScope(licenses, scope) {
  switch (scope) {
    case "available":
    case "active":
      return licenses.filter((item) => item.status === "available");
    case "activated":
      return licenses.filter((item) => item.status === "activated");
    case "all":
      return licenses;
    default:
      return licenses.filter((item) => item.status === "available");
  }
}

function withDatabase(dbPath, callback) {
  const db = new DatabaseSync(dbPath);
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

async function readOpenClawBindings() {
  const dbPath = getOpenClawDbPath();
  await mkdir(path.dirname(dbPath), { recursive: true });

  return withDatabase(dbPath, (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS license_bindings (
        code_norm TEXT PRIMARY KEY,
        machine_id TEXT NOT NULL,
        updated_at REAL NOT NULL
      )
    `);

    const statement = db.prepare(
      "SELECT code_norm, machine_id, updated_at FROM license_bindings",
    );

    return statement.all().map((row) => ({
      code: row.code_norm,
      machineId: row.machine_id,
      updatedAt: row.updated_at,
    }));
  });
}

async function syncBindingsIntoStore(store) {
  const sourceStore = store ?? (await readStore());
  const bindings = await readOpenClawBindings();
  const bindingMap = new Map(bindings.map((item) => [item.code, item]));
  let changed = false;

  const licenses = sourceStore.licenses.map((item) => {
    const binding = bindingMap.get(normalizeLicenseCode(item.code));
    if (!binding) {
      if (item.status === "activated" && item.machineId) {
        changed = true;
        return {
          ...item,
          status: "available",
          machineId: null,
          activatedAt: null,
        };
      }

      if (item.status !== "available" && item.status !== "disabled") {
        changed = true;
      }

      return item.status === "disabled"
        ? item
        : {
            ...item,
            status: "available",
            machineId: null,
            activatedAt: null,
          };
    }

    const nextActivatedAt = new Date(binding.updatedAt * 1000).toISOString();
    if (
      item.status !== "activated" ||
      item.machineId !== binding.machineId ||
      item.activatedAt !== nextActivatedAt
    ) {
      changed = true;
    }

    return {
      ...item,
      status: item.status === "disabled" ? "disabled" : "activated",
      machineId: binding.machineId,
      activatedAt: nextActivatedAt,
    };
  });

  const nextStore = { licenses };
  if (changed) {
    await writeStore(nextStore);
  }

  return nextStore;
}

export async function getLicenses() {
  const syncedStore = await syncBindingsIntoStore();
  return [...syncedStore.licenses].sort((a, b) => {
    const left = a.activatedAt ?? a.createdAt;
    const right = b.activatedAt ?? b.createdAt;
    return right.localeCompare(left);
  });
}

export async function getLicenseDashboard() {
  const licenses = await getLicenses();

  return {
    licenses,
    stats: {
      total: licenses.length,
      available: licenses.filter((item) => item.status === "available").length,
      activated: licenses.filter((item) => item.status === "activated").length,
      disabled: licenses.filter((item) => item.status === "disabled").length,
    },
  };
}

export async function generateLicenses(input) {
  const count = Math.max(1, Math.min(200, Math.floor(Number(input?.count) || 0)));
  const prefix = sanitizePrefix(input?.prefix);
  const store = await syncBindingsIntoStore();
  const existingCodes = new Set(store.licenses.map((item) => item.code));
  const created = [];

  while (created.length < count) {
    const code = createLicenseCode(prefix);
    if (existingCodes.has(code)) {
      continue;
    }

    existingCodes.add(code);
    created.push({
      code,
      status: "available",
      createdAt: new Date().toISOString(),
      machineId: null,
      activatedAt: null,
      note: null,
    });
  }

  store.licenses.unshift(...created);
  await writeStore(store);
  return created;
}

export async function exportLicenses(scope = "active") {
  const licenses = await getLicenses();
  const filtered = filterLicensesByScope(licenses, scope);
  const normalizedCodes = filtered.map((item) => normalizeLicenseCode(item.code));

  return {
    scope,
    count: filtered.length,
    licenses: filtered,
    normalizedCodes,
    envText: `OPENCLAW_LICENSE_CODES=${normalizedCodes.join(",")}`,
    txtText: normalizedCodes.join("\n"),
    jsonText: JSON.stringify(
      {
        scope,
        count: filtered.length,
        exportedAt: new Date().toISOString(),
        codes: normalizedCodes,
        records: filtered,
      },
      null,
      2,
    ),
  };
}

export async function syncOpenClawLicensePool(store) {
  const sourceStore = await syncBindingsIntoStore(store);
  const filtered = filterLicensesByScope(sourceStore.licenses, "available");
  const normalizedCodes = filtered.map((item) => normalizeLicenseCode(item.code));
  const csv = normalizedCodes.join(",");
  const openClawDbPath = getOpenClawDbPath();
  const openClawSyncFiles = getOpenClawSyncFiles();

  await mkdir(path.dirname(openClawDbPath), { recursive: true });

  withDatabase(openClawDbPath, (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS license_pool (
        code_norm TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        source TEXT NOT NULL,
        updated_at REAL NOT NULL
      )
    `);

    const now = Date.now() / 1000;
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM license_pool WHERE source = ?").run("backend");
      const insert = db.prepare(
        "INSERT INTO license_pool (code_norm, status, source, updated_at) VALUES (?, ?, ?, ?)",
      );
      for (const code of normalizedCodes) {
        insert.run(code, "active", "backend", now);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });

  await Promise.all(
    openClawSyncFiles.map((filePath) => updateEnvFile(filePath, "OPENCLAW_LICENSE_CODES", csv)),
  );

  return {
    count: normalizedCodes.length,
    dbPath: openClawDbPath,
    files: openClawSyncFiles,
  };
}
