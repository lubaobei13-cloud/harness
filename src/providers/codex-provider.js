import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveDepartmentModel, FORBIDDEN_CODEX_PATTERNS } from "../config/roster.js";
import {
  applyStructuredFileOperations,
  buildWorkspaceContextPrompt,
  getFileEditProtocolInstruction,
} from "./base-agent-loop.js";

export const CODEX_BIN_PATH =
  process.env.CODEX_BIN_PATH ||
  "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex";

/**
 * Execute a prompt using the Codex (ChatGPT) department.
 *
 * Policy:
 * - Default model: `gpt-6.1-sol`
 * - If `gpt-6.1-sol` fails or indicates it cannot solve the issue, automatically summon `gpt-6-astra`.
 * - NEVER allow `luna` models (`gpt-6-luna`, `gpt-5.6-luna`).
 */
export async function runCodexAgent({
  prompt,
  model = "gpt-6.1-sol",
  phase = "plan",
  workspaceRoot = process.cwd(),
  allowedFiles = [],
  allowFileEdits = false,
  reasoningEffort = "low",
  autoEscalateToAstra = true,
  timeoutMs = 90000,
  mockRunner = null,
}) {
  // Strictly block luna models
  if (model && FORBIDDEN_CODEX_PATTERNS.some((p) => p.test(String(model)))) {
    throw new Error(
      `[Codex Policy Error] 严禁在 Codex 部门使用 luna 模型 ("${model}")！系统已固定默认使用 gpt-6.1-sol，疑难问题召唤 gpt-6-astra。`
    );
  }

  const effectivePhase = phase || (allowFileEdits ? "execute" : "plan");
  const primaryModel = resolveDepartmentModel("codex", model, { strict: true, phase: effectivePhase });
  const startMs = Date.now();

  let attemptResult = await executeSingleCodexCall({
    prompt,
    model: primaryModel,
    phase: effectivePhase,
    workspaceRoot,
    allowedFiles,
    allowFileEdits,
    reasoningEffort,
    timeoutMs,
    mockRunner,
  });

  // If gpt-6.1-terra was used and encountered a CLI model-id fallback need, smoothly coordinate with gpt-6.1-sol before escalating to gpt-6-astra
  if (!attemptResult.ok && primaryModel === "gpt-6.1-terra" && typeof mockRunner !== "function") {
    const solFallback = await executeSingleCodexCall({
      prompt,
      model: "gpt-6.1-sol",
      phase: effectivePhase,
      workspaceRoot,
      allowedFiles,
      allowFileEdits,
      reasoningEffort,
      timeoutMs,
      mockRunner,
    });
    if (solFallback.ok) {
      attemptResult = {
        ...solFallback,
        coReviewedWith: ["gpt-6.1-terra", "gpt-6.1-sol"],
      };
    }
  }

  // Check if we need to summon gpt-6-astra
  const needsAstra =
    autoEscalateToAstra &&
    primaryModel !== "gpt-6-astra" &&
    (!attemptResult.ok ||
      /\[(?:NEED_ASTRA|UNRESOLVED|ESCALATE_TO_ASTRA)\]/i.test(attemptResult.output || ""));

  if (needsAstra) {
    const astraPrompt = [
      `【🔥 Astra 终极会诊令】`,
      `前序主官模型 (gpt-6.1-sol) 在处理以下任务时遇到瓶颈或未能彻底解决：`,
      `前序状态/反馈：${attemptResult.error || attemptResult.output?.slice(0, 600) || "未决难题"}`,
      ``,
      `请你作为 Codex 终极核武 (gpt-6-astra) 接手并彻底攻克该问题：`,
      prompt,
    ].join("\n");

    const astraResult = await executeSingleCodexCall({
      prompt: astraPrompt,
      model: "gpt-6-astra",
      phase: effectivePhase,
      workspaceRoot,
      allowedFiles,
      allowFileEdits,
      reasoningEffort: "high",
      timeoutMs,
      mockRunner,
    });

    return {
      ...astraResult,
      department: "codex",
      initialModel: primaryModel,
      model: "gpt-6-astra",
      phase: effectivePhase,
      escalatedToAstra: true,
      escalationReason:
        attemptResult.error || "gpt-6.1-sol 触发疑难升级协议，召唤 gpt-6-astra 拍板",
      durationMs: Date.now() - startMs,
    };
  }

  return {
    ...attemptResult,
    department: "codex",
    initialModel: primaryModel,
    model: primaryModel,
    phase: effectivePhase,
    escalatedToAstra: false,
    durationMs: Date.now() - startMs,
  };
}

