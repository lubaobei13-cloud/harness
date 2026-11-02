import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  COMPANY_ROSTER,
  FORBIDDEN_CODEX_PATTERNS,
  applyCustomModelConfigToRoster,
} from "./roster.js";

const MODEL_CONFIG_PATH = path.join(os.homedir(), ".dsh/dsh-company/model-config.json");
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function isForbiddenModel(id) {
  return FORBIDDEN_CODEX_PATTERNS.some((pat) => pat.test(String(id || "")));
}

function isFlashLikeModel(id) {
  const s = String(id || "").toLowerCase();
  return (
    s.includes("flash") ||
    s.includes("highspeed") ||
    s.includes("fast") ||
    s.includes("mini") ||
    s.includes("lite") ||
    s === "hy3" ||
    s === "hy3-x" ||
    s === "space-bunny"
  );
}

/**
 * Scan local Codex model catalogs (~/.codex/models_cache.json & pi-ai openai-codex.json)
 */
function scanCodexModels() {
  const home = os.homedir();
  const discoveredMap = new Map();

  const addModel = (id, name, description = "", source = "local") => {
    const cleanId = String(id || "").trim();
    if (!cleanId) return;
    const forbidden = isForbiddenModel(cleanId);
    if (!discoveredMap.has(cleanId)) {
      discoveredMap.set(cleanId, {
        id: cleanId,
        name: name || cleanId,
        description: description || "",
        category: cleanId.includes("astra") ? "escalation" : "planner-reviewer",
        forbidden,
        source,
      });
    }
  };

  // Seed core Codex models (6.1-terra, 6.1-sol, 6-astra)
  addModel(
    "gpt-6.1-terra",
    "GPT-6.1-Terra",
    "公司层面主力代码审核与架构模型 (6.1 Terra)",
    "codex-core"
  );
  addModel(
    "gpt-6.1-sol",
    "GPT-6.1-Sol",
    "公司层面主力顶层规划与联合审核模型 (6.1 Sol)",
    "codex-core"
  );
  addModel(
    "gpt-6-astra",
    "GPT-6-Astra",
    "公司层面终极疑难会诊与仲裁核武 (6 Astra)",
    "codex-core"
  );

  // 1. Read ~/.codex/models_cache.json
  const codexCachePath = path.join(home, ".codex/models_cache.json");
  if (fs.existsSync(codexCachePath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(codexCachePath, "utf8"));
      const list = Array.isArray(raw?.models) ? raw.models : [];
      for (const m of list) {
        const mId = m.id || m.slug || m.model;
        addModel(
          mId,
          m.display_name || m.name || mId,
          m.description || "",
          "~/.codex/models_cache.json"
        );
      }
    } catch {
      // ignore
    }
  }

  // 2. Read pi-ai openai-codex.json
  const piAiCodexPath = path.join(
    home,
    ".dsh/profiles/desktop/node_modules/@earendil-works/pi-ai/dist/providers/data/openai-codex.json"
  );
  if (fs.existsSync(piAiCodexPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(piAiCodexPath, "utf8"));
      const bucket = Object.values(raw)[0] || {};
      for (const [mId, meta] of Object.entries(bucket)) {
        addModel(mId, meta?.name || mId, "DSH Codex Provider Catalog", "pi-ai");
      }
    } catch {
      // ignore
    }
  }

  return [...discoveredMap.values()];
}

/**
 * Scan local Qoder model catalogs (pi-ai qwen/zai/deepseek/kimi & cordis.patch.yml)
 */
