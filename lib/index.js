import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  COMPANY_ROSTER,
  getCompanyStatus,
  getModelConfig,
  updateModelConfig,
  scanAndRefreshModels,
  startDailyModelScanner,
  planWithCodex,
  dispatchWorkerTask,
  runInternalRoundtable,
  sanitizeInterAgentMessage,
  dshDirectIntervene,
  runFullCompanyPipeline,
  MCP_TOOLS,
  executeMcpToolCall,
} from "../src/index.js";
import { getCompanyBalances } from "../src/orchestrator/balance-service.js";

// Re-export all SDK symbols so `import ... from "dsh-company-multiagent"` works for both DSH Host and Node SDK consumers
export * from "../src/index.js";
export { getCompanyBalances } from "../src/orchestrator/balance-service.js";

// Optional schemastery loader (MUST use ESM import() so it shares the exact ESM Schema class with DSH host, avoiding the CJS/ESM dual-package hazard)
let z = null;
try {
  const mod = await import("@deepseek-ai/schemastery");
  z = mod.default || mod;
} catch {
  try {
    const fallbackMjs = path.join(
      os.homedir(),
      ".dsh/profiles/desktop/node_modules/@deepseek-ai/schemastery/lib/index.mjs"
    );
    if (fs.existsSync(fallbackMjs)) {
      const mod = await import(pathToFileURL(fallbackMjs).href);
      z = mod.default || mod;
    }
  } catch {
    z = null;
  }
}

export const name = "dsh-company-multiagent";
export const inject = ["webServer"];

export const Config = z
  ? z.object({
      enabled: z.boolean().default(true).volatile(),
      defaultWorkspace: z
        .string()
        .default("/Users/baiqin/Documents/try/multiagent")
        .volatile(),
      enableInternalMeetingsByDefault: z.boolean().default(true).volatile(),
      balancePollSeconds: z.number().min(10).max(300).default(20).volatile(),
    })
  : undefined;

const MOUNTED = Symbol.for("dsh-web.mounted-plugins");
const WAITERS = Symbol.for("dsh-web.mounted-plugins.waiters");

function mountedSet() {
  const registry = globalThis;
  const existing = registry[MOUNTED];
  if (existing instanceof Set) return existing;
  const created = new Set();
  registry[MOUNTED] = created;
  return created;
}

function mountWaiters() {
  const registry = globalThis;
  return (registry[WAITERS] ??= new Map());
}

function mountOnce(packageName, fn) {
  const mount = (...args) => {
    const mounted = mountedSet();
    const ctx = args[0];
    if (mounted.has(packageName)) {
      const waiters = mountWaiters();
      const queue = waiters.get(packageName) ?? [];
      let alive = true;
      const pending = {
        run: () => {
          if (alive) mount(...args);
        },
      };
      ctx?.effect?.(() => () => {
        alive = false;
        const index = queue.indexOf(pending);
        if (index >= 0) queue.splice(index, 1);
      });
      queue.push(pending);
      waiters.set(packageName, queue);
      return;
    }
    mounted.add(packageName);
    ctx?.effect?.(() => () => {
      mounted.delete(packageName);
      const waiters = mountWaiters();
      const queue = waiters.get(packageName);
      if (queue === undefined) return;
      waiters.delete(packageName);
      for (const waiter of queue.splice(0)) {
        queueMicrotask(() => {
          waiter.run();
        });
      }
    });
    return fn(...args);
  };
  return mount;
}

function readConfigField(field, fallback) {
  if (field === undefined) return fallback;
  if (typeof field === "object" && field !== null && typeof field.get === "function") {
    return field.get();
  }
  return field;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
};

function writeJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...JSON_HEADERS,
    ...headers,
  });
  res.end(payload);
}

function readRequestBody(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error(`Invalid JSON body: ${err.message}`));
      }
    });
    req.on("error", reject);
  });
}

function isLoopbackOrPaired(ctx, req) {
  const addr = req?.socket?.remoteAddress || "";
  if (
    addr === "127.0.0.1" ||
    addr === "::1" ||
    addr.startsWith("::ffff:127.") ||
    addr === ""
  ) {
    return true;
  }
  try {
    const pairing =
      typeof ctx?.get === "function"
        ? ctx.get("remoteWebUiPairing", false)
        : ctx?.remoteWebUiPairing;
    if (pairing && typeof pairing.isPairedDevice === "function") {
      return pairing.isPairedDevice(req) === true;
    }
  } catch {
    // ignore
  }
  return false;
}

function deepFreeze(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    deepFreeze(obj[key]);
  }
  return obj;
}

function buildFrozenUserMessage(text, attachments = []) {
  return deepFreeze({
    id: crypto.randomUUID(),
    role: "user",
    content: [
      ...(Array.isArray(attachments) ? structuredClone(attachments) : []),
      ...(text ? [{ type: "text", text: String(text) }] : []),
    ],
    source: { kind: "user" },
  });
}

const HISTORY_FILE = path.join(os.homedir(), ".dsh", "dsh-company", "runs-history.json");

function loadPersistedState() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
      const sessionLedger = data.sessionLedger || createDefaultSessionLedger();
      if (sessionLedger.doubao && sessionLedger.doubao.lastModel === "doubao-expert") {
        sessionLedger.doubao.lastModel = "doubao-2.1-pro";
      }
      return {
        sessionLedger,
        recentRuns: Array.isArray(data.recentRuns) ? data.recentRuns.slice(0, 25) : [],
        companyModeBySession:
          data.companyModeBySession && typeof data.companyModeBySession === "object"
            ? data.companyModeBySession
            : {},
        globalCompanyMode: Boolean(data.globalCompanyMode),
        autoDispatchOnSwitch:
          data.autoDispatchOnSwitch !== undefined ? Boolean(data.autoDispatchOnSwitch) : true,
      };
    }
  } catch {
    // ignore
  }
  return {
    sessionLedger: createDefaultSessionLedger(),
    recentRuns: [],
    companyModeBySession: {},
    globalCompanyMode: false,
    autoDispatchOnSwitch: true,
  };
}

function savePersistedState(
  sessionLedger,
  recentRuns,
  companyModeBySession = {},
  globalCompanyMode = false,
  autoDispatchOnSwitch = true
) {
  try {
    fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
    fs.writeFileSync(
      HISTORY_FILE,
      JSON.stringify(
        {
          updatedAt: Date.now(),
          sessionLedger,
          recentRuns: recentRuns.slice(0, 25),
          companyModeBySession,
          globalCompanyMode,
          autoDispatchOnSwitch,
        },
        null,
        2
      ),
      "utf8"
    );
  } catch {
    // ignore
  }
}

function createDefaultSessionLedger() {
  return {
    codex: { calls: 0, estimatedTokens: 0, lastModel: "gpt-6.1-sol" },
    qoder: { calls: 0, estimatedTokens: 0, lastModel: "qwen3.8-max" },
    workbuddy: { calls: 0, estimatedTokens: 0, lastModel: "kimi-3.1-pro" },
    doubao: { calls: 0, estimatedTokens: 0, lastModel: "doubao-2.1-pro" },
  };
}

export const FOREMAN_TRIGGER_PROMPT =
  "【🏢 集团公司模式已开启 — 请立即找下面的人干活】董事长已打开公司模式开关！请立即根据我们刚才在对话中沟通确认的需求与方案，作为 L2 集团总包工头调用集团调度工具（优先调用 `run_company_pipeline`）将任务分发给麾下四个独立计费部门（Codex [gpt-6.1-terra / gpt-6.1-sol / gpt-6-astra 负责顶层规划与公司层面审核，严禁 luna]、Qoder [大模型规划内审+Flash施工]、WorkBuddy [大模型规划内审+Flash施工]、豆包 [仅负责跨部门传话与防勾连隔离，不参与审核]）协同执行，最后由你（DSH对话框主模型）完成最终审核并向董事长汇报完整执行结果与两张用量统计表！";

/**
 * Host runtime state for the Four-Tier Company Mode & Chat Dialog Switch.
 */
export class CompanyHostService {
  constructor(ctx, config = {}) {
    this.ctx = ctx;
    this.config = config;
    const persisted = loadPersistedState();
    this.sessionLedger = persisted.sessionLedger;
    this.recentRuns = persisted.recentRuns;
    this.companyModeBySession = persisted.companyModeBySession || {};
    this.globalCompanyMode = Boolean(persisted.globalCompanyMode);
    this.autoDispatchOnSwitch =
      persisted.autoDispatchOnSwitch !== undefined ? Boolean(persisted.autoDispatchOnSwitch) : true;
    this.activeRun = null;
    this.pollTimer = null;
    this.lastAutoPipelineBySession = new Map();
  }

  persist() {
    savePersistedState(
      this.sessionLedger,
      this.recentRuns,
      this.companyModeBySession,
      this.globalCompanyMode,
      this.autoDispatchOnSwitch
    );
  }

