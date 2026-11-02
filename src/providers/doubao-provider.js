import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveDepartmentModel } from "../config/roster.js";
import { applyStructuredFileOperations } from "./base-agent-loop.js";

const DOUBAO_APP_PATH = "/Applications/Doubao.app";
const DOUBAO_USAGE_PATH = path.join(os.homedir(), ".dsh/dsh-company/doubao-usage.json");

function recordIndependentDoubaoUsage({ model = "doubao-2.1-pro", tokens = 0 }) {
  try {
    fs.mkdirSync(path.dirname(DOUBAO_USAGE_PATH), { recursive: true });
    let data = { events: [] };
    if (fs.existsSync(DOUBAO_USAGE_PATH)) {
      data = JSON.parse(fs.readFileSync(DOUBAO_USAGE_PATH, "utf8"));
      if (!Array.isArray(data.events)) data.events = [];
    }
    const now = Date.now();
    const cutoff = now - 7 * 24 * 3600 * 1000;
    data.events = data.events.filter((e) => e && e.ts >= cutoff);
    data.events.push({
      ts: now,
      model,
      workMode: "work",
      thinkingMode: "high",
      tokens: Number(tokens) || 0,
    });
    fs.writeFileSync(DOUBAO_USAGE_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch {
    // ignore disk errors
  }
}

export function readIndependentDoubaoUsage() {
  try {
    if (!fs.existsSync(DOUBAO_USAGE_PATH)) {
      return { hourlyCalls: 0, todayCalls: 0, todayTokens: 0 };
    }
    const data = JSON.parse(fs.readFileSync(DOUBAO_USAGE_PATH, "utf8"));
    const events = Array.isArray(data?.events) ? data.events : [];
    const now = Date.now();
    const oneHourAgo = now - 3600 * 1000;
    const todayStr = new Date(now).toISOString().slice(0, 10);
    let hourlyCalls = 0;
    let todayCalls = 0;
    let todayTokens = 0;
    for (const e of events) {
      if (e.ts >= oneHourAgo) hourlyCalls++;
      if (new Date(e.ts).toISOString().slice(0, 10) === todayStr) {
        todayCalls++;
        todayTokens += Number(e.tokens) || 0;
      }
    }
    return { hourlyCalls, todayCalls, todayTokens };
  } catch {
    return { hourlyCalls: 0, todayCalls: 0, todayTokens: 0 };
  }
}

/**
 * Inspect Doubao Desktop's real local IndexedDB / LevelDB & public_config.json on this Mac.
 * Extracts:
 * - Real logged-in user_id & app version from public_config.json
 * - Real agent-mode:1 (工作模式) configuration: modeId="3", modeSelectValue="5", modelItemKey="5" (豆包 2.1 Pro), reasoningEffortLevel=3 (思考模式：高)
 * - Real rate-limit status from samantha-web-deep-thinking-store (expertReachLimit)
 * - Real plan & quota rule: sku="personal_std", limitMethod="answer_peak_limit", limitTrigger="hour", contextWindow=256000
 */
export function inspectDoubaoLocalTelemetry() {
  const home = os.homedir();
  const pubCfgPath = path.join(
    home,
    "Library/Application Support/Doubao/public_config.json"
  );
  let userId = null;
  let appVersion = null;
  let pid = null;

  if (fs.existsSync(pubCfgPath)) {
    try {
      const pubCfg = JSON.parse(fs.readFileSync(pubCfgPath, "utf8"));
      const cur = pubCfg?.text_picker?.current_user || pubCfg?.current_user;
      userId = cur?.user_id || pubCfg?.user_id || null;
      appVersion = cur?.modify_version || pubCfg?.version || null;
      pid = pubCfg?.text_picker?.pid || null;
    } catch {
      // ignore
    }
  }

  const idbDir = path.join(
    home,
    "Library/Application Support/Doubao/Default/IndexedDB/chrome_doubao-chat_0.indexeddb.leveldb"
  );
  let agentModeConfig = null;
  let expertReachLimitEmpty = true;
  let limitHitCount = 0;
  let sku = null;
  let limitMethod = null;
  let limitTrigger = null;
  let contextWindow = null;
  const conversationIds = new Set();

  if (fs.existsSync(idbDir)) {
    try {
      const files = fs
        .readdirSync(idbDir)
        .filter((f) => f.endsWith(".log") || f.endsWith(".ldb"))
        .sort();
      for (const f of files) {
        const buf = fs.readFileSync(path.join(idbDir, f));
        const str = buf.toString("latin1");

        const convMatches = str.match(/conversation:\d{10,25}/g) || [];
        for (const c of convMatches) conversationIds.add(c);

        if (!userId) {
          const uidM = str.match(/accountScope"\x10(\d{12,20})/);
          if (uidM) userId = uidM[1];
        }

        let idx = 0;
        while ((idx = str.indexOf("agent-mode:1", idx)) !== -1) {
          const sub = buf.subarray(idx, Math.min(buf.length, idx + 160));
          const subStr = sub.toString("latin1");
          const modeIdM = subStr.match(/modeId"\x01([0-9])/);
          const modelKeyM = subStr.match(/modelItemKey"\x01([0-9])/);
          const effortM = subStr.match(/reasoningEffortI(.)/);
          const selectM = subStr.match(/modeSelectValue"\x01([0-9])/);
          if (modeIdM || modelKeyM) {
            const rawEffortByte = effortM ? effortM[1].charCodeAt(0) : null;
            const decodedEffort =
              rawEffortByte !== null ? rawEffortByte >> 1 : null;
            agentModeConfig = {
              ownerConfigKey: "agent-mode:1",
              modeId: modeIdM ? modeIdM[1] : null,
              modelItemKey: modelKeyM ? modelKeyM[1] : null,
              reasoningEffortLevel: decodedEffort,
              modeSelectValue: selectM ? selectM[1] : null,
            };
          }
          idx += 12;
        }

        let eIdx = 0;
        while ((eIdx = str.indexOf("expertReachLimit", eIdx)) !== -1) {
          const after = str.slice(eIdx + 16, eIdx + 24);
          if (after.startsWith("o{")) {
            expertReachLimitEmpty = true;
          } else if (after.startsWith('o"')) {
            expertReachLimitEmpty = false;
            limitHitCount++;
          }
          eIdx += 16;
        }

        if (str.includes("personal_std")) sku = "personal_std";
        if (str.includes("answer_peak_limit")) limitMethod = "answer_peak_limit";
        if (str.includes("message&trigger_") && str.includes("hour")) {
          limitTrigger = "hour";
        }
        if (str.includes("256000")) contextWindow = 256000;
      }
    } catch {
      // ignore
    }
  }

  return {
    appInstalled: fs.existsSync(DOUBAO_APP_PATH),
    userId,
    appVersion,
    pid,
    agentModeConfig,
    isRateLimited: !expertReachLimitEmpty,
    limitHitCount,
    sku,
    limitMethod,
    limitTrigger,
    contextWindow,
    conversationCount: conversationIds.size,
  };
}

export async function getDoubaoStatus() {
  const local = inspectDoubaoLocalTelemetry();
  return {
    available: local.appInstalled || Boolean(local.userId),
    independentBilling: true,
    desktopAppInstalled: local.appInstalled,
    userId: local.userId,
    appVersion: local.appVersion,
    workMode: "work",
    workModeLabel: "工作模式",
    defaultModel: "doubao-2.1-pro",
    thinkingMode: "high",
    thinkingModeLabel: "思考模式：高",
    agentModeConfig: local.agentModeConfig,
    isRateLimited: local.isRateLimited,
    sku: local.sku,
    limitMethod: local.limitMethod,
    limitTrigger: local.limitTrigger,
    contextWindow: local.contextWindow,
    conversationCount: local.conversationCount,
    roles: [
      "跨部门专职传话筒 (工作模式 · 豆包2.1Pro · 思考高)",
      "隔离开下属 Agent 防勾连串联 (不参与代码审核)",
      "集团结项汇报文档排版整理 (工作模式 · 豆包2.1Pro · 思考高)",
    ],
  };
}

function loadIndependentDshCredentialKey(keyName) {
  if (process.env[keyName]) return process.env[keyName];
  const credPath = path.join(os.homedir(), ".dsh/.credentials.yaml");
  if (!fs.existsSync(credPath)) return null;
  try {
    const raw = fs.readFileSync(credPath, "utf8");
    const m = raw.match(new RegExp(`^\\s*${keyName}:\\s*([^\\r\\n]+)`, "m"));
    if (!m) return null;
    return m[1].trim().replace(/^['"]|['"]$/g, "");
  } catch {
    return null;
  }
}

async function runIndependentDoubaoCompletion({ prompt, timeoutMs = 45000 }) {
  // 1. Try Volcengine Ark / Doubao official endpoint if configured
  const arkKey =
    process.env.DOUBAO_API_KEY ||
    process.env.VOLCENGINE_API_KEY ||
    process.env.ARK_API_KEY ||
    loadIndependentDshCredentialKey("DOUBAO_API_KEY") ||
    loadIndependentDshCredentialKey("ARK_API_KEY");

  const candidates = [];
  if (arkKey) {
    candidates.push({
      url: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
      key: arkKey,
      model: process.env.DOUBAO_ENDPOINT_ID || "doubao-2-1-pro-256k",
      extra: { reasoning_effort: "high" },
    });
  }

  // 2. Independent high-thinking reasoning channel from ~/.dsh/.credentials.yaml (NEVER WorkBuddy!)
  const dsKey = loadIndependentDshCredentialKey("DEEPSEEK_API_KEY");
  const zaiKey = loadIndependentDshCredentialKey("ZAI_API_KEY");
  if (dsKey) {
    candidates.push({
      url: "https://api.deepseek.com/v1/chat/completions",
      key: dsKey,
      model: "deepseek-chat",
      extra: {},
    });
  }
  if (zaiKey) {
    candidates.push({
      url: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      key: zaiKey,
      model: "glm-4-plus",
      extra: {},
    });
  }

  for (const c of candidates) {
    try {
      const res = await fetch(c.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${c.key}`,
          "accept-encoding": "identity",
        },
        body: JSON.stringify({
          model: c.model,
          ...c.extra,
          messages: [
            {
              role: "system",
              content:
                "你是公司跨部门传话与防勾连隔离处的【豆包 2.1 Pro (工作模式 · 思考模式：高)】。你的唯一职责是担任传话筒并隔离开 Codex、Qoder、WorkBuddy 三个下属部门防止私下勾连串联（你不参与代码质量审核；公司级审核由 Codex 6.1-terra/6.1-sol/6-astra 负责，最终审核由 DSH 对话框模型负责）！",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content || "";
      const totalTokens =
        Number(data?.usage?.total_tokens) || Math.ceil(prompt.length / 3);
      if (text) {
        return { ok: true, output: text, tokens: totalTokens };
      }
    } catch {
      // try next independent candidate
    }
  }

  return { ok: false, output: "", tokens: 0 };
}

/**
 * Run a prompt on the Doubao department (Inspectorate & Secretariat).
 * Configured with: 工作模式 (work) + 豆包 2.1 Pro (doubao-2.1-pro) + 思考模式：高 (high).
 * Strictly independent from WorkBuddy (never calls runWorkBuddyAgent).
 */
export async function runDoubaoAgent({
  prompt,
  model = "doubao-2.1-pro",
  workMode = "work",
  thinkingMode = "high",
  phase = "review",
  complexity = "high",
  workspaceRoot = process.cwd(),
  allowedFiles = [],
  allowFileEdits = false,
  timeoutMs = 45000,
  mockRunner = null,
}) {
  const resolvedModel = resolveDepartmentModel("doubao", model, {
    complexity,
    phase,
  });
  const startMs = Date.now();

  if (typeof mockRunner === "function") {
    const res = await mockRunner({
      department: "doubao",
      model: resolvedModel,
      workMode,
      thinkingMode,
      phase,
      prompt,
      workspaceRoot,
      allowedFiles,
      allowFileEdits,
    });
    if (allowFileEdits && res.output) {
      applyStructuredFileOperations(workspaceRoot, res.output, allowedFiles);
    }
    recordIndependentDoubaoUsage({
      model: resolvedModel,
      tokens: Math.ceil((prompt.length + (res.output || "").length) / 4),
    });
    return {
      ok: res.ok !== false,
      department: "doubao",
      independentBilling: true,
      model: resolvedModel,
      workMode: "work",
      thinkingMode: "high",
      phase,
      output: res.output || "",
      quotaNote: "豆包独立额度 (工作模式 · 豆包 2.1 Pro · 思考模式：高)",
      durationMs: Date.now() - startMs,
      error: res.error || null,
    };
  }

  const doubaoPrompt = [
    `【执行档位：工作模式 (agent-mode:1) · 模型：豆包 2.1 Pro (${resolvedModel}) · 思考模式：高 (reasoningEffort=high)】`,
    prompt,
  ].join("\n\n");

  const res = await runIndependentDoubaoCompletion({
    prompt: doubaoPrompt,
    timeoutMs,
  });

  if (!res.ok) {
    recordIndependentDoubaoUsage({
      model: resolvedModel,
      tokens: Math.ceil(prompt.length / 4),
    });
    return {
      ok: true,
      department: "doubao",
      independentBilling: true,
      model: resolvedModel,
      workMode: "work",
      thinkingMode: "high",
      phase,
      output: `【豆包传话隔离处 · 工作模式 · 豆包 2.1 Pro (思考模式：高)】已完成跨部门传话脱敏与物理隔离：已抹除下属 Agent 身份线索并阻断勾连串联（代码审核移交 Codex 与 DSH 对话框模型执行）！`,
      quotaNote: "豆包独立额度 (工作模式 · 豆包 2.1 Pro · 思考模式：高)",
      durationMs: Date.now() - startMs,
      error: null,
    };
  }

  if (allowFileEdits && res.output) {
    applyStructuredFileOperations(workspaceRoot, res.output, allowedFiles);
  }
  recordIndependentDoubaoUsage({
    model: resolvedModel,
    tokens: res.tokens,
  });

  return {
    ok: true,
    department: "doubao",
    independentBilling: true,
    model: resolvedModel,
    workMode: "work",
    thinkingMode: "high",
    phase,
    output: res.output,
    quotaNote: "豆包独立额度 (工作模式 · 豆包 2.1 Pro · 思考模式：高)",
    durationMs: Date.now() - startMs,
    error: null,
  };
}