function scanQoderModels() {
  const home = os.homedir();
  const discoveredMap = new Map();

  const addModel = (id, name, category = null, description = "", source = "qoder") => {
    const cleanId = String(id || "").trim();
    if (!cleanId || cleanId === "<synthetic>") return;
    const forbidden = isForbiddenModel(cleanId);
    const cat = category || (isFlashLikeModel(cleanId) ? "flash" : "large");
    if (!discoveredMap.has(cleanId)) {
      discoveredMap.set(cleanId, {
        id: cleanId,
        name: name || cleanId,
        category: cat,
        description,
        forbidden,
        source,
      });
    }
  };

  // Seed canonical Qoder roster
  addModel("qwen3.8-max", "Qwen3.8 Max", "large", "Qoder 首席规划与内审大模型", "qoder-core");
  addModel("kimi-3.1-pro", "Kimi 3.1 Pro", "large", "Qoder 联合规划与长上下文终审大模型", "qoder-core");
  addModel("glm-5.3", "GLM-5.3", "large", "Qoder 架构与代码内审大模型", "qoder-core");
  addModel("qwen3.8-flash", "Qwen3.8 Flash", "flash", "Qoder 主力高速代码落地 Flash", "qoder-core");
  addModel("deepseek-v4.1-flash", "DeepSeek V4.1 Flash", "flash", "Qoder 逻辑代码高速执行 Flash", "qoder-core");
  addModel("glm-5.3-flash", "GLM-5.3 Flash", "flash", "Qoder 内部自检与快速执行 Flash", "qoder-core");

  // Scan pi-ai catalogs for Qwen / GLM / DeepSeek / Kimi
  const piAiDataDir = path.join(
    home,
    ".dsh/profiles/desktop/node_modules/@earendil-works/pi-ai/dist/providers/data"
  );
  for (const file of [
    "qwen-token-plan-cn.json",
    "zai-coding-cn.json",
    "deepseek.json",
    "kimi-coding.json",
  ]) {
    const full = path.join(piAiDataDir, file);
    if (!fs.existsSync(full)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(full, "utf8"));
      const bucket = Object.values(raw)[0] || {};
      for (const [mId, meta] of Object.entries(bucket)) {
        addModel(
          mId,
          meta?.name || mId,
          isFlashLikeModel(mId) ? "flash" : "large",
          `扫描自 ${file.replace(".json", "")}`,
          file
        );
      }
    } catch {
      // ignore
    }
  }

  return [...discoveredMap.values()];
}

/**
 * Scan local WorkBuddy model catalogs (~/.dsh/.workbuddy-ai-catalog.json & ~/.dsh/.workbuddy-catalog.json)
 */
function scanWorkBuddyModels() {
  const home = os.homedir();
  const discoveredMap = new Map();

  const addModel = (
    id,
    name,
    category = null,
    credits = null,
    description = "",
    source = "workbuddy"
  ) => {
    const cleanId = String(id || "").trim();
    if (!cleanId) return;
    const forbidden = isForbiddenModel(cleanId);
    const cat = category || (isFlashLikeModel(cleanId) ? "flash" : "large");
    if (!discoveredMap.has(cleanId)) {
      discoveredMap.set(cleanId, {
        id: cleanId,
        name: name || cleanId,
        category: cat,
        credits: credits || null,
        description: description || (credits ? `计费倍率: ${credits}` : ""),
        forbidden,
        source,
      });
    }
  };

  // Seed canonical WorkBuddy models
  addModel("kimi-3.1-pro", "Kimi 3.1 Pro (kimi-k3-1)", "large", "x1.62 credits", "WorkBuddy 首席规划与内审大模型", "wb-core");
  addModel("glm-5.3", "GLM-5.3", "large", "x0.79 credits", "WorkBuddy 架构与质检大模型", "wb-core");
  addModel("qwen3.8-max", "Qwen3.8 Max (hy4-preview)", "large", "x0.29 credits", "WorkBuddy 联合规划与终审大模型", "wb-core");
  addModel("deepseek-v4.1-flash", "DeepSeek V4.1 Flash", "flash", "x0.03~0.11 credits", "WorkBuddy 首席高速执行官", "wb-core");
  addModel("glm-5.3-flash", "GLM-5.3 Flash", "flash", "x0.06 credits", "WorkBuddy 代码落地与自检执行官", "wb-core");
  addModel("qwen3.8-flash", "Qwen3.8 Flash", "flash", "x0.03 credits", "WorkBuddy 敏捷代码执行官", "wb-core");

  for (const catalogFile of [".workbuddy-catalog.json", ".workbuddy-ai-catalog.json"]) {
    const full = path.join(home, ".dsh", catalogFile);
    if (!fs.existsSync(full)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(full, "utf8"));
      for (const entry of Object.values(raw?.entries || {})) {
        for (const m of entry?.models || []) {
          if (!m?.id || m.id === "default-model") continue;
          addModel(
            m.id,
            m.name || m.id,
            isFlashLikeModel(m.id) ? "flash" : "large",
            m.billing?.credits || null,
            m.billing?.credits ? `WorkBuddy 目录 (${m.billing.credits})` : `扫描自 ${catalogFile}`,
            catalogFile
          );
        }
      }
    } catch {
      // ignore
    }
  }

  return [...discoveredMap.values()];
}

