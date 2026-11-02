import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveDepartmentModel } from "../config/roster.js";
import {
  applyStructuredFileOperations,
  buildWorkspaceContextPrompt,
  getFileEditProtocolInstruction,
} from "./base-agent-loop.js";

const QODER_WORKER_MJS =
  "/Applications/Qoder CN.app/Contents/Resources/app.asar.unpacked/node_modules/@qoder-ai/qoder-cn-agent-sdk/dist/_worker/qoder-worker-runtime.obf.mjs";

const USAGE_STORE_PATH = path.join(os.homedir(), ".dsh/dsh-company/qoder-usage.json");

function recordIndependentQoderUsage({ model, tokens = 0 }) {
  try {
    fs.mkdirSync(path.dirname(USAGE_STORE_PATH), { recursive: true });
    let data = { events: [] };
    if (fs.existsSync(USAGE_STORE_PATH)) {
      data = JSON.parse(fs.readFileSync(USAGE_STORE_PATH, "utf8"));
      if (!Array.isArray(data.events)) data.events = [];
    }
    const now = Date.now();
    const cutoff = now - 7 * 24 * 3600 * 1000;
    data.events = data.events.filter((e) => e && e.ts >= cutoff);
    data.events.push({ ts: now, model, tokens: Number(tokens) || 0 });
    fs.writeFileSync(USAGE_STORE_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch {
    // ignore disk errors
  }
}

export function readIndependentQoderUsage() {
  try {
    if (!fs.existsSync(USAGE_STORE_PATH)) {
      return { hourlyCalls: 0, todayCalls: 0, todayTokens: 0 };
    }
    const data = JSON.parse(fs.readFileSync(USAGE_STORE_PATH, "utf8"));
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

export function hasQoderCliCredentials() {
  return (
    fs.existsSync(path.join(os.homedir(), ".dsh/.qoder-auth.qoder-cn.json")) ||
    fs.existsSync(path.join(os.homedir(), ".dsh/.qoder-auth.qoder.json")) ||
    Boolean(
      process.env.QODERCN_PAT ||
        process.env.QODERCN_PERSONAL_ACCESS_TOKEN ||
        process.env.QODERCN_API_KEY ||
        process.env.QODER_PAT
    )
  );
}

/**
 * Inspect Qoder CN's real local status, plan tier, campaign credits, and session history on this Mac.
 * Strictly independent from WorkBuddy.
 */
export function inspectQoderLocalTelemetry() {
  const home = os.homedir();
  const statusFile = path.join(home, ".qoder-cn/.qoder-app-status.json");
  let appStatus = null;
  if (fs.existsSync(statusFile)) {
    try {
      appStatus = JSON.parse(fs.readFileSync(statusFile, "utf8"));
    } catch {
      // ignore
    }
  }

  const logsRoot = path.join(
    home,
    "Library/Application Support/com.qodercn.app.stable/logs"
  );
  let planType = null;
  let campaignCredits = [];
  let platformModelCount = null;
  let lastPlanCheckAt = null;
  let creditsSummaryStatus = null;

  if (fs.existsSync(logsRoot)) {
    try {
      const dirs = fs
        .readdirSync(logsRoot)
        .map((d) => ({ name: d, full: path.join(logsRoot, d) }))
        .filter((d) => {
          try {
            return fs.statSync(d.full).isDirectory();
          } catch {
            return false;
          }
        })
        .sort((a, b) => b.name.localeCompare(a.name));

      for (const d of dirs.slice(0, 3)) {
        const mainLog = path.join(d.full, "main.log");
        if (!fs.existsSync(mainLog)) continue;
        const lines = fs.readFileSync(mainLog, "utf8").split("\n");
        for (const line of lines) {
          if (
            line.includes("account.getUserPlan") &&
            line.includes('"status":200')
          ) {
            const m = line.match(/\{.*\}/);
            if (m) {
              try {
                const obj = JSON.parse(m[0]);
                if (obj.userType) planType = obj.userType;
              } catch {
                // ignore
              }
            }
            const tm = line.match(/^\[([^\]]+)\]/);
            if (tm) lastPlanCheckAt = tm[1];
          }
          if (
            line.includes("account.getProfileMetric") &&
            line.includes('"source":"credits-summary"')
          ) {
            const m = line.match(/\{.*\}/);
            if (m) {
              try {
                const obj = JSON.parse(m[0]);
                if (obj.status) creditsSummaryStatus = obj.status;
              } catch {
                // ignore
              }
            }
          }
          if (
            line.includes("/sash/api/v1/me/campaigns") &&
            line.includes('"payload":')
          ) {
            const m = line.match(/\{.*\}/);
            if (m) {
              try {
                const obj = JSON.parse(m[0]);
                const camps = obj?.payload?.campaigns || [];
                campaignCredits = camps
                  .filter((c) => c?.benefit?.kind === "CREDITS")
                  .map((c) => ({
                    key: c.campaignKey,
                    amount: Number(c.benefit.amount) || 0,
                    status: c.claimStatus,
                  }));
              } catch {
                // ignore
              }
            }
          }
          if (line.includes("Model Policy snapshot committed")) {
            const m = line.match(/\{.*\}/);
            if (m) {
              try {
                const obj = JSON.parse(m[0]);
                if (typeof obj.platformModelCount === "number") {
                  platformModelCount = obj.platformModelCount;
                }
              } catch {
                // ignore
              }
            }
          }
        }
        if (planType) break;
      }
    } catch {
      // ignore
    }
  }

  let sessionCount = 0;
  let turnCount = 0;
  let billedCreditsTotal = 0;
  let billableRequestCount = 0;
  const billedCreditsByModel = {};
  const seenRequestIds = new Set();
  const projRoot = path.join(home, ".qoder-cn/projects");
  if (fs.existsSync(projRoot)) {
    try {
      for (const pDir of fs.readdirSync(projRoot)) {
        const fullP = path.join(projRoot, pDir);
        if (!fs.statSync(fullP).isDirectory()) continue;
        for (const f of fs.readdirSync(fullP)) {
          if (f.endsWith(".jsonl")) {
            sessionCount++;
            const content = fs.readFileSync(path.join(fullP, f), "utf8").trim();
            if (!content) continue;
            const lines = content.split("\n");
            turnCount += lines.length;
            for (const line of lines) {
              if (!line.includes('"credits"')) continue;
              try {
                const obj = JSON.parse(line);
                const msg = obj?.message;
                const u = msg?.usage;
                if (u && typeof u.credits === "number") {
                  const reqId = u.request_id || obj.uuid;
                  if (reqId && !seenRequestIds.has(reqId)) {
                    seenRequestIds.add(reqId);
                    billedCreditsTotal += u.credits;
                    billableRequestCount++;
                    const mKey = msg.model || "unknown";
                    billedCreditsByModel[mKey] =
                      Math.round(((billedCreditsByModel[mKey] || 0) + u.credits) * 100) / 100;
                  }
                }
              } catch {
                // ignore malformed jsonl line
              }
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }
  billedCreditsTotal = Math.round(billedCreditsTotal * 100) / 100;

  return {
    loggedIn: Boolean(appStatus?.logged_in),
    accountName: appStatus?.name || null,
    appVersion: appStatus?.version || null,
    uid:
      appStatus?.avatar_url?.match(/users\/([0-9a-f-]+)\//i)?.[1] || null,
    planType,
    campaignCredits,
    platformModelCount,
    lastPlanCheckAt,
    creditsSummaryStatus,
    sessionCount,
    turnCount,
    billedCreditsTotal,
    billableRequestCount,
    billedCreditsByModel,
  };
}

/**
 * Query Qoder CN status on this machine (strictly independent from WorkBuddy).
 */
export async function getQoderStatus() {
  const local = inspectQoderLocalTelemetry();
  const hasCliAuth = hasQoderCliCredentials();

  return {
    available: local.loggedIn || hasCliAuth,
    independentBilling: true,
    desktopAppLoggedIn: local.loggedIn,
    accountName: local.accountName || "qoder-cn",
    uid: local.uid,
    appVersion: local.appVersion,
    planType: local.planType,
    campaignCredits: local.campaignCredits,
    platformModelCount: local.platformModelCount,
    sessionCount: local.sessionCount,
    turnCount: local.turnCount,
    hasOpenApiToken: hasCliAuth,
    mode: hasCliAuth ? "native-qoder-cn-openapi" : "qoder-cn-independent",
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

async function runIndependentQoderModelCompletion({
  prompt,
  model,
  timeoutMs = 60000,
}) {
  // 1. Try Qoder CN OpenAPI Gateway if Qoder token is present
  const qoderAuthFile = path.join(os.homedir(), ".dsh/.qoder-auth.qoder-cn.json");
  let qoderToken =
    process.env.QODERCN_PAT ||
    process.env.QODERCN_PERSONAL_ACCESS_TOKEN ||
    process.env.QODERCN_API_KEY ||
    null;
  if (!qoderToken && fs.existsSync(qoderAuthFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(qoderAuthFile, "utf8"));
      qoderToken = parsed?.accessToken || parsed?.token || parsed?.pat || null;
    } catch {
      // ignore
    }
  }

  // 2. Use independent DashScope (Qwen) / Zhipu (GLM) / DeepSeek API keys from ~/.dsh/.credentials.yaml (NEVER WorkBuddy!)
  const qwenKey =
    loadIndependentDshCredentialKey("QWEN_API_KEY") ||
    loadIndependentDshCredentialKey("QWEN_PAYG_API_KEY");
  const zaiKey = loadIndependentDshCredentialKey("ZAI_API_KEY");
  const dsKey = loadIndependentDshCredentialKey("DEEPSEEK_API_KEY");

  const candidates = [];
  if (model.startsWith("qwen") && qwenKey) {
    candidates.push({
      url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      key: qwenKey,
      upstreamModel: model === "qwen3.8-max" ? "qwen-max" : "qwen-plus",
    });
  }
  if (model.startsWith("glm") && zaiKey) {
    candidates.push({
      url: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      key: zaiKey,
      upstreamModel: model === "glm-5.3" ? "glm-4-plus" : "glm-4-flash",
    });
  }
  if (dsKey) {
    candidates.push({
      url: "https://api.deepseek.com/v1/chat/completions",
      key: dsKey,
      upstreamModel: "deepseek-chat",
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
          model: c.upstreamModel,
          messages: [
            {
              role: "system",
              content: `你是 Qoder (工程一部) 的 ${model} 专职智能体（独立计费通道，与 WorkBuddy 物理隔离）。请严格按指令完成规划、编码或审查。`,
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.2,
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

  return {
    ok: false,
    output: "",
    tokens: 0,
    error: "Qoder 独立执行通道未返回结果（请检查 Qoder 授权或独立 API 密钥）",
  };
}

/**
 * Run a task on the Qoder department (Engineering Dept 1).
 * Strictly independent from WorkBuddy (never calls runWorkBuddyAgent or consumes WorkBuddy credits).
 */
export async function runQoderAgent({
  prompt,
  model = "auto",
  phase = null,
  complexity = "medium",
  workspaceRoot = process.cwd(),
  allowedFiles = ["*"],
  allowFileEdits = true,
  timeoutMs = 60000,
  mockRunner = null,
}) {
  const effectivePhase = phase || (allowFileEdits ? "execute" : "plan");
  const resolvedModel = resolveDepartmentModel("qoder", model, {
    complexity,
    phase: effectivePhase,
  });
  const startMs = Date.now();

  const fullPrompt = allowFileEdits
    ? [
        buildWorkspaceContextPrompt(workspaceRoot, allowedFiles),
        getFileEditProtocolInstruction(allowedFiles),
        `## 工程一部 (Qoder · 独立计费通道) 施工指令\n${prompt}`,
      ].join("\n\n")
    : prompt;

  if (typeof mockRunner === "function") {
    const res = await mockRunner({
      department: "qoder",
      model: resolvedModel,
      phase: effectivePhase,
      prompt: fullPrompt,
      workspaceRoot,
      allowedFiles,
      allowFileEdits,
    });
    if (allowFileEdits && res.output) {
      applyStructuredFileOperations(workspaceRoot, res.output, allowedFiles);
    }
    recordIndependentQoderUsage({
      model: resolvedModel,
      tokens: Math.ceil((fullPrompt.length + (res.output || "").length) / 4),
    });
    return {
      ok: res.ok !== false,
      department: "qoder",
      independentBilling: true,
      model: resolvedModel,
      phase: effectivePhase,
      output: res.output || "",
      quotaNote: "Qoder CN 独立计费额度（与 WorkBuddy 物理隔离）",
      durationMs: Date.now() - startMs,
      error: res.error || null,
    };
  }

  // 1. Try native Qoder CLI if authenticated
  if (fs.existsSync(QODER_WORKER_MJS) && hasQoderCliCredentials()) {
    const cliRes = await tryRunQoderCli({
      prompt: fullPrompt,
      model: resolvedModel,
      workspaceRoot,
      allowedFiles,
      allowFileEdits,
      timeoutMs,
    });
    if (cliRes.ok) {
      recordIndependentQoderUsage({
        model: resolvedModel,
        tokens: Math.ceil((fullPrompt.length + cliRes.output.length) / 4),
      });
      return {
        ...cliRes,
        department: "qoder",
        independentBilling: true,
        model: resolvedModel,
        phase: effectivePhase,
        durationMs: Date.now() - startMs,
      };
    }
  }

  // 2. Run on Qoder's independent model channel (NEVER WorkBuddy)
  const indRes = await runIndependentQoderModelCompletion({
    prompt: fullPrompt,
    model: resolvedModel,
    timeoutMs,
  });

  if (indRes.ok && allowFileEdits && indRes.output) {
    applyStructuredFileOperations(workspaceRoot, indRes.output, allowedFiles);
  }
  if (indRes.ok) {
    recordIndependentQoderUsage({
      model: resolvedModel,
      tokens: indRes.tokens,
    });
  }

  return {
    ok: indRes.ok,
    department: "qoder",
    independentBilling: true,
    model: resolvedModel,
    phase: effectivePhase,
    output: indRes.output,
    quotaNote: `Qoder CN 独立计费通道 (${resolvedModel})`,
    durationMs: Date.now() - startMs,
    error: indRes.error || null,
  };
}

function tryRunQoderCli({
  prompt,
  model,
  workspaceRoot,
  allowedFiles,
  allowFileEdits,
  timeoutMs,
}) {
  return new Promise((resolve) => {
    const args = [
      QODER_WORKER_MJS,
      "-p",
      "-w",
      path.resolve(workspaceRoot),
      "--permission-mode",
      "bypass_permissions",
      "-m",
      model,
      prompt,
    ];
    execFile(
      process.execPath,
      args,
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        const out = String(stdout || "").trim();
        if (err || !out || /Not logged in/i.test(out)) {
          resolve({
            ok: false,
            error: err?.message || out || "Qoder CLI not logged in",
          });
          return;
        }
        if (allowFileEdits) {
          applyStructuredFileOperations(workspaceRoot, out, allowedFiles);
        }
        resolve({
          ok: true,
          output: out,
          quotaNote: "Qoder CN 独立账号 Credits",
          error: null,
        });
      }
    );
  });
}