  defaultWorkspace() {
    return (
      readConfigField(
        this.config?.defaultWorkspace,
        "/Users/baiqin/Documents/try/multiagent"
      ) || "/Users/baiqin/Documents/try/multiagent"
    );
  }

  resolveSessionPresetId(sessionObj) {
    if (!sessionObj || typeof sessionObj !== "object") return null;
    try {
      const projections =
        typeof this.ctx?.get === "function"
          ? this.ctx.get("sessionProjections", false)
          : this.ctx?.sessionProjections;
      if (projections && typeof projections.stateOf === "function") {
        const presetId = projections.stateOf(sessionObj, "agentPreset");
        if (typeof presetId === "string" && presetId) return presetId;
      }
    } catch {
      // ignore
    }
    if (typeof sessionObj?.header?.agentPreset === "string" && sessionObj.header.agentPreset) {
      return sessionObj.header.agentPreset;
    }
    if (typeof sessionObj?.presetId === "string" && sessionObj.presetId) {
      return sessionObj.presetId;
    }
    if (Array.isArray(sessionObj?.events)) {
      let latestPreset = null;
      for (const ev of sessionObj.events) {
        if (ev?.type === "session/preset" && typeof ev?.data?.presetId === "string") {
          latestPreset = ev.data.presetId;
        }
      }
      if (latestPreset) return latestPreset;
    }
    return null;
  }

  isSessionInCompanyMode(sessionOrId) {
    let sessionId = null;
    let sessionObj = null;
    if (typeof sessionOrId === "string") {
      sessionId = sessionOrId;
    } else if (sessionOrId && typeof sessionOrId === "object") {
      sessionObj = sessionOrId;
      sessionId = sessionOrId.id || null;
    }

    // Strictly check the session's active Agent Preset first:
    // ONLY the "company" preset is in Company Mode; any other preset ("standard", "liangshen", "ptc", etc.) is NOT!
    const presetId = this.resolveSessionPresetId(sessionObj);
    if (presetId) {
      return presetId === "company";
    }

    if (sessionId && Object.hasOwn(this.companyModeBySession, sessionId)) {
      return Boolean(this.companyModeBySession[sessionId]?.enabled);
    }

    return false;
  }

  getSessionModeStatus(sessionId = null) {
    const enabled = sessionId
      ? Object.hasOwn(this.companyModeBySession, sessionId)
        ? Boolean(this.companyModeBySession[sessionId]?.enabled)
        : Boolean(this.globalCompanyMode)
      : Boolean(this.globalCompanyMode);
    const sessions = {};
    for (const [sid, val] of Object.entries(this.companyModeBySession || {})) {
      sessions[sid] = typeof val === "object" && val !== null ? Boolean(val.enabled) : Boolean(val);
    }
    return {
      ok: true,
      sessionId: sessionId || null,
      enabled,
      globalCompanyMode: Boolean(this.globalCompanyMode),
      globalDefault: Boolean(this.globalCompanyMode),
      autoDispatchOnSwitch: Boolean(this.autoDispatchOnSwitch),
      sessionModes: this.companyModeBySession,
      sessions,
    };
  }

  setSessionMode({
    sessionId = null,
    enabled,
    applyGlobal = false,
    globalDefault,
    autoDispatchOnSwitch,
  } = {}) {
    const nextEnabled = Boolean(enabled);
    if (autoDispatchOnSwitch !== undefined) {
      this.autoDispatchOnSwitch = Boolean(autoDispatchOnSwitch);
    }
    if (sessionId) {
      this.companyModeBySession[sessionId] = {
        enabled: nextEnabled,
        updatedAt: Date.now(),
      };
    }
    if (typeof globalDefault === "boolean") {
      this.globalCompanyMode = globalDefault;
    } else if (applyGlobal || !sessionId) {
      this.globalCompanyMode = nextEnabled;
    }
    this.persist();
    return this.getSessionModeStatus(sessionId);
  }

  steerLiveAgent(sessionId, promptText, attachments = []) {
    if (!sessionId || !promptText) {
      return { ok: false, reason: "missing-session-or-prompt" };
    }
    try {
      const agentsSvc =
        typeof this.ctx?.get === "function"
          ? this.ctx.get("agents", false)
          : this.ctx?.agents;
      const agent = agentsSvc?.get?.(sessionId);
      if (agent && typeof agent.steer === "function") {
        const msg = buildFrozenUserMessage(promptText, attachments);
        if (agent.status === "idle" && typeof agent.followup === "function") {
          agent.followup(msg);
        } else {
          agent.steer(msg);
        }
        return { ok: true, via: "host-agent-steer", agentStatus: agent.status };
      }
    } catch (err) {
      return { ok: false, reason: err.message || String(err) };
    }
    return { ok: false, reason: "agent-not-live-in-host-registry" };
  }

  start() {
    this.stopModelScanner = startDailyModelScanner();
    getCompanyBalances({ force: true, sessionLedger: this.sessionLedger }).catch(() => {});
    const pollSec = Math.max(
      10,
      Number(readConfigField(this.config?.balancePollSeconds, 25)) || 25
    );
    this.pollTimer = setInterval(() => {
      getCompanyBalances({ force: true, sessionLedger: this.sessionLedger }).catch(() => {});
    }, pollSec * 1000);
    this.pollTimer.unref?.();
  }