function buildDefaultConfig() {
  return {
    version: 1,
    autoDailyScan: true,
    lastScanAt: null,
    lastScanDate: null,
    scanCount: 0,
    discovered: {
      codex: [],
      qoder: [],
      workbuddy: [],
    },
    customModels: {
      codex: [],
      qoder: [],
      workbuddy: [],
    },
    departments: {
      codex: {
        activeModels: ["gpt-6.1-terra", "gpt-6.1-sol", "gpt-6-astra"],
        defaultModel: "gpt-6.1-sol",
        defaultReviewerModel: "gpt-6.1-terra",
        escalationModel: "gpt-6-astra",
      },
      qoder: {
        plannerModels: ["qwen3.8-max", "kimi-3.1-pro", "glm-5.3"],
        executorModels: ["qwen3.8-flash", "deepseek-v4.1-flash", "glm-5.3-flash"],
        defaultPlannerModel: "qwen3.8-max",
        defaultReviewerModel: "glm-5.3",
        defaultExecutorModel: "qwen3.8-flash",
      },
      workbuddy: {
        plannerModels: ["kimi-3.1-pro", "glm-5.3", "qwen3.8-max"],
        executorModels: ["deepseek-v4.1-flash", "glm-5.3-flash", "qwen3.8-flash"],
        defaultPlannerModel: "kimi-3.1-pro",
        defaultReviewerModel: "glm-5.3",
        defaultExecutorModel: "deepseek-v4.1-flash",
      },
    },
  };
}

let cachedConfig = null;
let dailyTimer = null;

function loadConfigFromDisk() {
  const base = buildDefaultConfig();
  if (fs.existsSync(MODEL_CONFIG_PATH)) {
    try {
      const saved = JSON.parse(fs.readFileSync(MODEL_CONFIG_PATH, "utf8"));
      if (saved && typeof saved === "object") {
        base.autoDailyScan = saved.autoDailyScan !== false;
        base.lastScanAt = saved.lastScanAt || null;
        base.lastScanDate = saved.lastScanDate || null;
        base.scanCount = Number(saved.scanCount) || 0;
        if (saved.discovered) {
          base.discovered = { ...base.discovered, ...saved.discovered };
        }
        if (saved.customModels) {
          base.customModels = { ...base.customModels, ...saved.customModels };
        }
        if (saved.departments) {
          for (const k of ["codex", "qoder", "workbuddy"]) {
            if (saved.departments[k]) {
              base.departments[k] = {
                ...base.departments[k],
                ...saved.departments[k],
              };
            }
          }
        }
      }
    } catch {
      // fallback to base
    }
  }
  return base;
}