async function executeSingleCodexCall({
  prompt,
  model,
  phase,
  workspaceRoot,
  allowedFiles,
  allowFileEdits,
  reasoningEffort,
  timeoutMs,
  mockRunner,
}) {
  const fullPrompt = allowFileEdits
    ? [
        buildWorkspaceContextPrompt(workspaceRoot, allowedFiles),
        getFileEditProtocolInstruction(allowedFiles),
        `## 任务指令\n${prompt}`,
      ].join("\n\n")
    : prompt;

  if (typeof mockRunner === "function") {
    const res = await mockRunner({
      department: "codex",
      model,
      phase,
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
      output: res.output || "",
      tokensUsed: res.tokensUsed || 0,
      quotaNote: "ChatGPT Codex 套餐额度",
      error: res.error || null,
    };
  }

  if (!fs.existsSync(CODEX_BIN_PATH)) {
    return {
      ok: false,
      output: "",
      tokensUsed: 0,
      quotaNote: "Codex CLI missing",
      error: `Codex binary not found at ${CODEX_BIN_PATH}`,
    };
  }

  const tmpOutFile = path.join(
    os.tmpdir(),
    `dsh-codex-last-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
  );

  const sandboxMode = allowFileEdits ? "workspace-write" : "read-only";
  const args = [
    "exec",
    "-m",
    model,
    "-c",
    `model_reasoning_effort="${reasoningEffort}"`,
    "-c",
    "mcp_servers={}",
    "-s",
    sandboxMode,
    "--skip-git-repo-check",
    "--ephemeral",
    "-C",
    path.resolve(workspaceRoot),
    "-o",
    tmpOutFile,
    fullPrompt,
  ];

  return new Promise((resolve) => {
    const child = execFile(
      CODEX_BIN_PATH,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env },
      },
      (err, stdout, stderr) => {
        let lastMessage = "";
        try {
          if (fs.existsSync(tmpOutFile)) {
            lastMessage = fs.readFileSync(tmpOutFile, "utf8").trim();
            fs.rmSync(tmpOutFile, { force: true });
          }
        } catch {
          // ignore
        }

        const combined = `${stdout || ""}\n${stderr || ""}`;
        const tokenMatch = /tokens used\s*\r?\n\s*([\d,]+)/i.exec(combined);
        const tokensUsed = tokenMatch ? Number(tokenMatch[1].replace(/,/g, "")) : 0;

        // If `codex exec` exited with an error and did not write a final message to `-o tmpOutFile`,
        // treat it as a failure so `runCodexAgent` can automatically summon `gpt-6-astra`!
        if (err && !lastMessage) {
          resolve({
            ok: false,
            output: "",
            tokensUsed,
            quotaNote: "ChatGPT Codex 套餐额度",
            error: err.message || String(stderr || err),
          });
          return;
        }

        const output = lastMessage || extractCodexReplyFromStdout(stdout) || "";
        if (!output) {
          resolve({
            ok: false,
            output: "",
            tokensUsed,
            quotaNote: "ChatGPT Codex 套餐额度",
            error: err ? err.message : "Empty response from Codex CLI",
          });
          return;
        }

        if (allowFileEdits && output) {
          applyStructuredFileOperations(workspaceRoot, output, allowedFiles);
        }

        resolve({
          ok: true,
          output,
          tokensUsed,
          quotaNote: `ChatGPT Codex 套餐额度 (${tokensUsed ? `${tokensUsed} tokens` : "已计费"})`,
          error: null,
        });
      }
    );
    try {
      child.stdin?.end();
    } catch {
      // ignore
    }
  });
}

function extractCodexReplyFromStdout(stdout = "") {
  const lines = String(stdout).split(/\r?\n/);
  const idx = lines.lastIndexOf("codex");
  if (idx !== -1) {
    const tokIdx = lines.indexOf("tokens used", idx);
    const slice = tokIdx !== -1 ? lines.slice(idx + 1, tokIdx) : lines.slice(idx + 1);
    return slice.join("\n").trim();
  }
  return "";
}
