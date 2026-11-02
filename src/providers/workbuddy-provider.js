import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveDepartmentModel } from "../config/roster.js";
import {
  applyStructuredFileOperations,
  buildWorkspaceContextPrompt,
  getFileEditProtocolInstruction,
} from "./base-agent-loop.js";

const WB_PLUGIN_DIR = path.join(
  os.homedir(),
  ".dsh/profiles/desktop/node_modules/dsh-workbuddy-connect/lib"
);

// Map canonical company model IDs (kimi-3.1-pro, glm-5.3, qwen3.8-max, deepseek-v4.1-flash, glm-5.3-flash, qwen3.8-flash)
// to WorkBuddy's upstream API model identifiers while preserving canonical IDs in all reports/logs.
const WORKBUDDY_UPSTREAM_MODEL_MAP = {
  "kimi-3.1-pro": "kimi-k3-1",
  "glm-5.3": "glm-5.3",
  "qwen3.8-max": "hy4-preview",
  "deepseek-v4.1-flash": "deepseek-v4.1-flash",
  "glm-5.3-flash": "hy3",
  "qwen3.8-flash": "deepseek-v4.1-flash",
};

let cachedWbModules = null;

async function loadWorkBuddySdk() {
  if (cachedWbModules) return cachedWbModules;
  const indexPath = path.join(WB_PLUGIN_DIR, "index.js");
  if (!fs.existsSync(indexPath)) {
    throw new Error(`WorkBuddy connector not found at ${indexPath}`);
  }
  const files = fs.readdirSync(WB_PLUGIN_DIR);
  const hbFile = files.find((f) => f.startsWith("host-heartbeat-") && f.endsWith(".js"));
  const wb = await import(indexPath);
  const hb = hbFile ? await import(path.join(WB_PLUGIN_DIR, hbFile)) : null;

  const client = new wb.WorkBuddyUpstreamClient();
  const keyProvider = hb && typeof hb.b === "function" ? hb.b(wb.CN_VARIANT) : undefined;
  const store = new wb.WorkBuddyCredentialStore({
    variant: wb.CN_VARIANT,
    refresh: (c) => client.refreshToken(c),
    keyProvider,
  });

  cachedWbModules = { wb, hb, client, store };
  return cachedWbModules;
}

/**
 * Query live WorkBuddy account status and remaining credits.
 */
export async function getWorkBuddyStatus() {
  try {
    const { store } = await loadWorkBuddySdk();
    const st = await store.status();
    return {
      available: st.state === "signed-in",
      state: st.state,
      domain: st.domain || "www.workbuddy.cn",
      credits: st.credits ?? null,
    };
  } catch (err) {
    return {
      available: false,
      state: "error",
      error: err.message,
    };
  }
}

/**
 * Run a task on the WorkBuddy department (Engineering Dept 2).
 *
 * Model routing rule:
 * - Planning / Review tasks (`phase: "plan" | "review"`): use large models (`kimi-3.1-pro`, `glm-5.3`, `qwen3.8-max`)
 * - Execution tasks (`phase: "execute"`): use flash models (`deepseek-v4.1-flash`, `glm-5.3-flash`, `qwen3.8-flash`)
 */
export async function runWorkBuddyAgent({
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
  const resolvedModel = resolveDepartmentModel("workbuddy", model, {
    complexity,
    phase: effectivePhase,
  });
  const startMs = Date.now();

  const fullPrompt = allowFileEdits
    ? [
        buildWorkspaceContextPrompt(workspaceRoot, allowedFiles),
        getFileEditProtocolInstruction(allowedFiles),
        `## 施工任务指令\n${prompt}`,
      ].join("\n\n")
    : prompt;

  if (typeof mockRunner === "function") {
    const res = await mockRunner({
      department: "workbuddy",
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
    return {
      ok: res.ok !== false,
      department: "workbuddy",
      model: resolvedModel,
      phase: effectivePhase,
      output: res.output || "",
      quotaNote: "WorkBuddy 桌面端账号额度",
      durationMs: Date.now() - startMs,
      error: res.error || null,
    };
  }

  try {
    const { wb, client, store } = await loadWorkBuddySdk();
    const cred = await store.resolve();
    const upstreamModel = WORKBUDDY_UPSTREAM_MODEL_MAP[resolvedModel] || resolvedModel;

    const payload = wb.prepareChatBody(
      JSON.stringify({
        model: upstreamModel,
        messages: [
          {
            role: "system",
            content:
              `你是公司工程二部 (WorkBuddy) 的核心工程师（当前模型席位：${resolvedModel}，负责环节：${effectivePhase}）。请严格遵循包工头 (dsh) 下达的工单要求与文件修改范围，高质量完成代码开发或技术分析。`,
          },
          { role: "user", content: fullPrompt },
        ],
        stream: true,
      })
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await client.chatStream(cred, payload, controller.signal);
      if (!result.ok) {
        throw new Error(`WorkBuddy upstream error (${result.kind}): ${result.message}`);
      }
      const rawSse = await result.response.text();
      const parsed = parseOpenAiSseStream(rawSse);

      if (allowFileEdits && parsed.content) {
        applyStructuredFileOperations(workspaceRoot, parsed.content, allowedFiles);
      }

      return {
        ok: true,
        department: "workbuddy",
        model: resolvedModel,
        phase: effectivePhase,
        output: parsed.content,
        reasoning: parsed.reasoning,
        quotaNote:
          upstreamModel === "hy3"
            ? `WorkBuddy 账号额度 (${resolvedModel})`
            : `WorkBuddy 账号 Credits 额度 (${resolvedModel})`,
        durationMs: Date.now() - startMs,
        error: null,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return {
      ok: false,
      department: "workbuddy",
      model: resolvedModel,
      phase: effectivePhase,
      output: "",
      quotaNote: "WorkBuddy 账号额度",
      durationMs: Date.now() - startMs,
      error: err.message || String(err),
    };
  }
}

export function parseOpenAiSseStream(rawSse) {
  let content = "";
  let reasoning = "";
  const lines = String(rawSse || "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const dataStr = trimmed.slice(5).trim();
    if (!dataStr || dataStr === "[DONE]") continue;
    try {
      const chunk = JSON.parse(dataStr);
      // Handle double-wrapped SSE (like Qoder) or standard OpenAI SSE
      const inner = typeof chunk.body === "string" ? JSON.parse(chunk.body) : chunk;
      const delta = inner?.choices?.[0]?.delta || inner?.choices?.[0]?.message;
      if (delta) {
        if (typeof delta.content === "string") content += delta.content;
        if (typeof delta.reasoning_content === "string") reasoning += delta.reasoning_content;
      }
    } catch {
      // ignore malformed chunk
    }
  }
  return { content: content.trim(), reasoning: reasoning.trim() };
}