function saveConfigToDisk(cfg) {
  try {
    fs.mkdirSync(path.dirname(MODEL_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(MODEL_CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
  } catch {
    // ignore disk errors
  }
}

function mergeCustomWithDiscovered(discoveredList = [], customList = []) {
  const map = new Map();
  for (const item of discoveredList) {
    if (item?.id) map.set(item.id, item);
  }
  for (const item of customList) {
    if (item?.id && !map.has(item.id)) {
      map.set(item.id, {
        ...item,
        forbidden: isForbiddenModel(item.id),
        source: "custom",
      });
    }
  }
  return [...map.values()];
}

/**
 * Perform an immediate scan of available models for Codex, Qoder, and WorkBuddy,
 * persist to disk, and sync COMPANY_ROSTER.
 */
export function scanAndRefreshModels({ reason = "manual" } = {}) {
  const cfg = cachedConfig || loadConfigFromDisk();
  const now = new Date();

  const codexScanned = scanCodexModels();
  const qoderScanned = scanQoderModels();
  const wbScanned = scanWorkBuddyModels();

  cfg.discovered = {
    codex: mergeCustomWithDiscovered(codexScanned, cfg.customModels?.codex),
    qoder: mergeCustomWithDiscovered(qoderScanned, cfg.customModels?.qoder),
    workbuddy: mergeCustomWithDiscovered(wbScanned, cfg.customModels?.workbuddy),
  };
  cfg.departments.codex.discoveredModels = cfg.discovered.codex;
  cfg.departments.qoder.discoveredModels = cfg.discovered.qoder;
  cfg.departments.workbuddy.discoveredModels = cfg.discovered.workbuddy;
  cfg.departments.codex.defaultPlannerModel =
    cfg.departments.codex.defaultPlannerModel || cfg.departments.codex.defaultModel || "gpt-6.1-sol";
  cfg.lastScanAt = now.toISOString();
  cfg.lastScannedAt = cfg.lastScanAt;
  cfg.lastScanDate = now.toISOString().slice(0, 10);
  cfg.lastScanReason = reason;
  cfg.scanCount = (cfg.scanCount || 0) + 1;

  // Ensure gpt-6.1-terra, gpt-6.1-sol, gpt-6-astra are in codex.activeModels if not explicitly removed
  if (!Array.isArray(cfg.departments.codex.activeModels) || cfg.departments.codex.activeModels.length === 0) {
    cfg.departments.codex.activeModels = ["gpt-6.1-terra", "gpt-6.1-sol", "gpt-6-astra"];
  }

  cachedConfig = cfg;
  saveConfigToDisk(cfg);
  applyCustomModelConfigToRoster(cfg);
  return cfg;
}

/**
 * Get the current model configuration & discovered catalog (auto-scanning if > 24h or never scanned).
 */
export function getModelConfig({ forceScan = false } = {}) {
  if (!cachedConfig) {
    cachedConfig = loadConfigFromDisk();
    applyCustomModelConfigToRoster(cachedConfig);
  }
  const today = new Date().toISOString().slice(0, 10);
  const lastScanMs = cachedConfig.lastScanAt ? Date.parse(cachedConfig.lastScanAt) : 0;
  const needsDailyScan =
    forceScan ||
    !cachedConfig.lastScanAt ||
    cachedConfig.lastScanDate !== today ||
    Date.now() - lastScanMs >= ONE_DAY_MS ||
    (cachedConfig.discovered?.codex || []).length === 0;

  if (needsDailyScan) {
    return scanAndRefreshModels({ reason: forceScan ? "manual" : "daily-auto-scan" });
  }
  cachedConfig.lastScannedAt = cachedConfig.lastScanAt;
  cachedConfig.departments.codex.discoveredModels = cachedConfig.discovered?.codex || [];
  cachedConfig.departments.qoder.discoveredModels = cachedConfig.discovered?.qoder || [];
  cachedConfig.departments.workbuddy.discoveredModels = cachedConfig.discovered?.workbuddy || [];
  return cachedConfig;
}

/**
 * Update user-selected models or add a custom model from the GUI console.
 */
export function updateModelConfig(patch = {}) {
  const cfg = getModelConfig({ forceScan: false });

  if (patch.action === "scan") {
    return scanAndRefreshModels({ reason: "manual-button" });
  }

  if (patch.action === "reset") {
    const fresh = buildDefaultConfig();
    fresh.customModels = { codex: [], qoder: [], workbuddy: [] };
    cachedConfig = fresh;
    return scanAndRefreshModels({ reason: "reset-defaults" });
  }

  // Optional: Add a custom model ID
  if (patch.addCustomModel && typeof patch.addCustomModel === "object") {
    const { department, id, name, category, tier } = patch.addCustomModel;
    const cleanDept = String(department || "").toLowerCase();
    const cleanId = String(id || "").trim();
    if (["codex", "qoder", "workbuddy"].includes(cleanDept) && cleanId) {
      if (isForbiddenModel(cleanId)) {
        throw new Error(`公司铁律严禁启用或添加 luna 系列模型 ("${cleanId}")`);
      }
      if (!Array.isArray(cfg.customModels[cleanDept])) {
        cfg.customModels[cleanDept] = [];
      }
      const cat =
        cleanDept === "codex"
          ? "planner-reviewer"
          : category === "flash" || tier === "executor" || isFlashLikeModel(cleanId)
          ? "flash"
          : "large";
      if (!cfg.customModels[cleanDept].some((m) => m.id === cleanId)) {
        cfg.customModels[cleanDept].push({
          id: cleanId,
          name: String(name || cleanId).trim(),
          category: cat,
          description: "用户手动添加模型",
          forbidden: false,
          source: "custom",
        });
      }
      // Also auto-enable the newly added model
      if (cleanDept === "codex") {
        if (!cfg.departments.codex.activeModels.includes(cleanId)) {
          cfg.departments.codex.activeModels.push(cleanId);
        }
      } else if (cat === "flash") {
        if (!cfg.departments[cleanDept].executorModels.includes(cleanId)) {
          cfg.departments[cleanDept].executorModels.push(cleanId);
        }
      } else {
        if (!cfg.departments[cleanDept].plannerModels.includes(cleanId)) {
          cfg.departments[cleanDept].plannerModels.push(cleanId);
        }
      }
    }
  }

  // Apply department model selection updates (supports both `patch.departments.codex` and top-level `patch.codex`)
  const deptPatchSource =
    patch.departments && typeof patch.departments === "object"
      ? patch.departments
      : patch;
  if (deptPatchSource && typeof deptPatchSource === "object") {
    for (const deptKey of ["codex", "qoder", "workbuddy"]) {
      const incoming = deptPatchSource[deptKey];
      if (!incoming || typeof incoming !== "object") continue;

      if (deptKey === "codex") {
        if (Array.isArray(incoming.activeModels)) {
          const clean = incoming.activeModels
            .map((x) => String(x || "").trim())
            .filter((x) => x && !isForbiddenModel(x));
          if (clean.length > 0) {
            cfg.departments.codex.activeModels = [...new Set(clean)];
          }
        }
        const incomingPlanner = incoming.defaultPlannerModel || incoming.defaultModel;
        if (incomingPlanner && !isForbiddenModel(incomingPlanner)) {
          const m = String(incomingPlanner).trim();
          cfg.departments.codex.defaultModel = m;
          cfg.departments.codex.defaultPlannerModel = m;
          if (!cfg.departments.codex.activeModels.includes(m)) {
            cfg.departments.codex.activeModels.unshift(m);
          }
        }
        if (incoming.defaultReviewerModel && !isForbiddenModel(incoming.defaultReviewerModel)) {
          const m = String(incoming.defaultReviewerModel).trim();
          cfg.departments.codex.defaultReviewerModel = m;
          if (!cfg.departments.codex.activeModels.includes(m)) {
            cfg.departments.codex.activeModels.push(m);
          }
        }
        if (incoming.escalationModel && !isForbiddenModel(incoming.escalationModel)) {
          const m = String(incoming.escalationModel).trim();
          cfg.departments.codex.escalationModel = m;
          if (!cfg.departments.codex.activeModels.includes(m)) {
            cfg.departments.codex.activeModels.push(m);
          }
        }
      } else {
        if (Array.isArray(incoming.plannerModels)) {
          const clean = incoming.plannerModels
            .map((x) => String(x || "").trim())
            .filter((x) => x && !isForbiddenModel(x));
          if (clean.length > 0) {
            cfg.departments[deptKey].plannerModels = [...new Set(clean)];
            if (!clean.includes(cfg.departments[deptKey].defaultPlannerModel)) {
              cfg.departments[deptKey].defaultPlannerModel = clean[0];
            }
            if (!clean.includes(cfg.departments[deptKey].defaultReviewerModel)) {
              cfg.departments[deptKey].defaultReviewerModel = clean[clean.length > 1 ? 1 : 0];
            }
          }
        }
        if (Array.isArray(incoming.executorModels)) {
          const clean = incoming.executorModels
            .map((x) => String(x || "").trim())
            .filter((x) => x && !isForbiddenModel(x));
          if (clean.length > 0) {
            cfg.departments[deptKey].executorModels = [...new Set(clean)];
            if (!clean.includes(cfg.departments[deptKey].defaultExecutorModel)) {
              cfg.departments[deptKey].defaultExecutorModel = clean[0];
            }
          }
        }
        if (incoming.defaultPlannerModel && !isForbiddenModel(incoming.defaultPlannerModel)) {
          const m = String(incoming.defaultPlannerModel).trim();
          cfg.departments[deptKey].defaultPlannerModel = m;
          if (!cfg.departments[deptKey].plannerModels.includes(m)) {
            cfg.departments[deptKey].plannerModels.unshift(m);
          }
        }
        if (incoming.defaultReviewerModel && !isForbiddenModel(incoming.defaultReviewerModel)) {
          const m = String(incoming.defaultReviewerModel).trim();
          cfg.departments[deptKey].defaultReviewerModel = m;
          if (!cfg.departments[deptKey].plannerModels.includes(m)) {
            cfg.departments[deptKey].plannerModels.push(m);
          }
        }
        if (incoming.defaultExecutorModel && !isForbiddenModel(incoming.defaultExecutorModel)) {
          const m = String(incoming.defaultExecutorModel).trim();
          cfg.departments[deptKey].defaultExecutorModel = m;
          if (!cfg.departments[deptKey].executorModels.includes(m)) {
            cfg.departments[deptKey].executorModels.unshift(m);
          }
        }
      }
    }
  }

  cfg.discovered = {
    codex: mergeCustomWithDiscovered(cfg.discovered?.codex || [], cfg.customModels?.codex || []),
    qoder: mergeCustomWithDiscovered(cfg.discovered?.qoder || [], cfg.customModels?.qoder || []),
    workbuddy: mergeCustomWithDiscovered(
      cfg.discovered?.workbuddy || [],
      cfg.customModels?.workbuddy || []
    ),
  };
  cfg.departments.codex.discoveredModels = cfg.discovered.codex;
  cfg.departments.qoder.discoveredModels = cfg.discovered.qoder;
  cfg.departments.workbuddy.discoveredModels = cfg.discovered.workbuddy;
  cfg.lastScannedAt = cfg.lastScanAt;

  cachedConfig = cfg;
  saveConfigToDisk(cfg);
  applyCustomModelConfigToRoster(cfg);
  return cfg;
}

/**
 * Start background daily auto-scanner (checks once per hour if the date changed or 24h elapsed).
 */
export function startDailyModelScanner() {
  // Run initial check immediately
  try {
    getModelConfig({ forceScan: false });
  } catch {
    // ignore
  }
  if (dailyTimer) clearInterval(dailyTimer);
  dailyTimer = setInterval(() => {
    try {
      getModelConfig({ forceScan: false });
    } catch {
      // ignore
    }
  }, 60 * 60 * 1000);
  if (typeof dailyTimer.unref === "function") {
    dailyTimer.unref();
  }
  return () => {
    if (dailyTimer) {
      clearInterval(dailyTimer);
      dailyTimer = null;
    }
  };
}