  stop() {
    if (typeof this.stopModelScanner === "function") {
      this.stopModelScanner();
      this.stopModelScanner = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  recordQuotaEntries(quotaLedger = [], fallbackDept = null, fallbackModel = null) {
    if (Array.isArray(quotaLedger) && quotaLedger.length > 0) {
      for (const entry of quotaLedger) {
        const dept = String(entry.department || "").toLowerCase();
        if (this.sessionLedger[dept]) {
          this.sessionLedger[dept].calls += 1;
          this.sessionLedger[dept].estimatedTokens += Number(entry.estimatedTokens || 1200);
          if (entry.model) {
            this.sessionLedger[dept].lastModel = entry.model;
          }
        }
      }
    } else if (fallbackDept && this.sessionLedger[fallbackDept]) {
      this.sessionLedger[fallbackDept].calls += 1;
      this.sessionLedger[fallbackDept].estimatedTokens += 1200;
      if (fallbackModel) {
        this.sessionLedger[fallbackDept].lastModel = fallbackModel;
      }
    }
    this.persist();
  }

  async overview({ forceBalances = false, sessionId = null } = {}) {
    const modelConfig = getModelConfig({ forceScan: false });
    const [company, balances] = await Promise.all([
      getCompanyStatus(),
      getCompanyBalances({ force: forceBalances, sessionLedger: this.sessionLedger }),
    ]);

    let registeredPresets = [];
    try {
      const reg =
        typeof this.ctx?.get === "function"
          ? this.ctx.get("agentPresets", false)
          : this.ctx?.agentPresets;
      if (reg?.definitions instanceof Map) {
        registeredPresets = [...reg.definitions.keys()];
      }
    } catch {}

    return {
      ok: true,
      updatedAt: Date.now(),
      defaultWorkspace: this.defaultWorkspace(),
      enableInternalMeetingsByDefault: Boolean(
        readConfigField(this.config?.enableInternalMeetingsByDefault, true)
      ),
      presetStatus: {
        ...(this.presetStatus || { registered: false }),
        registeredPresets,
      },
      companyMode: this.getSessionModeStatus(sessionId),
      modelConfig,
      company,
      balances,
      sessionLedger: this.sessionLedger,
      activeRun: this.activeRun,
      recentRuns: this.recentRuns,
    };
  }

  clearHistory() {
    this.recentRuns = [];
    this.persist();
    return { ok: true };
  }

  async executeAction(payload = {}) {
    const action = String(payload.action || "pipeline");
    const goal = String(
      payload.goal || payload.prompt || payload.message || "执行四级智能体集团协同任务"
    ).trim();
    const workspaceRoot = String(
      payload.workspaceRoot || this.defaultWorkspace()
    ).trim();
    const department = String(payload.department || "qoder").trim();
    const allowedFiles = Array.isArray(payload.allowedFiles)
      ? payload.allowedFiles
      : typeof payload.allowedFiles === "string" && payload.allowedFiles.trim()
      ? payload.allowedFiles
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : ["*"];
    const enableInternalMeetings =
      payload.enableInternalMeetings !== undefined
        ? Boolean(payload.enableInternalMeetings)
        : true;
    const complexity = String(payload.complexity || "medium");
    const runAsync = payload.async !== false;

    const runRecord = {
      runId: `run-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      action,
      goal: goal.slice(0, 200),
      workspaceRoot,
      department,
      allowedFiles,
      enableInternalMeetings,
      status: "running",
      stage: this.describeInitialStage(action, department, enableInternalMeetings),
      startedAt: Date.now(),
      endedAt: null,
      durationMs: 0,
      logs: [
        `[${new Date().toLocaleTimeString()}] 董事长下达指令 (${action})：${goal.slice(0, 100)}`,
      ],
      result: null,
      reportMarkdown: null,
      error: null,
    };

    this.activeRun = runRecord;

    const executePromise = (async () => {
      try {
        const quotaLedger = [];
        let result;
        let reportMarkdown = "";

        if (action === "pipeline") {
          runRecord.stage =
            "阶段 1/4：L3 Codex (gpt-6.1-sol / gpt-6.1-terra) 正在进行顶层规划与子任务拆解，划分 allowedFiles 围挡...";
          runRecord.logs.push(
            `[${new Date().toLocaleTimeString()}] 启动全链路四级集团流水线 (L4 内部四步内审: ${
              enableInternalMeetings ? "开启" : "关闭"
            })`
          );
          result = await runFullCompanyPipeline({
            goal,
            workspaceRoot,
            enableInternalMeetings,
            expectFileChanges: Boolean(payload.expectFileChanges),
            subtasks: Array.isArray(payload.subtasks) ? payload.subtasks : null,
            timeoutMs: Number(payload.timeoutMs) || 90000,
            mockRunner: payload.mockRunner || null,
          });
          reportMarkdown = result.bossReport || "";
          this.recordQuotaEntries(result.quotaLedger || []);
        } else if (action === "plan") {
          runRecord.stage =
            "L3 Codex (gpt-6.1-terra / gpt-6.1-sol / gpt-6-astra，禁用 luna) 正在编制顶层架构规划...";
          result = await planWithCodex({
            goal,
            workspaceRoot,
            useInternalMeeting: enableInternalMeetings,
            forceEscalateToAstra: Boolean(payload.forceEscalateToAstra),
            mockRunner: payload.mockRunner || null,
            quotaLedger,
          });
          reportMarkdown = [
            `# 📐 Codex 规划与公司级审核院 (${result.model}) 顶层拆解方案`,
            ``,
            result.planSummary || "",
            ``,
            `## 拆解子任务清单 (${(result.subtasks || []).length} 项)`,
            "```json",
            JSON.stringify(result.subtasks || [], null, 2),
            "```",
          ].join("\n");
          this.recordQuotaEntries(quotaLedger, "codex", result.model);
        } else if (action === "dispatch") {
          runRecord.stage = `L3 ${department.toUpperCase()} 正在施工 (L4 内部四步同构分工内审: ${
            enableInternalMeetings ? "已启用" : "单模型直跑"
          })...`;
          result = await dispatchWorkerTask({
            id: `gui-task-${Date.now()}`,
            department,
            subtaskTitle: payload.subtaskTitle || goal.slice(0, 60),
            prompt: goal,
            model: payload.model || "auto",
            complexity,
            workspaceRoot,
            allowedFiles,
            allowFileEdits: payload.allowFileEdits !== false,
            expectFileChanges: Boolean(payload.expectFileChanges),
            useInternalMeeting: enableInternalMeetings,
            mockRunner: payload.mockRunner || null,
            quotaLedger,
          });
          reportMarkdown = [
            `# 🛠️ ${department.toUpperCase()} 施工与公司级审核报告`,
            `- **调用模型**: \`${result.model}\``,
            `- **L4 部门内四步内审**: ${result.usedInternalMeeting ? "✅ 已执行 (大模型规划 ➔ Flash执行 ➔ 内部督察 ➔ 大模型内审)" : "单模型直跑"}`,
            `- **修改文件**: ${(result.modifiedFiles || []).join(", ") || "无文件变更"}`,
            `- **Codex 公司级审核结论**: ${result.audit?.passed ? "✅ 通过" : "⚠️ 需返工"} (${result.audit?.reviewerModel || "gpt-6.1-terra"})`,
            ``,
            `## 部门施工产出`,
            result.output || "",
          ].join("\n");
          this.recordQuotaEntries(quotaLedger, department, result.model);
        } else if (action === "roundtable") {
          runRecord.stage = `L4 ${department.toUpperCase()} 内部多模型 Subagent 正在召开四步同构内审圆桌会...`;
          result = await runInternalRoundtable({
            department,
            taskPrompt: goal,
            workspaceRoot,
            allowedFiles,
            allowFileEdits: Boolean(payload.allowFileEdits),
            mockRunner: payload.mockRunner || null,
          });
          const div = result.internalMeeting?.divisionOfLabor || {};
          const participants = [
            div.plannerModel,
            ...(div.executorModels || []),
            div.inspectorModel,
            div.reviewerModel,
          ].filter(Boolean);
          reportMarkdown = [
            `# 🔄 ${department.toUpperCase()} 内部 L4 四步同构多 Subagent 圆桌纪要`,
            `- **参会模型席位**: ${participants.join(" ➔ ")}`,
            `- **内部规划官 (大模型)**: \`${div.plannerModel || ""}\``,
            `- **内部施工官 (Flash)**: \`${(div.executorModels || []).join(", ")}\``,
            `- **内部督察官**: \`${div.inspectorModel || ""}\``,
            `- **内部终审官 (大模型)**: \`${div.reviewerModel || ""}\``,
            ``,
            result.output || "",
          ].join("\n");
          this.recordQuotaEntries(
            participants.map((m) => ({
              department,
              model: m,
              estimatedTokens: 900,
            })),
            department,
            div.reviewerModel
          );
        } else if (action === "sanitize") {
          runRecord.stage =
            "L3 豆包传话与防勾连隔离处 (工作模式 · 豆包 2.1 Pro [doubao-2.1-pro] · 思考模式：高) 正在执行跨部门传话脱敏与防勾连隔离 (仅传话不审核)...";
          result = sanitizeInterAgentMessage(goal, {
            fromDept: payload.fromDepartment || "qoder",
            toDept: payload.toDepartment || "codex",
            taskId: runRecord.runId,
          });
          reportMarkdown = [
            `# 📡 豆包 (工作模式 · 豆包 2.1 Pro · 思考模式：高) 跨部门传话与防勾连隔离回执`,
            `- **角色职责**: 专职跨部门传话与隔离开下面的 Agent 防勾连（不参与代码审核）`,
            `- **风险等级**: \`${result.riskLevel}\` (风险分: ${result.collusionRiskScore}/100)`,
            `- **拦截串联/暗号告警**: ${
              (result.alerts || []).length > 0
                ? result.alerts.map((a) => `${a.label} (${a.severity})`).join("; ")
                : "未发现违规暗号"
            }`,
            ``,
            `## 洗稿后安全传话正文`,
            result.cleanMessage || result.sanitizedBody || "",
          ].join("\n");
          this.recordQuotaEntries([], "doubao", "doubao-2.1-pro");
        } else if (action === "intervene") {
          runRecord.stage = "L2 总包工头 (DSH) 正在亲自下场接管工作区...";
          const dshActionsLog = [];
          result = dshDirectIntervene({
            workspaceRoot,
            reason: payload.reason || goal,
            fileWrites: Array.isArray(payload.fileWrites) ? payload.fileWrites : [],
            dshActionsLog,
            quotaLedger,
          });
          reportMarkdown = [
            `# ⚡ L2 总包工头 (DSH) 亲自下场兜底记录`,
            `- **干预记录**: ${result.record}`,
            `- **直接写入文件**: ${(result.writtenFiles || []).join(", ") || "全局统筹调优"}`,
          ].join("\n");
        } else {
          throw new Error(`Unsupported company action: "${action}"`);
        }

        runRecord.status = "succeeded";
        runRecord.stage = "✅ 执行完成，已生成结项呈报与多层审核密折";
        runRecord.endedAt = Date.now();
        runRecord.durationMs = runRecord.endedAt - runRecord.startedAt;
        runRecord.result = result;
        runRecord.reportMarkdown = reportMarkdown;
        runRecord.communications = this.buildCommunications(action, payload, result, goal, department, allowedFiles);
        runRecord.logs.push(
          `[${new Date().toLocaleTimeString()}] 任务圆满完成 (耗时 ${(
            runRecord.durationMs / 1000
          ).toFixed(1)}s)`
        );
      } catch (err) {
        runRecord.status = "failed";
        runRecord.stage = `❌ 执行出错: ${err.message || String(err)}`;
        runRecord.endedAt = Date.now();
        runRecord.durationMs = runRecord.endedAt - runRecord.startedAt;
        runRecord.error = err.message || String(err);
        runRecord.logs.push(
          `[${new Date().toLocaleTimeString()}] 错误: ${runRecord.error}`
        );
      } finally {
        this.recentRuns.unshift({ ...runRecord });
        if (this.recentRuns.length > 25) {
          this.recentRuns.length = 25;
        }
        if (this.activeRun && this.activeRun.runId === runRecord.runId) {
          this.activeRun = null;
        }
        this.persist();
      }
      return runRecord;
    })();

    if (runAsync) {
      return {
        ok: true,
        async: true,
        runId: runRecord.runId,
        activeRun: runRecord,
      };
    }

    const completed = await executePromise;
    return {
      ok: completed.status === "succeeded",
      async: false,
      runId: completed.runId,
      run: completed,
    };
  }

  describeInitialStage(action, department, enableInternalMeetings) {
    switch (action) {
      case "pipeline":
        return `正在启动四级集团流水线 (Codex 规划 ➔ 豆包专职传话防勾连隔离 ➔ Qoder/WorkBuddy ${
          enableInternalMeetings ? "含L4四步内审" : ""
        } ➔ Codex [6.1-terra/6.1-sol/6-astra] 公司级审核 ➔ DSH 对话框模型最终审核)...`;
      case "plan":
        return "Codex (gpt-6.1-terra / gpt-6.1-sol / gpt-6-astra) 正在规划拆解任务...";
      case "dispatch":
        return `正在向 ${department.toUpperCase()} 派发施工工单...`;
      case "roundtable":
        return `正在拉起 ${department.toUpperCase()} 内部 L4 四步同构 Subagent 圆桌会议...`;
      case "sanitize":
        return "豆包 (专职传话隔离处 · 豆包 2.1 Pro · 思考高 · 仅传话防勾连不审核) 正在执行传话脱敏...";
      case "intervene":
        return "总包工头 (DSH) 正在亲自下场干预...";
      default:
        return "正在执行集团指令...";
    }
  }

  buildCommunications(action, payload = {}, result = {}, goal = "", department = "qoder", allowedFiles = ["*"]) {
    const comms = [];
    const targetLabel =
      action === "pipeline"
        ? "🏢 四大部门 (Codex / Qoder / WorkBuddy / 豆包)"
        : action === "plan"
        ? "🟣 L3 Codex (规划与公司级审核院)"
        : action === "sanitize"
        ? "🟠 L3 豆包传话隔离处 (仅传话防勾连 · 不审核)"
        : action === "intervene"
        ? "⚡ L2 DSH 总包工头直属工作区"
        : `🛠️ L3 ${String(department || "qoder").toUpperCase()}`;

    comms.push({
      step: 1,
      from: "⚡ L2 总包工头 (DSH)",
      to: targetLabel,
      stage: "DSH 派活指令",
      model: "DSH 主模型",
      badge: `动作: ${action}`,
      content: [
        `【派活目标】：${goal}`,
        allowedFiles && allowedFiles.length > 0
          ? `【文件权限围挡 (allowedFiles)】：${Array.isArray(allowedFiles) ? allowedFiles.join(", ") : allowedFiles}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });

    if (action === "pipeline" && result) {
      if (result.plan) {
        const subtaskSummary = (result.plan.subtasks || [])
          .map(
            (st, idx) =>
              `  ${idx + 1}. [${String(st.department || "qoder").toUpperCase()}] ${st.title || "子任务"} (允许修改: ${(st.allowedFiles || ["*"]).join(", ")})\n     指令: ${st.instructions || st.prompt || goal}`
          )
          .join("\n");
        comms.push({
          step: comms.length + 1,
          from: "🟣 L3 Codex (规划与质检院)",
          to: "⚡ L2 总包工头 (DSH)",
          stage: "顶层架构拆解与文件责任田划分",
          model: result.plan.model || "gpt-6.1-sol",
          badge: `拆解 ${(result.plan.subtasks || []).length} 个子工单`,
          content: [result.plan.planSummary || "", subtaskSummary ? `\n【拆解工单明细】：\n${subtaskSummary}` : ""]
            .filter(Boolean)
            .join("\n"),
        });
      }

      for (const exec of result.executions || []) {
        const deptName = String(exec.department || "qoder").toUpperCase();
        if (exec.relaySanitization) {
          comms.push({
            step: comms.length + 1,
            from: "🟠 L3 豆包传话隔离处 (仅传话防勾连 · 不参与审核)",
            to: `🛠️ L3 ${deptName}`,
            stage: `跨部门传话脱敏与物理隔离 (${exec.subtaskTitle || "施工任务"})`,
            model: "doubao-2.1-pro",
            badge: `防勾连状态: ${exec.relaySanitization.riskLevel || "CLEAN"}`,
            content:
              exec.relaySanitization.cleanMessage ||
              exec.relaySanitization.sanitizedBody ||
              "已完成跨部门身份剥离与防勾连隔离。",
          });
        }

        const l4Transcript =
          exec.internalMeeting?.transcript ||
          exec.internalMeeting?.round1Minutes ||
          [];
        if (Array.isArray(l4Transcript) && l4Transcript.length > 0) {
          for (const entry of l4Transcript) {
            comms.push({
              step: comms.length + 1,
              from: `🔄 L4 ${deptName} · ${entry.role || entry.stage || "内部席位"}`,
              to: `🔄 L4 ${deptName} 内部下一环`,
              stage: `部门内四步同构沟通 (${entry.role || entry.stage || "Subagent"})`,
              model: entry.model || exec.model,
              badge: entry.phase || "L4 内审",
              content: entry.opinion || entry.output || entry.summary || "",
            });
          }
        }

        comms.push({
          step: comms.length + 1,
          from: `🛠️ L3 ${deptName}`,
          to: "🟠 L3 豆包传话隔离处 ➔ 🟣 L3 Codex 审核院",
          stage: `部门施工交付（经豆包脱敏隔离后移交 Codex 公司级审核）：${exec.subtaskTitle || "子任务"}`,
          model: exec.model || "auto",
          badge: `合规修改 ${(exec.diffReport?.authorizedChanges || []).length} 个文件`,
          content: exec.output || exec.summary || "施工已完成。",
        });

        if (exec.audit) {
          const revModel = exec.audit.reviewerModel || "gpt-6.1-terra";
          comms.push({
            step: comms.length + 1,
            from: `🟣 L3 Codex 公司级审核院 (${revModel} / gpt-6.1-sol / gpt-6-astra)`,
            to: "⚡ L2 总包工头 (DSH)",
            stage: `Codex 公司级交付物与 Diff 初审 (${deptName})`,
            model: revModel,
            badge: exec.audit.passed
              ? `✅ 公司级初审通过 (${exec.audit.integrityScore ?? 100}分)`
              : `⚠️ 打回重做 (${exec.audit.integrityScore ?? 60}分)`,
            content:
              exec.audit.secretMemorial ||
              exec.audit.summary ||
              (exec.audit.findings || []).map((f) => `[${f.severity}] ${f.message || f.detail}`).join("\n") ||
              "未发现越界修改或 TODO 糊弄。",
          });
        }
      }

      if (Array.isArray(result.reworkHistory) && result.reworkHistory.length > 0) {
        comms.push({
          step: comms.length + 1,
          from: "🟣 L3 Codex 公司级审核院 (6.1-terra / 6.1-sol / 6-astra)",
          to: "🟠 豆包传话隔离 ➔ 🛠️ L3 施工部门",
          stage: "公司级审核不通过强制打回返工与复审闭环",
          model: "gpt-6.1-terra / gpt-6.1-sol / gpt-6-astra",
          badge: `🔄 ${result.reworkHistory.length} 条返工闭环`,
          content: result.reworkHistory.join("\n"),
        });
      }

      if (result.codexReview) {
        const revModels =
          Array.isArray(result.codexReview.participatingModels) &&
          result.codexReview.participatingModels.length > 0
            ? result.codexReview.participatingModels.join(" / ")
            : result.codexReview.model || "gpt-6.1-terra / gpt-6.1-sol";
        comms.push({
          step: comms.length + 1,
          from: "🟣 L3 Codex (公司级审核院: 6.1-terra / 6.1-sol / 6-astra)",
          to: "⚡ L2 DSH 对话框主模型 (最终审核官)",
          stage: "Codex 公司层面代码与架构联合审核",
          model: revModels,
          badge: result.codexReview.approved
            ? `✅ 公司级审核通过 (${result.codexReview.score || 95}分)`
            : `⚠️ 需整改 (${result.codexReview.score || 60}分)`,
          content: result.codexReview.summary || result.codexReview.rawOutput || "",
        });
        comms.push({
          step: comms.length + 1,
          from: "⚡ L2 DSH 对话框主模型 (最终审核官)",
          to: "👑 L1 董事长",
          stage: "DSH 对话框模型最终审核 (Final Review) 与签发汇报",
          model: "DSH 对话框当前模型",
          badge: "✅ 最终审核移交",
          content:
            "Codex (6.1-terra / 6.1-sol / 6-astra) 已完成公司层面审核；现移交 DSH 对话框里的模型做最终审核并向董事长汇报。",
        });
      }
    } else if (action === "plan" && result) {
      comms.push({
        step: comms.length + 1,
        from: "🟣 L3 Codex (规划与质检院)",
        to: "⚡ L2 总包工头 (DSH)",
        stage: "顶层架构规划回复",
        model: result.model || "gpt-6.1-sol",
        badge: `拆解 ${(result.subtasks || []).length} 项`,
        content:
          (result.planSummary || "") +
          "\n\n" +
          JSON.stringify(result.subtasks || [], null, 2),
      });
    } else if (action === "dispatch" && result) {
      const deptName = String(department || "qoder").toUpperCase();
      if (result.relaySanitization) {
        comms.push({
          step: comms.length + 1,
          from: "🟠 L3 豆包传话隔离处 (仅传话防勾连 · 不参与审核)",
          to: `🛠️ L3 ${deptName}`,
          stage: "跨部门传话脱敏与防勾连隔离",
          model: "doubao-2.1-pro",
          badge: `防勾连状态: ${result.relaySanitization.riskLevel || "CLEAN"}`,
          content: result.relaySanitization.cleanMessage || result.relaySanitization.sanitizedBody || "",
        });
      }
      const dispatchL4 =
        result.internalMeeting?.transcript ||
        result.internalMeeting?.round1Minutes ||
        [];
      if (Array.isArray(dispatchL4) && dispatchL4.length > 0) {
        for (const entry of dispatchL4) {
          comms.push({
            step: comms.length + 1,
            from: `🔄 L4 ${deptName} · ${entry.role || "内部席位"}`,
            to: `🔄 L4 ${deptName} 内部下一环`,
            stage: `部门内四步同构沟通 (${entry.role || "Subagent"})`,
            model: entry.model || result.model,
            badge: entry.phase || "L4 内审",
            content: entry.opinion || entry.output || "",
          });
        }
      }
      comms.push({
        step: comms.length + 1,
        from: `🛠️ L3 ${deptName}`,
        to: "🟠 L3 豆包传话隔离处 ➔ 🟣 L3 Codex 公司级审核院",
        stage: "部门施工产出汇报",
        model: result.model || "auto",
        badge: result.audit?.passed ? "✅ Codex 公司级初审通过" : "已交付",
        content: result.output || "",
      });
    } else if (action === "roundtable" && result) {
      const deptName = String(department || "qoder").toUpperCase();
      const rtL4 =
        result.internalMeeting?.transcript ||
        result.internalMeeting?.round1Minutes ||
        [];
      if (Array.isArray(rtL4) && rtL4.length > 0) {
        for (const entry of rtL4) {
          comms.push({
            step: comms.length + 1,
            from: `🔄 L4 ${deptName} · ${entry.role || "内部席位"}`,
            to: `🔄 L4 ${deptName} 内部下一环`,
            stage: `部门内四步同构沟通 (${entry.role || "Subagent"})`,
            model: entry.model || "auto",
            badge: entry.phase || "L4 内审",
            content: entry.opinion || entry.output || "",
          });
        }
      } else {
        comms.push({
          step: comms.length + 1,
          from: `🔄 L4 ${deptName} 圆桌会议`,
          to: "⚡ L2 总包工头 (DSH)",
          stage: "部门内四步同构多 Subagent 决议",
          model: result.internalMeeting?.divisionOfLabor?.reviewerModel || "auto",
          badge: "✅ 圆桌决议",
          content: result.output || "",
        });
      }
    } else if (action === "sanitize" && result) {
      comms.push({
        step: comms.length + 1,
        from: "🟠 L3 豆包传话隔离处 (仅传话防勾连 · 不参与审核)",
        to: "⚡ L2 总包工头 (DSH)",
        stage: "跨部门传话脱敏与防勾连隔离回执",
        model: "doubao-2.1-pro",
        badge: `防勾连状态: ${result.riskLevel || "CLEAN"} (${result.collusionRiskScore ?? 0}分)`,
        content: result.cleanMessage || result.sanitizedBody || "",
      });
    } else if (action === "intervene" && result) {
      comms.push({
        step: comms.length + 1,
        from: "⚡ L2 总包工头 (DSH)",
        to: "👑 L1 董事长",
        stage: "总包工头亲自下场兜底写入",
        model: "DSH 主模型",
        badge: `修改 ${(result.writtenFiles || []).length} 个文件`,
        content: result.record || "",
      });
    }

    return comms;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let sharedCompanyHostService = null;

export function getSharedCompanyHostService(ctx) {
  if (sharedCompanyHostService) {
    return sharedCompanyHostService;
  }
  sharedCompanyHostService = new CompanyHostService(ctx, {});
  return sharedCompanyHostService;
}

export const COMPANY_FOREMAN_SYSTEM_PROMPT = [
  "【🏢 公司模式 (Four-Tier Multi-Agent Company Mode) — L2 集团总包工头与最终审核官铁律】",
  "当前处于「公司模式」。你是 L2 集团总包工头兼最终审核官 (DSH 对话框主模型)，用户是 L1 董事长。",
  "董事长在对话框中**只会直接提业务需求或目标**，绝不会也不需要点名具体部门、模型或审核流程。**谁来规划、谁来传话隔离、谁来施工、谁来做公司级审核、谁来做最终审核，全部严格按以下集团制度自动执行！**",
  "",
  "### 一、集团四级编制与三级审核制度（已内置，必须严格遵守）",
  "1. **L3 规划与公司级审核院 — Codex (独立计费)**：使用 **`gpt-6.1-terra`、`gpt-6.1-sol`、`gpt-6-astra`**（严禁使用任何 `luna` 模型）。负责顶层架构规划、划分互不重叠的 `allowedFiles` 文件白名单，以及**公司层面的代码与 Diff 审核**（审核不通过强制打回施工队重做）。",
  "2. **L3 工程一部 — Qoder (独立计费)** 与 **L3 工程二部 — WorkBuddy (独立计费)**：两部门独立计费、额度绝不混用。内部规划与内审环节用大模型 (`kimi-3.1-pro`, `glm-5.3`, `qwen3.8-max` 等)，编码施工执行用 Flash 模型 (`deepseek-v4.1-flash`, `glm-5.3-flash`, `qwen3.8-flash` 等)。",
  "3. **L3 跨部门传话与防勾连隔离处 — 豆包 Doubao (独立计费)**：固定采用 **工作模式 (`agent-mode:1`) + 豆包 2.1 Pro (`doubao-2.1-pro`) + 思考模式：高 (`thinkingMode: \"high\"`)**。**注意：豆包的角色只是传话筒，唯一任务是隔离开下面的 Agent (Codex / Qoder / WorkBuddy) 不让他们勾连串联，严禁让豆包做代码审核！**",
  "4. **L2 最终审核官 — DSH 对话框里的模型（你本人）**：当施工部门完成 L4 内部四步内审、且 Codex (`gpt-6.1-terra` / `gpt-6.1-sol` / `gpt-6-astra`) 完成公司层面审核后，**由你（DSH 对话框里的模型）执行最终的审核 (Final Review)**、运行必要的验证命令并向董事长汇报！",
  "",
  "### 二、总包工头自动化调度与最终审核铁律（最高优先级）",
  "- 当董事长提出任何开发、写代码、建项目、改功能、重构或审稿任务时，**严禁你自己跳过下属直接单打独斗把活全干完**！",
  "- 系统或你调用的 **`run_company_pipeline`** 会驱动「Codex (6.1-sol/6.1-terra) 规划 ➔ 豆包专职传话防勾连隔离 ➔ Qoder & WorkBuddy 分片施工与 L4 四步内审 ➔ Codex (6.1-terra / 6.1-sol / 6-astra) 公司层面代码与 Diff 审核（不通过强制打回重做）」。",
  "- 收到流水线回执后，请你作为 **DSH 对话框最终审核官** 对代码和运行结果做**最终的审核 (Final Review)**；若发现仍有任何问题，立即打回或亲自兜底修补，绝不把未通过审核的半成品呈报董事长！",
  "- 向董事长汇报时，必须在回复末尾完整附上【💰 四大部门独立计费与本次工单用量汇总表】与【📊 本次工单全链路模型调用与耗时明细表】两张 Markdown 表格，严禁省略用量统计表！",
].join("\n");

export const COMPANY_ACTIVE_MODE_PROMPT = COMPANY_FOREMAN_SYSTEM_PROMPT;

const COMPANY_STANDBY_MODE_PROMPT = [
  "【四级智能体集团待命提示】",
  "若用户切换到「公司模式」(preset: company) 或要求调动集团四部门 (Codex / Qoder / WorkBuddy / 豆包)，可调用 `run_company_pipeline`、`codex_plan_or_review`、`dispatch_worker`、`hold_internal_meeting`、`doubao_inspect_and_sanitize`、`company_status` 工具协同执行。",
].join("\n");

export function buildCompanyPresetPlugins() {
  const presetToolsUrl = `${pathToFileURL(path.resolve(__dirname, "./preset-tools.js")).href}?v=${Date.now()}`;
  return [
    {
      id: "persona",
      name: "@deepseek-ai/dsh-persona",
      config: {
        prefix:
          "You are DeepSeek Harness running in 「公司模式」 (Four-Tier Multi-Agent Company Mode), powered by the {{model}} model. You act as the L2 General Contractor & Final Reviewer (总包工头兼最终审核官 DSH) serving the user (L1 Chairman / 董事长). The user chats with you normally, and you handle all orchestration of your 4 independently billed L3 departments: Codex (gpt-6.1-terra, gpt-6.1-sol, gpt-6-astra for top-level planning & Company-Level Code Review; strictly no luna), Qoder (plan/review: kimi-3.1-pro, glm-5.3, qwen3.8-max; exec: deepseek-v4.1-flash, glm-5.3-flash, qwen3.8-flash), WorkBuddy (independent billing, same model tiers), and Doubao (Work Mode · Doubao 2.1 Pro [doubao-2.1-pro] · High Thinking — strictly inter-agent relay & anti-collusion isolation ONLY, never code review). After Codex passes Company-Level Review, you (the DSH dialog model) perform the Final Review.",
      },
    },
    {
      id: "company-preset-tools",
      name: presetToolsUrl,
    },
    {
      id: "agent-instructions",
      name: "@deepseek-ai/dsh-agent-instructions",
      config: {
        maxBytes: 65536,
      },
    },
    {
      id: "time-context",
      name: "@deepseek-ai/dsh-time-context",
    },
    {
      id: "tool-bash",
      name: "@deepseek-ai/dsh-tool-bash",
      disabled: { __jsExpr: "process.platform === 'win32'" },
    },
    {
      id: "tool-pwsh",
      name: "@deepseek-ai/dsh-tool-pwsh",
      disabled: { __jsExpr: "process.platform !== 'win32'" },
    },
    {
      id: "tool-fs",
      name: "@deepseek-ai/dsh-tool-fs",
    },
    {
      id: "tool-fs-search",
      name: "@deepseek-ai/dsh-tool-fs-search",
      config: {
        sampleOverCapGlobResults: false,
      },
    },
    {
      id: "tool-jobs",
      name: "@deepseek-ai/dsh-tool-jobs",
    },
    {
      id: "tool-schedule",
      name: "@deepseek-ai/dsh-tool-schedule",
    },
    {
      id: "skill-filesystem",
      name: "@deepseek-ai/dsh-skill-filesystem",
    },
    {
      id: "tool-skill",
      name: "@deepseek-ai/dsh-tool-skill",
    },
    {
      id: "command-goal",
      name: "@deepseek-ai/dsh-command-goal",
    },
    {
      id: "tool-goal",
      name: "@deepseek-ai/dsh-tool-goal",
    },
    {
      id: "planning",
      name: "cordis:group",
      group: true,
      isolate: {
        planMode: true,
      },
      config: [
        {
          id: "plan-mode",
          name: "@deepseek-ai/dsh-plan-mode",
          config: {
            section:
              "You are in plan mode. Stay in plan mode until the user approves your plan through exit_plan_mode or switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user's conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.",
          },
        },
      ],
    },
    {
      id: "compaction",
      name: "cordis:group",
      group: true,
      isolate: {
        compaction: true,
        toolResultPruner: true,
      },
      config: [
        {
          id: "compaction-basic",
          name: "@deepseek-ai/dsh-compaction-basic",
        },
        {
          id: "command-compact",
          name: "@deepseek-ai/dsh-command-compact",
        },
        {
          id: "tool-result-pruner",
          name: "@deepseek-ai/dsh-compaction-tool-result-pruner",
          config: {
            thresholdChars: 8192,
            headChars: 4096,
            tailChars: 1024,
          },
        },
      ],
    },
    {
      id: "delegation",
      name: "cordis:group",
      group: true,
      isolate: {
        workflowEngine: true,
      },
      config: [
        {
          id: "tool-subagent-control",
          name: "@deepseek-ai/dsh-tool-subagent-control",
        },
        {
          id: "tool-subagent-list-agents",
          name: "@deepseek-ai/dsh-tool-subagent-control/list-agents",
        },
        {
          id: "tool-subagent",
          name: "@deepseek-ai/dsh-tool-subagent",
          config: {
            provider: "spawn",
            toolName: "subagent",
            modelSelectionSettings: true,
          },
        },
        {
          id: "tool-subagent-fork",
          name: "@deepseek-ai/dsh-tool-subagent",
          config: {
            provider: "fork",
            toolName: "subagent_fork",
          },
        },
        {
          id: "workflow-ptc",
          name: "@deepseek-ai/dsh-workflow-ptc",
          config: {
            provider: "spawn",
          },
        },
        {
          id: "tool-workflow",
          name: "@deepseek-ai/dsh-tool-workflow",
        },
      ],
    },
    {
      id: "tool-ask-user",
      name: "@deepseek-ai/dsh-tool-ask-user",
    },
    {
      id: "tool-todo",
      name: "@deepseek-ai/dsh-tool-todo",
      config: {
        allowParallelInProgress: true,
      },
    },
    {
      id: "tool-web",
      name: "@deepseek-ai/dsh-tool-web",
      config: {
        fetch: true,
        searchTimeoutMs: 60000,
      },
    },
    {
      id: "present",
      name: "@deepseek-ai/dsh-tool-present",
    },
  ];
}

function describeToolCallTitle(toolName, args = {}) {
  switch (toolName) {
    case "run_company_pipeline":
      return `🏢 四级集团全链路流水线派单：${String(args?.goal || "").slice(0, 50) || "协同施工"}`;
    case "codex_plan_or_review":
      return `🟣 Codex (${args?.mode === "review" ? "公司级代码审核" : "顶层架构规划"} · gpt-6.1-terra / 6.1-sol / 6-astra)`;
    case "dispatch_worker":
      return `🛠️ 派发部门工单 -> ${String(args?.department || "qoder").toUpperCase()} (${args?.subtaskTitle || "施工任务"})`;
    case "hold_internal_meeting":
      return `🔄 启动部门内部 L4 四步多模型圆桌内审 -> ${String(args?.department || "qoder").toUpperCase()}`;
    case "doubao_inspect_and_sanitize":
      return `🟠 豆包传话隔离处 (工作模式 · 2.1 Pro · 仅传话防勾连不审核) -> ${args?.action || "传话隔离"}`;
    case "dsh_direct_intervene":
      return `⚡ DSH 总包工头亲自下场兜底：${String(args?.reason || "").slice(0, 40)}`;
    case "company_status":
      return "📊 查询四部门独立实时余额与集团编制";
    default:
      return `🏢 集团调度：${toolName}`;
  }
}

export function registerCompanyAgentTools(ctx, hostService) {
  let toolsRegistry;
  try {
    toolsRegistry = typeof ctx?.get === "function" ? ctx.get("tools", false) : ctx?.tools;
  } catch {
    toolsRegistry = undefined;
  }
  if (!toolsRegistry || typeof toolsRegistry.register !== "function") {
    return () => {};
  }

  const disposers = [];
  for (const toolDef of MCP_TOOLS) {
    try {
      const parameters = structuredClone(
        toolDef.inputSchema || { type: "object", properties: {} }
      );
      const dispose = toolsRegistry.register({
        name: toolDef.name,
        description: toolDef.description,
        parameters,
        output: {
          // Empty object `{}` is DSH's official unconstrained JSON Schema in `assertSupportedJsonSchema`
          schema: {},
          render: (_args, value) => [
            {
              type: "text",
              text:
                typeof value === "string"
                  ? value
                  : value?.report
                  ? String(value.report)
                  : JSON.stringify(value, null, 2),
            },
          ],
        },
        presentCall: (args) => ({
          card: "generic",
          title: describeToolCallTitle(toolDef.name, args),
          kind: "other",
          rawInput: args,
        }),
        presentResult: (_args, result) => ({
          card: "generic",
          title: `${describeToolCallTitle(toolDef.name, _args)} · 完成`,
          content: result.content,
        }),
        async execute(args = {}, exec) {
          const callingSession = exec?.agent?.session || null;
          if (callingSession && typeof hostService?.resolveSessionPresetId === "function") {
            const presetId = hostService.resolveSessionPresetId(callingSession);
            if (presetId && presetId !== "company") {
              return {
                ok: false,
                report:
                  `⛔ 权限拒绝：当前会话处于「${presetId}」模式，非「公司模式」(preset: company)。集团多智能体调度工具（Codex/Qoder/WorkBuddy/豆包）仅限在「公司模式」下使用。`,
              };
            }
          }

          if (toolDef.name === "company_status") {
            const ov = await hostService.overview({ forceBalances: true });
            const ag = ov.balances?.agents || {};
            const summaryLines = [
              `# 📊 四级智能体集团独立实时余额与编制状态`,
              `- **🟣 Codex (规划与质检院 · 默认 gpt-6.1-sol / 疑难 gpt-6-astra / 禁 luna)**: \`${ag.codex?.headlineBalance || "未知"}\``,
              `- **🔵 WorkBuddy (工程二部 · 独立计费)**: \`${ag.workbuddy?.headlineBalance || "未知"}\``,
              `- **🟢 Qoder (工程一部 · 独立计费)**: \`${ag.qoder?.headlineBalance || "未知"}\``,
              `- **🟠 豆包 (督察院 · 工作模式 · 2.1 Pro · 思考高)**: \`${ag.doubao?.headlineBalance || "未知"}\``,
            ].join("\n");
            return {
              ok: true,
              report: summaryLines,
              balances: ov.balances,
              company: ov.company,
            };
          }

          // If `agent/pre-step` in `company` preset already executed the full 4-tier pipeline for this turn,
          // return the completed run directly so we don't duplicate execution!
          if (
            toolDef.name === "run_company_pipeline" &&
            callingSession?.id &&
            hostService?.lastAutoPipelineBySession instanceof Map
          ) {
            const cached = hostService.lastAutoPipelineBySession.get(callingSession.id);
            if (cached && Date.now() - cached.ts < 180000 && cached.run) {
              hostService.lastAutoPipelineBySession.delete(callingSession.id);
              return {
                ok: cached.run.status === "succeeded",
                report:
                  cached.run.reportMarkdown ||
                  cached.run.error ||
                  JSON.stringify(cached.run.result, null, 2),
                runId: cached.run.runId,
                communications: cached.run.communications || [],
              };
            }
          }

          // Resolve default workspace from the calling chat session if not explicitly passed
          const sessionCwd =
            exec?.agent?.session?.header?.cwd ||
            exec?.agent?.session?.cwd ||
            hostService.defaultWorkspace();
          const mergedArgs = {
            ...args,
            workspaceRoot: args.workspaceRoot || sessionCwd,
          };

          const actionMap = {
            run_company_pipeline: "pipeline",
            dispatch_worker: "dispatch",
            hold_internal_meeting: "roundtable",
            dsh_direct_intervene: "intervene",
          };
          let mappedAction = actionMap[toolDef.name] || null;
          if (toolDef.name === "codex_plan_or_review" && mergedArgs.mode !== "review") {
            mappedAction = "plan";
          } else if (
            toolDef.name === "doubao_inspect_and_sanitize" &&
            (!mergedArgs.action || mergedArgs.action === "sanitize")
          ) {
            mappedAction = "sanitize";
          }

          if (mappedAction && typeof hostService?.executeAction === "function") {
            const actionRes = await hostService.executeAction({
              ...mergedArgs,
              action: mappedAction,
              goal:
                mergedArgs.goal ||
                mergedArgs.prompt ||
                mergedArgs.taskPrompt ||
                mergedArgs.message ||
                mergedArgs.reason ||
                "DSH 对话框派发工单",
              enableInternalMeetings:
                mergedArgs.enableInternalMeetings ??
                mergedArgs.useInternalMeeting ??
                true,
              fromDepartment: mergedArgs.fromDept || mergedArgs.fromDepartment,
              toDepartment: mergedArgs.toDept || mergedArgs.toDepartment,
              async: false,
            });
            const completedRun = actionRes?.run;
            return {
              ok: Boolean(actionRes?.ok),
              report:
                completedRun?.reportMarkdown ||
                completedRun?.error ||
                JSON.stringify(completedRun?.result || actionRes, null, 2),
              runId: completedRun?.runId,
              communications: completedRun?.communications || [],
            };
          }

          const res = await executeMcpToolCall(toolDef.name, mergedArgs);
          if (toolDef.name === "codex_plan_or_review") {
            hostService.recordQuotaEntries([], "codex", "gpt-6.1-sol");
          } else if (toolDef.name === "doubao_inspect_and_sanitize") {
            hostService.recordQuotaEntries([], "doubao", "doubao-2.1-pro");
          }
          const text =
            res?.content?.[0]?.text ||
            res?.report ||
            res?.summary ||
            JSON.stringify(res, null, 2);
          return { ok: !res?.isError, report: text };
        },
      });
      if (typeof dispose === "function") disposers.push(dispose);
    } catch (err) {
      ctx?.logger?.warn?.(`dsh-company-multiagent: failed to register tool ${toolDef.name}: ${err.message}`);
    }
  }

  return () => {
    for (const d of disposers) {
      try {
        d();
      } catch {
        // ignore
      }
    }
  };
}

function registerCompanySlashCommand(ctx, hostService) {
  let commandsSvc;
  try {
    commandsSvc = typeof ctx?.get === "function" ? ctx.get("commands", false) : ctx?.commands;
  } catch {
    commandsSvc = undefined;
  }
  if (!commandsSvc || typeof commandsSvc.register !== "function") {
    return () => {};
  }

  try {
    const dispose = commandsSvc.register({
      definitionId: "dsh-company-multiagent:company",
      name: "company",
      description: "开启/关闭「🏢 集团公司模式」，或立即让 DSH 找下面四部门 (Codex/Qoder/WorkBuddy/豆包) 干活",
      input: {
        hint: "[on|off|任务说明]",
        attachments: true,
      },
      handler: ({ agent, rawInput = "", attachments = [] }) => {
        const sessionId = agent?.session?.id || null;
        const trimmed = String(rawInput || "").trim();
        const lower = trimmed.toLowerCase();

        if (lower === "off" || lower === "0" || lower === "关闭") {
          hostService.setSessionMode({ sessionId, enabled: false });
          return {
            kind: "success",
            text: "⚪ 已关闭当前对话的「🏢 集团公司模式」，恢复日常对话讨论模式。",
          };
        }

        // Turn ON Company Mode for this session
        hostService.setSessionMode({ sessionId, enabled: true });

        const promptText =
          trimmed && lower !== "on" && lower !== "1" && lower !== "开启"
            ? `【🏢 集团公司模式派单】请立即作为 L2 总包工头调用集团调度工具（优先 run_company_pipeline）带领 Codex、Qoder、WorkBuddy、豆包四部门完成以下任务，并在当前对话框汇报：\n\n${trimmed}`
            : FOREMAN_TRIGGER_PROMPT;

        if (agent && typeof agent.steer === "function") {
          const msg = buildFrozenUserMessage(promptText, attachments);
          agent.steer(msg);
        }

        return {
          kind: "success",
          text: "🟢 已开启「🏢 集团公司模式」！DSH 总包工头正在召集 Codex、Qoder、WorkBuddy、豆包四部门协同执行…",
        };
      },
    });
    return typeof dispose === "function" ? dispose : () => {};
  } catch {
    return () => {};
  }
}

async function registerCompanyAgentPreset(ctx) {
  let agentPresets;
  try {
    agentPresets =
      typeof ctx?.get === "function" ? ctx.get("agentPresets", false) : ctx?.agentPresets;
  } catch {
    agentPresets = undefined;
  }
  if (!agentPresets || typeof agentPresets.register !== "function") {
    return { registered: false, dispose: () => {} };
  }
  if (agentPresets.definitions instanceof Map && agentPresets.definitions.has("company")) {
    try {
      agentPresets.definitions.delete("company");
    } catch {
      // ignore
    }
  }

  const presetToolsUrl = `${pathToFileURL(path.resolve(__dirname, "./preset-tools.js")).href}?v=${Date.now()}`;
  const standardRecord =
    agentPresets.definitions instanceof Map
      ? agentPresets.definitions.get("standard")
      : undefined;

  let companyPlugins;
  if (standardRecord && Array.isArray(standardRecord.config?.plugins)) {
    companyPlugins = structuredClone(standardRecord.config.plugins).map((row) => {
      if (row && row.id === "persona" && row.config) {
        return {
          ...row,
          config: {
            ...row.config,
            prefix:
              "You are DeepSeek Harness running in 「公司模式」 (Four-Tier Multi-Agent Company Mode), powered by the {{model}} model. You act as the L2 General Contractor (总包工头 DSH) serving the user (L1 Chairman / 董事长). The user chats with you normally, and you handle all orchestration of your 4 independently billed L3 departments: Codex (gpt-6.1-sol / gpt-6-astra, strictly no luna), Qoder (plan/review: kimi-3.1-pro, glm-5.3, qwen3.8-max; exec: deepseek-v4.1-flash, glm-5.3-flash, qwen3.8-flash), WorkBuddy (independent billing, same model tiers), and Doubao (Work Mode · Doubao 2.1 Pro [doubao-2.1-pro] · High Thinking).",
          },
        };
      }
      return row;
    });
    if (!companyPlugins.some((r) => r && r.id === "company-preset-tools")) {
      const personaIdx = companyPlugins.findIndex((r) => r && r.id === "persona");
      const toolRow = {
        id: "company-preset-tools",
        name: presetToolsUrl,
      };
      if (personaIdx >= 0) {
        companyPlugins.splice(personaIdx + 1, 0, toolRow);
      } else {
        companyPlugins.unshift(toolRow);
      }
    }
  } else {
    companyPlugins = buildCompanyPresetPlugins();
  }

  const definition = {
    id: "company",
    name: "公司模式",
    description:
      "DSH 担任集团总包工头，统领 Codex、Qoder、WorkBuddy、豆包四部门协同干活与四层内审",
    order: 2,
    plugins: companyPlugins,
  };

  try {
    let unregister;
    try {
      unregister = await agentPresets.register(definition);
    } catch (primaryErr) {
      if (
        standardRecord?.context?.agentPresets &&
        standardRecord.context.agentPresets !== agentPresets
      ) {
        if (agentPresets.definitions instanceof Map) {
          agentPresets.definitions.delete("company");
        }
        unregister = await standardRecord.context.agentPresets.register(definition);
      } else {
        throw primaryErr;
      }
    }
    if (sharedCompanyHostService) {
      sharedCompanyHostService.presetStatus = {
        registered: true,
        id: "company",
        name: "公司模式",
        updatedAt: Date.now(),
      };
    }
    return {
      registered: true,
      dispose: typeof unregister === "function" ? unregister : () => {},
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (sharedCompanyHostService) {
      sharedCompanyHostService.presetStatus = {
        registered: false,
        error: errMsg,
        updatedAt: Date.now(),
      };
    }
    ctx?.logger?.warn?.(
      `dsh-company-multiagent: failed to register preset "company": ${errMsg}`
    );
    return { registered: false, dispose: () => {} };
  }
}

export const apply = mountOnce("dsh-company-multiagent", (ctx, config = {}) => {
  const hostService = new CompanyHostService(ctx, config);
  sharedCompanyHostService = hostService;
  try {
    if (typeof ctx.provide === "function") {
      ctx.provide("companyHostService");
    }
    ctx.companyHostService = hostService;
  } catch {
    // Ignore if Cordis context proxy rejects unprovided property assignment
  }
  hostService.start();

  const routeDisposers = [];
  const registerRoute = (route) => {
    if (ctx.webServer && typeof ctx.webServer.register === "function") {
      const dispose = ctx.webServer.register(route);
      if (typeof dispose === "function") routeDisposers.push(dispose);
    }
  };

  registerRoute({
    kind: "exact",
    path: "/api/dsh-company/overview",
    handler: async (req, res) => {
      if (!isLoopbackOrPaired(ctx, req)) {
        writeJson(res, 403, { ok: false, error: "forbidden: loopback-only" });
        return;
      }
      try {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const force = url.searchParams.get("refresh") === "1";
        const sessionId = url.searchParams.get("sessionId") || null;
        const data = await hostService.overview({ forceBalances: force, sessionId });
        writeJson(res, 200, data);
      } catch (err) {
        writeJson(res, 500, { ok: false, error: err.message || String(err) });
      }
    },
  });

  registerRoute({
    kind: "exact",
    path: "/api/dsh-company/session-mode",
    handler: async (req, res) => {
      if (!isLoopbackOrPaired(ctx, req)) {
        writeJson(res, 403, { ok: false, error: "forbidden: loopback-only" });
        return;
      }
      try {
        if (req.method === "GET") {
          const url = new URL(req.url ?? "/", "http://127.0.0.1");
          const sessionId = url.searchParams.get("sessionId") || null;
          writeJson(res, 200, hostService.getSessionModeStatus(sessionId));
          return;
        }
        if (req.method !== "POST") {
          writeJson(res, 405, { ok: false, error: "method not allowed" });
          return;
        }
        const body = await readRequestBody(req);
        const status = hostService.setSessionMode({
          sessionId: body.sessionId || null,
          enabled: Boolean(body.enabled),
          applyGlobal: Boolean(body.applyGlobal),
          globalDefault:
            typeof body.globalDefault === "boolean" ? body.globalDefault : undefined,
          autoDispatchOnSwitch: body.autoDispatchOnSwitch,
        });
        let steerOutcome = null;
        if (body.enabled && body.steerLiveAgent && body.sessionId) {
          steerOutcome = hostService.steerLiveAgent(
            body.sessionId,
            body.prompt || FOREMAN_TRIGGER_PROMPT
          );
        }
        writeJson(res, 200, {
          ...status,
          steerOutcome,
        });
      } catch (err) {
        writeJson(res, 400, { ok: false, error: err.message || String(err) });
      }
    },
  });

  registerRoute({
    kind: "exact",
    path: "/api/dsh-company/session-dispatch",
    handler: async (req, res) => {
      if (!isLoopbackOrPaired(ctx, req)) {
        writeJson(res, 403, { ok: false, error: "forbidden: loopback-only" });
        return;
      }
      if (req.method !== "POST") {
        writeJson(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      try {
        const body = await readRequestBody(req);
        const sessionId = body.sessionId || null;
        if (sessionId) {
          hostService.setSessionMode({ sessionId, enabled: true });
        }
        const promptText = String(body.prompt || FOREMAN_TRIGGER_PROMPT).trim();
        const steerOutcome = hostService.steerLiveAgent(sessionId, promptText);
        writeJson(res, 200, {
          ok: true,
          sessionId,
          steerOutcome,
        });
      } catch (err) {
        writeJson(res, 400, { ok: false, error: err.message || String(err) });
      }
    },
  });

  registerRoute({
    kind: "exact",
    path: "/api/dsh-company/refresh",
    handler: async (req, res) => {
      if (!isLoopbackOrPaired(ctx, req)) {
        writeJson(res, 403, { ok: false, error: "forbidden: loopback-only" });
        return;
      }
      if (req.method !== "POST" && req.method !== "GET") {
        writeJson(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      try {
        const data = await hostService.overview({ forceBalances: true });
        writeJson(res, 200, data);
      } catch (err) {
        writeJson(res, 500, { ok: false, error: err.message || String(err) });
      }
    },
  });

  registerRoute({
    kind: "exact",
    path: "/api/dsh-company/execute",
    handler: async (req, res) => {
      if (!isLoopbackOrPaired(ctx, req)) {
        writeJson(res, 403, { ok: false, error: "forbidden: loopback-only" });
        return;
      }
      if (req.method !== "POST") {
        writeJson(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      try {
        const body = await readRequestBody(req);
        const outcome = await hostService.executeAction(body);
        writeJson(res, 200, outcome);
      } catch (err) {
        writeJson(res, 400, { ok: false, error: err.message || String(err) });
      }
    },
  });

  registerRoute({
    kind: "exact",
    path: "/api/dsh-company/clear-history",
    handler: async (req, res) => {
      if (!isLoopbackOrPaired(ctx, req)) {
        writeJson(res, 403, { ok: false, error: "forbidden: loopback-only" });
        return;
      }
      const outcome = hostService.clearHistory();
      writeJson(res, 200, outcome);
    },
  });

  registerRoute({
    kind: "exact",
    path: "/api/dsh-company/models",
    handler: async (req, res) => {
      if (!isLoopbackOrPaired(ctx, req)) {
        writeJson(res, 403, { ok: false, error: "forbidden: loopback-only" });
        return;
      }
      try {
        if (req.method === "GET") {
          const url = new URL(req.url ?? "/", "http://127.0.0.1");
          const forceScan = url.searchParams.get("scan") === "1";
          const modelConfig = getModelConfig({ forceScan });
          writeJson(res, 200, { ok: true, modelConfig });
          return;
        }
        if (req.method !== "POST") {
          writeJson(res, 405, { ok: false, error: "method not allowed" });
          return;
        }
        const body = await readRequestBody(req);
        const modelConfig = updateModelConfig(body);
        const overview = await hostService.overview({ forceBalances: false });
        writeJson(res, 200, { ok: true, modelConfig, overview });
      } catch (err) {
        writeJson(res, 400, { ok: false, error: err.message || String(err) });
      }
    },
  });

  // STRICT ISOLATION:
  // Do NOT register company tools, slash commands, or systemPrompt sections on the root `ctx`!
  // They are registered EXCLUSIVELY inside `lib/preset-tools.js`, which is mounted ONLY in the
  // "company" Agent Preset (`公司模式`), so no other mode ("standard", "liangshen", "ptc", etc.)
  // can ever see or invoke the company multi-agent tools.
  let disposePreset = null;
  let presetRetryTimer = null;
  const ensureCompanyPresetRegistered = () => {
    registerCompanyAgentPreset(ctx)
      .then((res) => {
        if (res && typeof res.dispose === "function") {
          disposePreset = res.dispose;
        }
        if (!res?.registered && !presetRetryTimer) {
          presetRetryTimer = setTimeout(() => {
            presetRetryTimer = null;
            registerCompanyAgentPreset(ctx)
              .then((retryRes) => {
                if (retryRes && typeof retryRes.dispose === "function") {
                  disposePreset = retryRes.dispose;
                }
              })
              .catch(() => {});
          }, 500);
          presetRetryTimer.unref?.();
        }
      })
      .catch(() => {});
  };
  ensureCompanyPresetRegistered();
  if (typeof ctx.inject === "function") {
    try {
      ctx.inject(["agentPresets"], () => {
        ensureCompanyPresetRegistered();
        return () => {
          if (presetRetryTimer) {
            clearTimeout(presetRetryTimer);
            presetRetryTimer = null;
          }
          if (typeof disposePreset === "function") {
            Promise.resolve(disposePreset()).catch(() => {});
            disposePreset = null;
          }
        };
      });
    } catch {
      // ignore
    }
  }

  ctx.effect?.(() => () => {
    hostService.stop();
    if (typeof disposePreset === "function") {
      Promise.resolve(disposePreset()).catch(() => {});
    }
    for (const d of routeDisposers) {
      try {
        d();
      } catch {
        // ignore
      }
    }
  });
});
